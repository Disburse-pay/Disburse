/**
 * Market-maker bot — keeps the off-chain CLOB quoted on both sides for every
 * open market. Solves the cold-start "empty book" problem so users can always
 * buy and sell. Designed to be invoked by a cron (one-shot per tick) OR run
 * as a long-running daemon via MM_LOOP_INTERVAL_MS.
 *
 * Strategy per tick, per open market:
 *   1. Skip if market is within MM_CLOSE_GRACE_MS of close (don't get stuck
 *      with unhedged inventory at resolution).
 *   2. Read on-chain inventory: USDC balance + YES/NO share balances.
 *   3. If min(yesShares, noShares) < MM_INVENTORY_FLOOR_MICROS, mintComplete
 *      to refill (requires USDC.approve(market, MAX) one-time, handled below).
 *   4. Fair-value = mean of the last MM_FAIR_FILLS_LOOKBACK fills, or 500_000
 *      (50%) if no trades yet.
 *   5. Sign and POST 4 orders to /api/markets-orders: YES BUY / YES SELL /
 *      NO BUY / NO SELL, each at fair ± spread/2. Short expiry (MM_QUOTE_TTL_S)
 *      so we don't have to cancel anything — stale quotes drop off the book
 *      automatically.
 *
 * Approvals (one-time, executed at startup if needed):
 *   USDC.approve(Exchange, MAX)              → lets Exchange pull USDC on BUY fills
 *   OutcomeToken.setApprovalForAll(Exchange) → lets Exchange transfer shares on SELL fills
 *   USDC.approve(<each market>, MAX)         → lets Market.mintComplete pull USDC
 *
 * Usage:
 *   # one-shot (cron-friendly):
 *   node --env-file=.env.local --import tsx scripts/mm-bot.ts
 *
 *   # daemon loop:
 *   MM_LOOP_INTERVAL_MS=60000 node --env-file=.env.local --import tsx scripts/mm-bot.ts
 *
 *   # dry-run (logs intended orders, makes no on-chain or HTTP writes):
 *   MM_DRY_RUN=1 node --env-file=.env.local --import tsx scripts/mm-bot.ts
 */

import process from "node:process";
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ARC_MIN_GAS_PRICE, arcTestnet, TOKENS } from "../src/lib/arc.js";
import { createServerArcPublicClient } from "../server/markets/rpc.js";
import {
  EXCHANGE_DOMAIN_NAME,
  EXCHANGE_DOMAIN_VERSION,
  ORDER_EIP712_TYPES,
  PRICE_SCALE,
} from "../server/markets/orders.js";

const MAX_UINT256 = (1n << 256n) - 1n;

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
]);

const ERC1155_ABI = parseAbi([
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address account, address operator) external view returns (bool)",
  "function tokenIdFor(address market, uint8 outcome) external pure returns (uint256)",
]);

const MARKET_ABI = parseAbi([
  "function mintComplete(uint256 amount) external",
  "function burnComplete(uint256 amount) external",
  "function claim(uint256 amount) external returns (bytes32)",
  "function closesAt() external view returns (uint64)",
  "function resolved() external view returns (bool)",
  "function winningOutcome() external view returns (uint8)",
  "function tokenIdYes() external view returns (uint256)",
  "function tokenIdNo() external view returns (uint256)",
]);

// Exchange.fillOrder lets us take another maker's resting quote when ACTIVE
// take mode is enabled. The struct shape must match Exchange.sol's Order.
const EXCHANGE_ABI = parseAbi([
  "function fillOrder((address maker,address market,uint8 outcome,uint8 side,uint256 price,uint256 size,uint64 expiry,uint256 salt) order, bytes signature, uint256 fillSize) external",
]);

type Config = {
  account: PrivateKeyAccount;
  exchange: Address;
  outcomeToken: Address;
  collateral: Address;
  apiBaseUrl: string;
  quoteSizeMicros: bigint;
  spreadMicros: bigint;          // total spread (half on each side of mid)
  inventoryFloorMicros: bigint;  // mintComplete trigger
  inventoryTopupMicros: bigint;  // amount per mintComplete call
  closeGraceMs: number;          // stop quoting if close is within this window
  burnGraceMs: number;           // burnComplete balanced inventory inside this window
  quoteTtlSeconds: number;
  fairLookback: number;
  dryRun: boolean;
  // ── Active-take mode (opt-in) ────────────────────────────────────────
  // When two MM bots run with opposite fairSkewMicros, their depth looks
  // subtly different. Without anyone TAKING, no fills ever print on the
  // tape. The take pass below randomly nibbles the other bot's resting
  // quote so the market shows ongoing activity. Self-fills revert in
  // Exchange.sol so we filter out our own maker address before submitting.
  fairSkewMicros: bigint;        // signed shift applied to fair before quoting
  takeProbability: number;       // 0..1, chance per market per tick
  takeSizeMicros: bigint;        // fillSize when we do take
  takeMaxDeviationMicros: bigint; // skip orders whose price is too far from fair
};

type MarketRow = {
  id: string;
  onchainAddress: Address;
  closesAt: string;
  status: "open" | "closed" | "resolved";
};

type FillRow = {
  price: string;
  size: string;
  outcome: 0 | 1;
};

async function main() {
  const cfg = loadConfig();
  log(`bot=${cfg.account.address} dryRun=${cfg.dryRun} api=${cfg.apiBaseUrl}`);

  await ensureGlobalApprovals(cfg);

  const intervalMs = readNumber("MM_LOOP_INTERVAL_MS", 0);
  if (intervalMs <= 0) {
    await runTick(cfg);
    return;
  }

  log(`looping every ${intervalMs}ms`);
  // Long-running mode. Crash-on-error is intentional: a process supervisor
  // (pm2 / systemd) restarts cleanly, and a stuck-but-alive bot is worse
  // than a dead one we can notice.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runTick(cfg);
    } catch (err) {
      console.error("tick failed:", err instanceof Error ? err.stack ?? err.message : err);
    }
    await sleep(intervalMs);
  }
}

async function runTick(cfg: Config) {
  // Each tick we touch three lifecycle stages, in this order:
  //
  //   1. Resolved markets we still hold shares on — claim() to recover USDC.
  //   2. Near-close markets — burnComplete() the balanced inventory so we
  //      don't get stranded with a worthless losing side at resolution.
  //   3. Live markets that aren't within the close grace — refill inventory
  //      via mintComplete() if low, then quote 4 orders.
  //
  // (1) and (2) need the "all markets" list (incl. resolved + closed) because
  // /api/markets?status=open hides them. We fetch both lists here.
  const [openMarkets, closedMarkets] = await Promise.all([
    fetchMarketsByStatus(cfg, "open"),
    fetchMarketsByStatus(cfg, "resolved"),
  ]);

  // ── Stage 1: claim payouts on resolved markets where we still hold shares
  for (const market of closedMarkets) {
    try {
      await claimResolvedMarket(cfg, market);
    } catch (err) {
      console.error(`claim ${market.id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Stage 2 + 3: process every still-open market
  const cutoff = Date.now() + cfg.closeGraceMs;
  const active = openMarkets.filter((m) => new Date(m.closesAt).getTime() > cutoff);
  const nearClose = openMarkets.filter((m) => new Date(m.closesAt).getTime() <= cutoff);
  log(`tick: ${openMarkets.length} open, ${active.length} active, ${nearClose.length} near-close, ${closedMarkets.length} resolved`);

  // Near-close: try to burnComplete balanced inventory so we exit cleanly.
  for (const market of nearClose) {
    try {
      await burnNearClose(cfg, market);
    } catch (err) {
      console.error(`burn ${market.id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  // Live markets: normal quoting loop. After quoting each market, optionally
  // take a small slice of another maker's resting quote so the trade tape
  // doesn't go dark. Take errors are isolated from quote errors.
  for (const market of active) {
    try {
      await quoteMarket(cfg, market);
    } catch (err) {
      console.error(`market ${market.id} failed:`, err instanceof Error ? err.message : err);
    }
    try {
      await maybeTakeMarket(cfg, market);
    } catch (err) {
      console.error(`market ${market.id} take failed:`, err instanceof Error ? err.message : err);
    }
  }
}

async function quoteMarket(cfg: Config, market: MarketRow) {
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const marketAddr = getAddress(market.onchainAddress);

  // Read inventory + on-chain truth in parallel
  const [resolved, usdcBal, yesId, noId] = await Promise.all([
    client.readContract({ address: marketAddr, abi: MARKET_ABI, functionName: "resolved" }) as Promise<boolean>,
    client.readContract({ address: cfg.collateral, abi: ERC20_ABI, functionName: "balanceOf", args: [cfg.account.address] }) as Promise<bigint>,
    client.readContract({ address: marketAddr, abi: MARKET_ABI, functionName: "tokenIdYes" }) as Promise<bigint>,
    client.readContract({ address: marketAddr, abi: MARKET_ABI, functionName: "tokenIdNo" }) as Promise<bigint>,
  ]);
  if (resolved) {
    log(`  ${market.id}: resolved, skip`);
    return;
  }

  const [yesBal, noBal] = await Promise.all([
    client.readContract({ address: cfg.outcomeToken, abi: ERC1155_ABI, functionName: "balanceOf", args: [cfg.account.address, yesId] }) as Promise<bigint>,
    client.readContract({ address: cfg.outcomeToken, abi: ERC1155_ABI, functionName: "balanceOf", args: [cfg.account.address, noId] }) as Promise<bigint>,
  ]);

  // Refill shares via mintComplete if either side is low. Requires USDC
  // approval to the per-market contract — done lazily here so we don't waste
  // a tx on markets we never quote.
  let yes = yesBal;
  let no = noBal;
  const minSide = yes < no ? yes : no;
  if (minSide < cfg.inventoryFloorMicros) {
    const need = cfg.inventoryTopupMicros;
    if (usdcBal < need) {
      log(`  ${market.id}: low shares (yes=${fmt(yes)} no=${fmt(no)}) but USDC ${fmt(usdcBal)} < ${fmt(need)}, skip`);
      return;
    }
    await ensureMarketAllowance(cfg, marketAddr);
    log(`  ${market.id}: mintComplete ${fmt(need)} USDC`);
    if (!cfg.dryRun) {
      await sendTx(cfg, marketAddr, encodeFunctionData({ abi: MARKET_ABI, functionName: "mintComplete", args: [need] }));
      yes += need;
      no += need;
    }
  }

  const fairMicros = await fetchFairValue(cfg, market.id);
  // Two-bot setup: bot A runs with positive skew, bot B with negative skew,
  // so their books are subtly tilted in opposite directions. The skew only
  // moves quotes; it does NOT widen the spread (that's still spreadMicros).
  const skewedFair = clampPrice(fairMicros + cfg.fairSkewMicros);
  const halfSpread = cfg.spreadMicros / 2n;
  // Hard bounds: 0 < price < PRICE_SCALE (Exchange require).
  const yesBid = clampPrice(skewedFair - halfSpread);
  const yesAsk = clampPrice(skewedFair + halfSpread);
  // NO price = 1 - YES price (binary market identity).
  const noBid = clampPrice(PRICE_SCALE - yesAsk);
  const noAsk = clampPrice(PRICE_SCALE - yesBid);

  const expiry = BigInt(Math.floor(Date.now() / 1000) + cfg.quoteTtlSeconds);
  const quotes: Array<{ outcome: 0 | 1; side: 0 | 1; price: bigint; have: bigint; reason: string }> = [
    { outcome: 1, side: 0, price: yesBid, have: usdcBal, reason: "YES BUY (need USDC)" },
    { outcome: 1, side: 1, price: yesAsk, have: yes,     reason: "YES SELL (need YES shares)" },
    { outcome: 0, side: 0, price: noBid,  have: usdcBal, reason: "NO BUY (need USDC)" },
    { outcome: 0, side: 1, price: noAsk,  have: no,      reason: "NO SELL (need NO shares)" },
  ];

  const skewTag = cfg.fairSkewMicros === 0n ? "" : ` skew=${formatSkewMicros(cfg.fairSkewMicros)}`;
  log(`  ${market.id}: fair=${formatPriceMicros(fairMicros)}${skewTag} yes[${formatPriceMicros(yesBid)}/${formatPriceMicros(yesAsk)}] no[${formatPriceMicros(noBid)}/${formatPriceMicros(noAsk)}] usdc=${fmt(usdcBal)} yes=${fmt(yes)} no=${fmt(no)}`);

  for (const q of quotes) {
    // BUY needs price*size USDC; SELL needs `size` shares. Skip if balance
    // wouldn't cover a full fill — better to under-quote than to have an
    // order someone hits that then reverts on Exchange.
    const needed = q.side === 0 ? (q.price * cfg.quoteSizeMicros) / PRICE_SCALE : cfg.quoteSizeMicros;
    if (q.have < needed) {
      log(`    skip ${q.reason}: have ${fmt(q.have)} < need ${fmt(needed)}`);
      continue;
    }
    const order = {
      maker: cfg.account.address,
      market: marketAddr,
      outcome: q.outcome,
      side: q.side,
      price: q.price,
      size: cfg.quoteSizeMicros,
      expiry,
      salt: randomSalt(),
    } as const;

    if (cfg.dryRun) {
      log(`    [dry] would post ${q.reason} @ ${formatPriceMicros(q.price)}`);
      continue;
    }

    try {
      const signature = await signOrder(cfg, order);
      const result = await postOrder(cfg, order, signature);
      log(`    posted ${q.reason} @ ${formatPriceMicros(q.price)} hash=${result.hash}`);
    } catch (err) {
      console.error(`    post ${q.reason} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

// ─── Active take (cross other maker quotes) ────────────────────────────

/**
 * With probability `takeProbability` per market per tick, fetch the full
 * signed orderbook (`/api/markets-detail`) and call `Exchange.fillOrder`
 * against one randomly chosen resting order that is NOT ours. This is what
 * produces visible trade tape — quoting alone leaves the fills feed empty
 * until a human trades.
 *
 * Safety guards:
 *   - Skip orders whose maker is us (Exchange would revert on self-trade).
 *   - Skip near-expired orders so the tx isn't wasted on a stale book.
 *   - Skip orders too far from fair value (likely stale or manipulated).
 *   - Pre-check on-chain balance for the side we have to pay.
 */
async function maybeTakeMarket(cfg: Config, market: MarketRow): Promise<void> {
  if (cfg.takeProbability <= 0) return;
  if (Math.random() >= cfg.takeProbability) return;

  type RawOrderWire = {
    hash: Hex;
    maker: Address;
    outcome: 0 | 1;
    side: 0 | 1;
    price: string;
    size: string;
    filled: string;
    expiry: number | string;
    salt: string;
    signature: Hex;
    status: string;
  };
  const detailRes = await fetch(
    `${cfg.apiBaseUrl}/api/markets-detail?id=${encodeURIComponent(market.id)}`
  );
  if (!detailRes.ok) return;
  const detail = (await detailRes.json()) as { orderbook?: RawOrderWire[] };
  if (!detail.orderbook?.length) return;

  const fairMicros = await fetchFairValue(cfg, market.id);
  const nowSec = Math.floor(Date.now() / 1000);
  const ownMaker = cfg.account.address.toLowerCase();

  const candidates = detail.orderbook.filter((o) => {
    if (o.maker.toLowerCase() === ownMaker) return false;
    if (o.status !== "open" && o.status !== "partial") return false;
    const expirySec =
      typeof o.expiry === "number"
        ? o.expiry
        : Math.floor(new Date(o.expiry).getTime() / 1000);
    if (expirySec <= nowSec + 30) return false;
    const remaining = BigInt(o.size) - BigInt(o.filled);
    if (remaining <= 0n) return false;
    // Compare in YES space so we use one fair reference for both outcomes.
    const yesPrice = o.outcome === 1 ? BigInt(o.price) : PRICE_SCALE - BigInt(o.price);
    const deviation = yesPrice > fairMicros ? yesPrice - fairMicros : fairMicros - yesPrice;
    if (deviation > cfg.takeMaxDeviationMicros) return false;
    return true;
  });
  if (candidates.length === 0) return;

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const remaining = BigInt(pick.size) - BigInt(pick.filled);
  const fillSize = remaining < cfg.takeSizeMicros ? remaining : cfg.takeSizeMicros;
  if (fillSize <= 0n) return;

  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const marketAddr = getAddress(market.onchainAddress);

  // Maker BUY (side=0): taker pays shares. Maker SELL (side=1): taker pays USDC.
  if (pick.side === 0) {
    const tokenId = (await client.readContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: pick.outcome === 1 ? "tokenIdYes" : "tokenIdNo",
    })) as bigint;
    const bal = (await client.readContract({
      address: cfg.outcomeToken,
      abi: ERC1155_ABI,
      functionName: "balanceOf",
      args: [cfg.account.address, tokenId],
    })) as bigint;
    if (bal < fillSize) {
      log(`  ${market.id}: take skip (need ${fmt(fillSize)} ${pick.outcome === 1 ? "YES" : "NO"} shares, have ${fmt(bal)})`);
      return;
    }
  } else {
    const usdcBal = (await client.readContract({
      address: cfg.collateral,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [cfg.account.address],
    })) as bigint;
    const usdcNeed = (BigInt(pick.price) * fillSize) / PRICE_SCALE;
    if (usdcBal < usdcNeed) {
      log(`  ${market.id}: take skip (need ${fmt(usdcNeed)} USDC, have ${fmt(usdcBal)})`);
      return;
    }
  }

  const sideLabel = pick.side === 0 ? "BUY" : "SELL";
  const outcomeLabel = pick.outcome === 1 ? "YES" : "NO";
  log(`  ${market.id}: TAKE ${fmt(fillSize)} ${outcomeLabel} ${sideLabel} @ ${formatPriceMicros(BigInt(pick.price))} from ${pick.maker.slice(0, 10)}…`);
  if (cfg.dryRun) return;

  const expirySec =
    typeof pick.expiry === "number"
      ? pick.expiry
      : Math.floor(new Date(pick.expiry as string).getTime() / 1000);
  const order = {
    maker: getAddress(pick.maker),
    market: marketAddr,
    outcome: pick.outcome,
    side: pick.side,
    price: BigInt(pick.price),
    size: BigInt(pick.size),
    expiry: BigInt(expirySec),
    salt: BigInt(pick.salt),
  };
  const data = encodeFunctionData({
    abi: EXCHANGE_ABI,
    functionName: "fillOrder",
    args: [order, pick.signature, fillSize],
  });
  const txHash = await sendTx(cfg, cfg.exchange, data);
  log(`    take filled tx=${txHash}`);
  // Tell the server to index this fill immediately; otherwise the tape lags
  // until the periodic reconciler runs. Best-effort.
  try {
    await fetch(`${cfg.apiBaseUrl}/api/markets-fills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash }),
    });
  } catch (err) {
    log(`    fills-notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Approvals ──────────────────────────────────────────────────────────

async function ensureGlobalApprovals(cfg: Config) {
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });

  // USDC.approve(Exchange, MAX) — without this Exchange can't pull USDC on
  // taker fills of our BUY orders.
  const usdcAllowance = await client.readContract({
    address: cfg.collateral,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [cfg.account.address, cfg.exchange],
  }) as bigint;
  if (usdcAllowance < (1n << 200n)) {
    log(`approving USDC -> Exchange ${cfg.exchange}`);
    if (!cfg.dryRun) {
      await sendTx(cfg, cfg.collateral, encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [cfg.exchange, MAX_UINT256],
      }));
    }
  }

  // setApprovalForAll(Exchange) on the ERC1155 — without this Exchange can't
  // transfer our shares on taker fills of our SELL orders.
  const approved = await client.readContract({
    address: cfg.outcomeToken,
    abi: ERC1155_ABI,
    functionName: "isApprovedForAll",
    args: [cfg.account.address, cfg.exchange],
  }) as boolean;
  if (!approved) {
    log(`setApprovalForAll OutcomeToken -> Exchange`);
    if (!cfg.dryRun) {
      await sendTx(cfg, cfg.outcomeToken, encodeFunctionData({
        abi: ERC1155_ABI,
        functionName: "setApprovalForAll",
        args: [cfg.exchange, true],
      }));
    }
  }
}

const marketApprovedCache = new Set<Address>();
async function ensureMarketAllowance(cfg: Config, market: Address) {
  if (marketApprovedCache.has(market)) return;
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const allowance = await client.readContract({
    address: cfg.collateral,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [cfg.account.address, market],
  }) as bigint;
  if (allowance < (1n << 200n)) {
    log(`  approving USDC -> Market ${market}`);
    if (!cfg.dryRun) {
      await sendTx(cfg, cfg.collateral, encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [market, MAX_UINT256],
      }));
    }
  }
  marketApprovedCache.add(market);
}

// ─── Fair value ─────────────────────────────────────────────────────────

async function fetchFairValue(cfg: Config, marketId: string): Promise<bigint> {
  type FillsResponse = { fills: FillRow[] };
  const res = await fetch(`${cfg.apiBaseUrl}/api/markets-fills?marketId=${encodeURIComponent(marketId)}&limit=${cfg.fairLookback}`);
  if (!res.ok) return PRICE_SCALE / 2n;
  const body = (await res.json()) as FillsResponse;
  if (!body.fills?.length) return PRICE_SCALE / 2n;

  // Normalize NO fills to YES space: yesPrice = 1 - noPrice. Then average.
  let total = 0n;
  let count = 0n;
  for (const f of body.fills) {
    const p = BigInt(f.price);
    const yesP = f.outcome === 1 ? p : PRICE_SCALE - p;
    total += yesP;
    count += 1n;
  }
  if (count === 0n) return PRICE_SCALE / 2n;
  return total / count;
}

// ─── Order signing / posting ────────────────────────────────────────────

type Order = {
  maker: Address;
  market: Address;
  outcome: 0 | 1;
  side: 0 | 1;
  price: bigint;
  size: bigint;
  expiry: bigint;
  salt: bigint;
};

async function signOrder(cfg: Config, order: Order): Promise<Hex> {
  return cfg.account.signTypedData({
    domain: {
      name: EXCHANGE_DOMAIN_NAME,
      version: EXCHANGE_DOMAIN_VERSION,
      chainId: arcTestnet.id,
      verifyingContract: cfg.exchange,
    },
    types: ORDER_EIP712_TYPES,
    primaryType: "Order",
    message: order,
  });
}

async function postOrder(cfg: Config, order: Order, signature: Hex): Promise<{ hash: Hex }> {
  const res = await fetch(`${cfg.apiBaseUrl}/api/markets-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      maker: order.maker,
      market: order.market,
      outcome: order.outcome,
      side: order.side,
      price: order.price.toString(),
      size: order.size.toString(),
      expiry: order.expiry.toString(),
      salt: order.salt.toString(),
      signature,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`POST /api/markets-orders ${res.status}: ${txt}`);
  }
  return (await res.json()) as { hash: Hex };
}

async function postClaim(cfg: Config, marketId: string, txHash: Hash): Promise<void> {
  const res = await fetch(`${cfg.apiBaseUrl}/api/markets-claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ marketId, txHash }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`POST /api/markets-claims ${res.status}: ${txt}`);
  }
}

// ─── Markets list ───────────────────────────────────────────────────────

async function fetchMarketsByStatus(
  cfg: Config,
  status: "open" | "resolved" | "closed"
): Promise<MarketRow[]> {
  const res = await fetch(`${cfg.apiBaseUrl}/api/markets?status=${status}`);
  if (!res.ok) throw new Error(`GET /api/markets ${res.status}`);
  const body = (await res.json()) as { markets: MarketRow[] };
  return body.markets ?? [];
}

// ─── Resolution-stage actions ───────────────────────────────────────────

/**
 * If this market is resolved and we still hold winning-outcome shares,
 * claim() to swap them 1:1 for USDC. Idempotent: if balance is zero we
 * just skip. Loser shares are abandoned — they're worthless and there's
 * no exit path for them by design.
 */
async function claimResolvedMarket(cfg: Config, market: MarketRow): Promise<void> {
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const marketAddr = getAddress(market.onchainAddress);

  // Re-read from chain — DB status may lag a tick or two behind on-chain truth.
  const [isResolved, winningOutcome] = await Promise.all([
    client.readContract({ address: marketAddr, abi: MARKET_ABI, functionName: "resolved" }) as Promise<boolean>,
    client.readContract({ address: marketAddr, abi: MARKET_ABI, functionName: "winningOutcome" }) as Promise<number>,
  ]);
  if (!isResolved) return;

  const winId = (await client.readContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: winningOutcome === 1 ? "tokenIdYes" : "tokenIdNo",
  })) as bigint;

  const bal = (await client.readContract({
    address: cfg.outcomeToken,
    abi: ERC1155_ABI,
    functionName: "balanceOf",
    args: [cfg.account.address, winId],
  })) as bigint;
  if (bal === 0n) return;

  log(`  ${market.id}: claim ${fmt(bal)} ${winningOutcome === 1 ? "YES" : "NO"} (won)`);
  if (cfg.dryRun) return;
  const txHash = await sendTx(cfg, marketAddr, encodeFunctionData({
    abi: MARKET_ABI,
    functionName: "claim",
    args: [bal],
  }));
  await postClaim(cfg, market.id, txHash);
}

/**
 * Within the burn-grace window before close, recover collateral by burning
 * the balanced part of the inventory: burnComplete(min(yes, no)) gives back
 * exactly that much USDC and leaves only the imbalanced "directional" leg
 * on the books. Without this the bot eats the full cost of any losing-side
 * shares at resolution; with it, only the unhedged delta is at risk.
 */
async function burnNearClose(cfg: Config, market: MarketRow): Promise<void> {
  const closeMs = new Date(market.closesAt).getTime();
  const ttl = closeMs - Date.now();
  if (ttl > cfg.burnGraceMs) return; // not in burn window yet
  if (ttl <= 0) return; // chain will reject burnComplete after close anyway

  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const marketAddr = getAddress(market.onchainAddress);

  const [resolved, yesId, noId] = await Promise.all([
    client.readContract({ address: marketAddr, abi: MARKET_ABI, functionName: "resolved" }) as Promise<boolean>,
    client.readContract({ address: marketAddr, abi: MARKET_ABI, functionName: "tokenIdYes" }) as Promise<bigint>,
    client.readContract({ address: marketAddr, abi: MARKET_ABI, functionName: "tokenIdNo" }) as Promise<bigint>,
  ]);
  if (resolved) return;

  const [yesBal, noBal] = await Promise.all([
    client.readContract({ address: cfg.outcomeToken, abi: ERC1155_ABI, functionName: "balanceOf", args: [cfg.account.address, yesId] }) as Promise<bigint>,
    client.readContract({ address: cfg.outcomeToken, abi: ERC1155_ABI, functionName: "balanceOf", args: [cfg.account.address, noId] }) as Promise<bigint>,
  ]);

  const burnAmount = yesBal < noBal ? yesBal : noBal;
  if (burnAmount === 0n) return;

  log(`  ${market.id}: burnComplete ${fmt(burnAmount)} (yes=${fmt(yesBal)} no=${fmt(noBal)}, ${Math.round(ttl / 1000)}s to close)`);
  if (cfg.dryRun) return;
  await sendTx(cfg, marketAddr, encodeFunctionData({
    abi: MARKET_ABI,
    functionName: "burnComplete",
    args: [burnAmount],
  }));
}

// ─── Tx submission (mirrors smoke-markets.ts) ───────────────────────────

async function sendTx(cfg: Config, to: Address, data: Hex): Promise<Hash> {
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const gas = await client.estimateGas({ account: cfg.account.address, to, data });
  const gasPrice = await client.getGasPrice();
  const serialized = await cfg.account.signTransaction({
    chainId: arcTestnet.id,
    to,
    data,
    gas,
    gasPrice: gasPrice > ARC_MIN_GAS_PRICE ? gasPrice : ARC_MIN_GAS_PRICE,
    nonce: await client.getTransactionCount({ address: cfg.account.address, blockTag: "pending" }),
    type: "legacy",
  });
  const hash = await client.sendRawTransaction({ serializedTransaction: serialized });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return hash;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function loadConfig(): Config {
  const key = required("MARKETS_MM_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("MARKETS_MM_PRIVATE_KEY must be a 32-byte hex string");
  const account = privateKeyToAccount(key as Hex);

  return {
    account,
    exchange: getAddress(required("MARKETS_EXCHANGE")),
    outcomeToken: getAddress(required("MARKETS_OUTCOME_TOKEN")),
    collateral: getAddress(process.env.MARKETS_COLLATERAL_ADDRESS ?? TOKENS.USDC.address),
    apiBaseUrl: (process.env.MM_API_BASE_URL ?? "https://bet.disburse.online").replace(/\/$/, ""),
    quoteSizeMicros: readBigint("MM_QUOTE_SIZE_MICROS", 10_000_000n),     // $10
    spreadMicros: readBigint("MM_SPREAD_MICROS", 40_000n),                 // 4% total spread
    inventoryFloorMicros: readBigint("MM_INVENTORY_FLOOR_MICROS", 20_000_000n), // 20 shares
    inventoryTopupMicros: readBigint("MM_INVENTORY_TOPUP_MICROS", 50_000_000n), // mint 50 USDC -> 50 YES + 50 NO
    closeGraceMs: readNumber("MM_CLOSE_GRACE_MS", 120_000),                // stop quoting if <2min to close
    burnGraceMs: readNumber("MM_BURN_GRACE_MS", 300_000),                  // burnComplete balanced inventory if <5min to close
    quoteTtlSeconds: readNumber("MM_QUOTE_TTL_S", 90),                     // orders expire after 90s
    fairLookback: readNumber("MM_FAIR_FILLS_LOOKBACK", 10),
    dryRun: process.env.MM_DRY_RUN === "1",
    // 1 bps = 0.0001 = 100 price-micros. Signed: a second bot uses the
    // opposite sign so the two books tilt opposite ways.
    fairSkewMicros: readSignedBigint("MM_FAIR_SKEW_BPS", 0n) * 100n,
    takeProbability: readFloat01("MM_TAKE_PROBABILITY_PER_TICK", 0),
    takeSizeMicros: readBigint("MM_TAKE_SIZE_MICROS", 1_000_000n),         // $1
    takeMaxDeviationMicros: readBigint("MM_TAKE_MAX_DEVIATION_BPS", 1_500n) * 100n, // 15%
  };
}

function required(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function readBigint(key: string, fallback: bigint): bigint {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a non-negative integer`);
  return BigInt(raw);
}

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a finite number`);
  return n;
}

function readSignedBigint(key: string, fallback: bigint): bigint {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  if (!/^-?\d+$/.test(raw)) throw new Error(`${key} must be a signed integer`);
  return BigInt(raw);
}

function readFloat01(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${key} must be a number in [0,1]`);
  return n;
}

function randomSalt(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}

function clampPrice(p: bigint): bigint {
  if (p <= 0n) return 1n;
  if (p >= PRICE_SCALE) return PRICE_SCALE - 1n;
  return p;
}

function fmt(micros: bigint): string {
  return `${formatUnits(micros, 6)}`;
}

function formatPriceMicros(p: bigint): string {
  return `${(Number(p) / 1_000_000).toFixed(3)}`;
}

function formatSkewMicros(skew: bigint): string {
  const bps = skew / 100n;
  const sign = skew >= 0n ? "+" : "";
  return `${sign}${bps}bps`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

main().catch((err) => {
  console.error("mm-bot failed:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
