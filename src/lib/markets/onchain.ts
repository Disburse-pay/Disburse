/**
 * Browser-side on-chain helpers for the markets module.
 *
 * Two surfaces:
 *   - `readClaimableShares(account, market)` — reads the OutcomeToken
 *     balance for the winning outcome via the existing Arc publicClient.
 *     Source of truth for the claim button's payout amount.
 *   - `submitClaim(provider, account, market, amount)` — encodes
 *     `Market.claim(amount)` calldata, sends via the user's wallet
 *     (`eth_sendTransaction`), waits for a receipt, returns the tx hash.
 *
 * Patterns mirror `src/lib/onchain.ts` (`requestWalletTransaction` +
 * `waitForTransactionConfirmation`) for cross-codebase consistency.
 */

import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type Address,
  type Hash,
  type Hex
} from "viem";
import { ARC_CHAIN_ID, publicClient, TOKENS } from "../arc";
import type { EthereumProvider } from "../onchain";
import { getMarketsConfig } from "./config";
import type { Outcome } from "./types";
import type { RawOpenOrder } from "./api";

// ---------- ABIs (only the entries we call) ----------

const MARKET_ABI = parseAbi(["function claim(uint256 amount) external returns (bytes32)"]);

const OUTCOME_TOKEN_ABI = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)"
]);

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
]);

const OUTCOME_TOKEN_APPROVAL_ABI = parseAbi([
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)"
]);

// Exchange.fillOrders takes a struct array — parseAbi can't reliably represent
// nested tuples with named fields, so this is hand-written JSON form.
const EXCHANGE_FILL_ORDERS_ABI = [
  {
    type: "function",
    name: "fillOrders",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "orders",
        type: "tuple[]",
        components: [
          { name: "maker", type: "address" },
          { name: "market", type: "address" },
          { name: "outcome", type: "uint8" },
          { name: "side", type: "uint8" },
          { name: "price", type: "uint256" },
          { name: "size", type: "uint256" },
          { name: "expiry", type: "uint64" },
          { name: "salt", type: "uint256" }
        ]
      },
      { name: "signatures", type: "bytes[]" },
      { name: "fillSizes", type: "uint256[]" }
    ],
    outputs: []
  }
] as const;

/** uint256 max, used as approval amount for an effectively-unlimited grant. */
const MAX_UINT256 = (1n << 256n) - 1n;

const PRICE_SCALE = 1_000_000n;

// ---------- tokenId derivation ----------

/**
 * Mirrors `OutcomeToken.tokenIdFor(market, outcome)`:
 *   uint256(keccak256(abi.encode(market, outcome)))
 *
 * Encoded as `(address market, uint8 outcome)` to match Solidity's
 * `abi.encode` packing.
 */
export function tokenIdFor(market: Address, outcome: Outcome): bigint {
  const outcomeInt = outcome === "YES" ? 1 : 0;
  const encoded = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint8" }
    ],
    [market, outcomeInt]
  );
  return BigInt(keccak256(encoded));
}

// ---------- reads ----------

/**
 * Read the user's balance of the winning-outcome token. Returns 0n if the
 * market isn't resolved yet (claim isn't available).
 */
export async function readClaimableShares(
  account: Address,
  market: { onchainAddress: Address; winningOutcome?: Outcome; status: string }
): Promise<bigint> {
  if (market.status !== "resolved" || !market.winningOutcome) return 0n;
  const { outcomeToken } = getMarketsConfig();
  if (!outcomeToken) {
    // No outcome-token address configured — fall back to zero rather than
    // throwing, so the claim button just renders "Not eligible" instead of
    // crashing the page.
    return 0n;
  }
  const id = tokenIdFor(market.onchainAddress, market.winningOutcome);
  return (await publicClient.readContract({
    address: outcomeToken,
    abi: OUTCOME_TOKEN_ABI,
    functionName: "balanceOf",
    args: [account, id]
  })) as bigint;
}

// ---------- writes ----------

/**
 * Send Market.claim(amount) from the connected wallet and wait for
 * confirmation. Returns the tx hash; the caller posts that to
 * /api/markets-claims so the backend indexes the claim and issues a PSP.
 */
export async function submitClaim(
  provider: EthereumProvider,
  account: Address,
  marketAddress: Address,
  amount: bigint
): Promise<Hash> {
  // Guard against wrong-network mistakes — the only failure mode here is
  // silent if we don't surface it. Mirrors src/lib/onchain.ts.
  const chainId = await readWalletChainId(provider);
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error("Wallet is not on Arc Testnet. Switch networks, then try again.");
  }
  if (amount <= 0n) {
    throw new Error("Nothing to claim — winning-outcome balance is zero.");
  }

  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: "claim",
    args: [amount]
  });

  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: marketAddress,
        data
      }
    ]
  })) as unknown;
  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new Error("Wallet did not return a transaction hash.");
  }

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: hash as Hash,
    confirmations: 1
  });
  if (receipt.status !== "success") {
    throw new Error(`Claim transaction reverted: ${hash}`);
  }
  return hash as Hash;
}

// ---------- taker flow (Exchange.fillOrders) ----------

export type TakeOrderInput = {
  taker: Address;
  market: Address;
  outcome: Outcome;
  /**
   * "BUY" means the taker is acquiring shares — fills resting SELL orders
   * (asks). "SELL" means the taker is offloading shares — fills resting BUY
   * orders (bids).
   */
  intent: "BUY" | "SELL";
  /** Requested share quantity, 1e6 scale. */
  sizeMicros: bigint;
  /**
   * For BUY: ceiling on price (skip any ask above). For SELL: floor on price
   * (skip any bid below). 1e6 scale, 0 < p < 1_000_000.
   */
  limitPriceMicros: bigint;
  /** Snapshot of the market's open orderbook. Caller passes `rawOrders`. */
  rawOrders: RawOpenOrder[];
};

export type TakeOrderResult = {
  txHash: Hash;
  /** How many shares were actually swept. May be < requested if book ran out. */
  filledSizeMicros: bigint;
  /** Total USDC moved (shares × price summed across fills). 1e6 scale. */
  totalUsdcMicros: bigint;
  /** Per-maker fills that made up this transaction. */
  fills: Array<{ maker: Address; price: bigint; size: bigint }>;
};

type OrderTuple = {
  maker: Address;
  market: Address;
  outcome: number;
  side: number;
  price: bigint;
  size: bigint;
  expiry: bigint;
  salt: bigint;
};

/**
 * Walk the resting orderbook and sweep enough opposite-side orders to fill
 * `sizeMicros`. Returns the planned fills (one per maker order touched) and
 * the total swept size. Does NOT submit anything on-chain.
 *
 * Stops early if (a) the next eligible price violates `limitPriceMicros`, or
 * (b) the book is exhausted. Returning a partial fill is correct — the caller
 * decides whether to submit it.
 */
export function planTakerFills(input: {
  rawOrders: RawOpenOrder[];
  takerAddress: Address;
  outcome: Outcome;
  intent: "BUY" | "SELL";
  sizeMicros: bigint;
  limitPriceMicros: bigint;
}): Array<{ order: RawOpenOrder; fillSize: bigint }> {
  const outcomeInt = input.outcome === "YES" ? 1 : 0;
  // BUY taker fills SELL maker orders (side=1, asks). SELL taker fills BUY
  // maker orders (side=0, bids). Anything else is irrelevant.
  const targetSide = input.intent === "BUY" ? 1 : 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const takerLower = input.takerAddress.toLowerCase();

  const eligible = input.rawOrders
    .filter((o) => o.outcome === outcomeInt && o.side === targetSide)
    .filter((o) => o.status === "open" || o.status === "partial")
    .filter((o) => o.expiry > nowSec)
    // Self-trade is rejected by the Exchange — skip on the client too so the
    // taker doesn't waste a signature on a guaranteed revert.
    .filter((o) => o.maker.toLowerCase() !== takerLower)
    .map((o) => {
      const size = BigInt(o.size);
      const filled = BigInt(o.filled);
      return { o, remaining: size - filled, price: BigInt(o.price) };
    })
    .filter((row) => row.remaining > 0n);

  // BUY taker prefers cheapest ask first. SELL taker prefers highest bid first.
  eligible.sort((a, b) =>
    input.intent === "BUY" ? Number(a.price - b.price) : Number(b.price - a.price)
  );

  const plan: Array<{ order: RawOpenOrder; fillSize: bigint }> = [];
  let remaining = input.sizeMicros;
  for (const row of eligible) {
    if (remaining <= 0n) break;
    // Slippage gate. For BUY the price must not exceed the ceiling; for SELL
    // it must not fall below the floor. Equality is allowed.
    if (input.intent === "BUY" && row.price > input.limitPriceMicros) break;
    if (input.intent === "SELL" && row.price < input.limitPriceMicros) break;

    const fillSize = row.remaining < remaining ? row.remaining : remaining;
    plan.push({ order: row.o, fillSize });
    remaining -= fillSize;
  }
  return plan;
}

/**
 * Submit a market-style fill on-chain. Reads the orderbook snapshot the
 * caller passed in, walks best opposite-side resting orders up to
 * `sizeMicros`, ensures the taker has approved the Exchange for the relevant
 * asset (USDC for BUY, OutcomeToken for SELL), and submits a single
 * `Exchange.fillOrders` call so all sub-fills settle atomically.
 *
 * Returns once the tx is confirmed. Caller should follow up with
 * `indexFillsTx(txHash)` to populate the backend's fill table — the on-chain
 * tx is the source of truth, but the indexer is what makes the trade visible
 * in the UI.
 */
export async function takeOrder(
  provider: EthereumProvider,
  input: TakeOrderInput
): Promise<TakeOrderResult> {
  const { exchangeAddress, outcomeToken } = getMarketsConfig();
  if (!outcomeToken) {
    throw new Error(
      "VITE_MARKETS_OUTCOME_TOKEN is not configured — taker flow needs the OutcomeToken address for share approvals."
    );
  }

  const chainId = await readWalletChainId(provider);
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error("Wallet is not on Arc Testnet. Switch networks, then try again.");
  }

  if (input.sizeMicros <= 0n) {
    throw new Error("Order size must be positive.");
  }
  if (input.limitPriceMicros <= 0n || input.limitPriceMicros >= PRICE_SCALE) {
    throw new Error("Limit price out of range. Must satisfy 0 < price < 1.0.");
  }

  const plan = planTakerFills({
    rawOrders: input.rawOrders,
    takerAddress: input.taker,
    outcome: input.outcome,
    intent: input.intent,
    sizeMicros: input.sizeMicros,
    limitPriceMicros: input.limitPriceMicros
  });

  if (plan.length === 0) {
    throw new Error(
      input.intent === "BUY"
        ? "No matching asks in the orderbook at or below your limit price."
        : "No matching bids in the orderbook at or above your limit price."
    );
  }

  const totalSize = plan.reduce((acc, p) => acc + p.fillSize, 0n);
  const totalUsdc = plan.reduce(
    (acc, p) => acc + (BigInt(p.order.price) * p.fillSize) / PRICE_SCALE,
    0n
  );

  // Ensure approvals before signing the fill tx. Approvals are one-time per
  // user — subsequent trades skip these prompts.
  if (input.intent === "BUY") {
    await ensureUsdcApproval(provider, input.taker, exchangeAddress, totalUsdc);
  } else {
    await ensureOutcomeTokenApproval(provider, input.taker, exchangeAddress, outcomeToken);
  }

  const orders: OrderTuple[] = plan.map(({ order }) => ({
    maker: order.maker,
    market: input.market,
    outcome: order.outcome,
    side: order.side,
    price: BigInt(order.price),
    size: BigInt(order.size),
    expiry: BigInt(order.expiry),
    salt: BigInt(order.salt)
  }));
  const signatures = plan.map(({ order }) => order.signature);
  const fillSizes = plan.map(({ fillSize }) => fillSize);

  const data = encodeFunctionData({
    abi: EXCHANGE_FILL_ORDERS_ABI,
    functionName: "fillOrders",
    args: [orders, signatures, fillSizes]
  });

  const txHash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: input.taker, to: exchangeAddress, data }]
  })) as unknown;
  if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new Error("Wallet did not return a transaction hash.");
  }

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash as Hash,
    confirmations: 1
  });
  if (receipt.status !== "success") {
    throw new Error(`Fill transaction reverted: ${txHash}`);
  }

  return {
    txHash: txHash as Hash,
    filledSizeMicros: totalSize,
    totalUsdcMicros: totalUsdc,
    fills: plan.map((p) => ({
      maker: p.order.maker,
      price: BigInt(p.order.price),
      size: p.fillSize
    }))
  };
}

async function ensureUsdcApproval(
  provider: EthereumProvider,
  taker: Address,
  spender: Address,
  required: bigint
): Promise<void> {
  const usdc = TOKENS.USDC.address;
  const current = (await publicClient.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [taker, spender]
  })) as bigint;
  if (current >= required) return;

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, MAX_UINT256]
  });
  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: taker, to: usdc, data }]
  })) as Hex;
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
}

async function ensureOutcomeTokenApproval(
  provider: EthereumProvider,
  taker: Address,
  spender: Address,
  outcomeToken: Address
): Promise<void> {
  const approved = (await publicClient.readContract({
    address: outcomeToken,
    abi: OUTCOME_TOKEN_APPROVAL_ABI,
    functionName: "isApprovedForAll",
    args: [taker, spender]
  })) as boolean;
  if (approved) return;

  const data = encodeFunctionData({
    abi: OUTCOME_TOKEN_APPROVAL_ABI,
    functionName: "setApprovalForAll",
    args: [spender, true]
  });
  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: taker, to: outcomeToken, data }]
  })) as Hex;
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
}

// ---------- internal helpers ----------

async function readWalletChainId(provider: EthereumProvider): Promise<number> {
  const raw = (await provider.request({ method: "eth_chainId" })) as unknown;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    return raw.startsWith("0x") ? parseInt(raw, 16) : Number(raw);
  }
  throw new Error("Wallet did not return a chain id.");
}
