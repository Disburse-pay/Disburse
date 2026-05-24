/**
 * Lending keeper — single process, two responsibilities:
 *
 *   1. Pyth price pusher
 *      Every PYTH_PUSH_INTERVAL_MS (default 180 s), fetch the latest BTC/USD
 *      update from Hermes and call Pyth.updatePriceFeeds on Arc. Without this,
 *      the LendingPool reverts on any borrow/withdraw/liquidate after
 *      maxAgeSeconds (default 600 s) elapses.
 *
 *   2. Liquidation scanner
 *      Every LIQUIDATION_SCAN_INTERVAL_MS (default 30 s), query
 *      /api/lending-positions?liquidatable=1, then for each candidate:
 *        a. Push a fresh Pyth update (cheap insurance against stale price).
 *        b. Read current debt + health factor on-chain (cache may lag).
 *        c. Compute repay size = debt × CLOSE_FACTOR / 10_000.
 *        d. Send fillSize-clamped liquidate(borrower, repay).
 *
 * The two timers share a single nonce manager so concurrent txs from this
 * keeper don't collide. We re-read nonce with blockTag:"pending" before each
 * tx and rely on the RPC's ordering — same approach as mm-bot.ts.
 *
 * Usage:
 *   # one-shot (cron-friendly): runs one tick of each, exits
 *   node --env-file=.env.local --import tsx scripts/lending-keeper.ts
 *
 *   # daemon
 *   LENDING_KEEPER_LOOP=1 node --env-file=.env.local --import tsx scripts/lending-keeper.ts
 */

import process from "node:process";
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ARC_MIN_GAS_PRICE, arcTestnet } from "../src/lib/arc.js";
import { createServerArcPublicClient } from "../server/markets/rpc.js";

const LENDING_POOL_ABI = parseAbi([
  "function userDebtUsdc(address user) view returns (uint256)",
  "function healthFactor(address user) view returns (uint256)",
  "function liquidate(address borrower, uint256 repayUsdc)",
]);

const PYTH_ABI = parseAbi([
  "function getUpdateFee(bytes[] updateData) view returns (uint256)",
  "function updatePriceFeeds(bytes[] updateData) payable",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

const WAD = 10n ** 18n;
const MAX_UINT256 = (1n << 256n) - 1n;
/// Pool's CLOSE_FACTOR_BPS = 5000 (50%). Mirrored here to size liquidate
/// calls without an extra view.
const CLOSE_FACTOR_BPS = 5_000n;

type Config = {
  account: PrivateKeyAccount;
  pool: Address;
  pyth: Address;
  pythFeedId: Hex;
  usdc: Address;
  apiBaseUrl: string;
  hermesUrl: string;
  pythPushIntervalMs: number;
  liquidationScanIntervalMs: number;
  loop: boolean;
  dryRun: boolean;
};

async function main() {
  const cfg = loadConfig();
  log(`keeper=${cfg.account.address} dryRun=${cfg.dryRun} loop=${cfg.loop}`);
  log(`  pool=${cfg.pool}`);
  log(`  pyth=${cfg.pyth} feed=${cfg.pythFeedId.slice(0, 10)}…`);

  await ensureApprovals(cfg);

  if (!cfg.loop) {
    // One-shot: run each task once and exit.
    await safeRun("pyth-push", () => pushPythUpdate(cfg));
    await safeRun("liq-scan", () => runLiquidationScan(cfg));
    return;
  }

  // Daemon mode: two independent timers.
  const pythTimer = setInterval(() => {
    safeRun("pyth-push", () => pushPythUpdate(cfg));
  }, cfg.pythPushIntervalMs);
  const scanTimer = setInterval(() => {
    safeRun("liq-scan", () => runLiquidationScan(cfg));
  }, cfg.liquidationScanIntervalMs);

  // First-run immediately, then on interval.
  await safeRun("pyth-push", () => pushPythUpdate(cfg));
  await safeRun("liq-scan", () => runLiquidationScan(cfg));

  process.on("SIGINT", () => {
    clearInterval(pythTimer);
    clearInterval(scanTimer);
    process.exit(0);
  });
}

async function safeRun(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[${label}] failed:`, err instanceof Error ? err.message : err);
  }
}

// ─── Pyth push ──────────────────────────────────────────────────────────

async function pushPythUpdate(cfg: Config): Promise<void> {
  // Fetch latest signed VAA from Hermes.
  const url = `${cfg.hermesUrl}/v2/updates/price/latest?ids%5B%5D=${cfg.pythFeedId}&encoding=hex`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hermes ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { binary: { data: string[] }; parsed: Array<{ price: { price: string; expo: number } }> };
  const updateHex = ("0x" + body.binary.data[0]) as Hex;
  const priceRaw = body.parsed[0]?.price.price;
  const expo = body.parsed[0]?.price.expo ?? -8;

  // getUpdateFee + updatePriceFeeds. On Arc Testnet the fee is typically 1 wei.
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const fee = (await client.readContract({
    address: cfg.pyth,
    abi: PYTH_ABI,
    functionName: "getUpdateFee",
    args: [[updateHex]],
  })) as bigint;

  const usd = priceRaw ? (Number(priceRaw) / Math.pow(10, -expo)).toFixed(2) : "?";
  if (cfg.dryRun) {
    log(`[pyth-push] would push BTC/USD=$${usd} fee=${fee}wei (dry-run)`);
    return;
  }
  const hash = await sendTx(cfg, cfg.pyth, encodeFunctionData({
    abi: PYTH_ABI,
    functionName: "updatePriceFeeds",
    args: [[updateHex]],
  }), fee);
  log(`[pyth-push] BTC/USD=$${usd} fee=${fee}wei tx=${hash}`);
}

// ─── Liquidation scan ───────────────────────────────────────────────────

async function runLiquidationScan(cfg: Config): Promise<void> {
  const res = await fetch(`${cfg.apiBaseUrl}/api/lending-positions?liquidatable=1`);
  if (!res.ok) {
    log(`[liq-scan] API ${res.status} — skip`);
    return;
  }
  const body = (await res.json()) as { positions: Array<{
    userAddress: string;
    cachedDebtUsdc: string;
    cachedCollateralUsdc: string;
    cachedHealthFactor: string | null;
  }> };
  if (!body.positions?.length) {
    log(`[liq-scan] no candidates`);
    return;
  }
  log(`[liq-scan] ${body.positions.length} candidate(s)`);

  for (const p of body.positions) {
    await liquidatePosition(cfg, p.userAddress as Address);
  }
}

async function liquidatePosition(cfg: Config, borrower: Address): Promise<void> {
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });

  // Push a FRESH price before reading HF or liquidating — the indexer cache
  // may be slightly stale, and the contract requires fresh price for the
  // collateral seize math.
  await safeRun("pyth-push(pre-liquidate)", () => pushPythUpdate(cfg));

  // Re-read on-chain truth.
  const [debt, hf] = await Promise.all([
    client.readContract({ address: cfg.pool, abi: LENDING_POOL_ABI, functionName: "userDebtUsdc", args: [borrower] }) as Promise<bigint>,
    client.readContract({ address: cfg.pool, abi: LENDING_POOL_ABI, functionName: "healthFactor", args: [borrower] }) as Promise<bigint>,
  ]);

  if (hf >= WAD) {
    log(`  ${borrower}: now healthy (HF=${formatWad(hf)}), skip`);
    return;
  }
  if (debt === 0n) {
    log(`  ${borrower}: zero debt, skip`);
    return;
  }

  // Repay up to CLOSE_FACTOR of debt. Make sure we have USDC for it.
  const repayCap = (debt * CLOSE_FACTOR_BPS) / 10_000n;
  const usdcBal = (await client.readContract({
    address: cfg.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [cfg.account.address],
  })) as bigint;
  const repay = repayCap < usdcBal ? repayCap : usdcBal;
  if (repay === 0n) {
    log(`  ${borrower}: keeper has 0 USDC, top up keeper wallet ${cfg.account.address}`);
    return;
  }

  log(`  ${borrower}: HF=${formatWad(hf)} debt=${fmtUsdc(debt)} repay=${fmtUsdc(repay)}`);
  if (cfg.dryRun) return;

  try {
    const hash = await sendTx(cfg, cfg.pool, encodeFunctionData({
      abi: LENDING_POOL_ABI,
      functionName: "liquidate",
      args: [borrower, repay],
    }));
    log(`    liquidate tx=${hash}`);
  } catch (err) {
    console.error(`    liquidate failed:`, err instanceof Error ? err.message : err);
  }
}

// ─── Approvals ──────────────────────────────────────────────────────────

async function ensureApprovals(cfg: Config): Promise<void> {
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const allow = (await client.readContract({
    address: cfg.usdc, abi: ERC20_ABI, functionName: "allowance",
    args: [cfg.account.address, cfg.pool],
  })) as bigint;
  if (allow >= (1n << 200n)) return;
  log(`approving USDC -> LendingPool ${cfg.pool}`);
  if (cfg.dryRun) return;
  await sendTx(cfg, cfg.usdc, encodeFunctionData({
    abi: ERC20_ABI, functionName: "approve", args: [cfg.pool, MAX_UINT256],
  }));
}

// ─── Tx submission ──────────────────────────────────────────────────────

async function sendTx(cfg: Config, to: Address, data: Hex, value: bigint = 0n): Promise<Hex> {
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const gas = await client.estimateGas({ account: cfg.account.address, to, data, value });
  const gasPrice = await client.getGasPrice();
  const serialized = await cfg.account.signTransaction({
    chainId: arcTestnet.id,
    to,
    data,
    value,
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

// ─── Config / helpers ───────────────────────────────────────────────────

function loadConfig(): Config {
  const key = required("LENDING_KEEPER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("LENDING_KEEPER_PRIVATE_KEY must be a 32-byte hex string");
  }
  const account = privateKeyToAccount(key as Hex);
  const pythFeedId = required("LENDING_PYTH_BTC_USD_FEED");
  if (!/^0x[0-9a-fA-F]{64}$/.test(pythFeedId)) {
    throw new Error("LENDING_PYTH_BTC_USD_FEED must be a 32-byte hex");
  }
  return {
    account,
    pool: getAddress(required("LENDING_POOL")),
    pyth: getAddress(required("LENDING_PYTH_ADDRESS")),
    pythFeedId: pythFeedId as Hex,
    usdc: getAddress(required("LENDING_USDC_ADDRESS")),
    apiBaseUrl: (process.env.LENDING_KEEPER_API_BASE_URL ?? "https://app.disburse.online").replace(/\/$/, ""),
    hermesUrl: (process.env.LENDING_KEEPER_HERMES_URL ?? "https://hermes.pyth.network").replace(/\/$/, ""),
    pythPushIntervalMs: readNumber("LENDING_KEEPER_PYTH_INTERVAL_MS", 180_000),
    liquidationScanIntervalMs: readNumber("LENDING_KEEPER_SCAN_INTERVAL_MS", 30_000),
    loop: process.env.LENDING_KEEPER_LOOP === "1",
    dryRun: process.env.LENDING_KEEPER_DRY_RUN === "1",
  };
}

function required(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a finite number`);
  return n;
}

function formatWad(x: bigint): string {
  return (Number(x / 10n ** 14n) / 10_000).toFixed(4);
}

function fmtUsdc(x: bigint): string {
  return `$${(Number(x) / 1_000_000).toFixed(2)}`;
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

main().catch((err) => {
  console.error("keeper failed:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
