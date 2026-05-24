/**
 * Domain types for the lending UI. Wire shapes use string for big numbers
 * (since JSON can't carry bigint); types here use `bigint` so component
 * arithmetic doesn't lose precision.
 */
import type { Address, Hex } from "viem";

export type LendingPoolSnapshot = {
  blockNumber: bigint;
  observedAt: string;
  cashUsdc: bigint;
  totalBorrowsUsdc: bigint;
  totalReservesUsdc: bigint;
  supplyIndex: bigint;
  borrowIndex: bigint;
  utilizationWad: bigint;
  borrowAprWad: bigint;
  supplyAprWad: bigint;
  btcPriceWad: bigint | null;
};

export type LendingPosition = {
  userAddress: Address;
  collateralAmount: bigint;          // cirBTC raw (8 decimals)
  scaledBorrow: bigint;
  cachedDebtUsdc: bigint;            // 6 decimals
  cachedCollateralUsdc: bigint;      // 6 decimals
  cachedHealthFactor: bigint | null; // 1e18; null = no debt OR oracle stale
  isLiquidatable: boolean;
  lastUpdatedBlock: bigint | null;
  lastUpdatedAt: string;
};

export type LendingEvent = {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTime: string;
  eventType:
    | "Deposited"
    | "Withdrew"
    | "CollateralDeposited"
    | "CollateralWithdrew"
    | "Borrowed"
    | "Repaid"
    | "Liquidated"
    | "ReservesWithdrawn"
    | string;
  userAddress: Address | null;
  relatedAddress: Address | null;
  amountA: bigint | null;
  amountB: bigint | null;
  amountC: bigint | null;
};

/// Pool's MAX_LTV_BPS (= 8000). Mirrored client-side for the borrow form's
/// "max you can borrow" hint without making an extra view call.
export const LENDING_MAX_LTV_BPS = 8_000n;
/// LIQUIDATION_THRESHOLD_BPS (= 9000). HF goes < 1 above this.
export const LENDING_LIQ_THRESHOLD_BPS = 9_000n;
/// Reserve factor used by the IRM when computing supply APR (= 1000).
export const LENDING_RESERVE_FACTOR_BPS = 1_000n;
/// cirBTC has 8 decimals; constant rather than reading from chain.
export const CIRBTC_DECIMALS = 8;
/// USDC has 6 decimals.
export const USDC_DECIMALS = 6;
export const WAD = 10n ** 18n;

// ─── Formatters ─────────────────────────────────────────────────────────

export function formatUsdc(usdc6: bigint, fractionDigits = 2): string {
  const n = Number(usdc6) / 10 ** USDC_DECIMALS;
  return n.toLocaleString(undefined, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

export function formatCirBtc(amount8: bigint, fractionDigits = 6): string {
  const n = Number(amount8) / 10 ** CIRBTC_DECIMALS;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: fractionDigits });
}

export function formatApr(rateWad: bigint): string {
  const pct = (Number(rateWad) / 1e18) * 100;
  return `${pct.toFixed(2)}%`;
}

export function formatHealthFactor(hf: bigint | null): string {
  if (hf === null) return "—";
  if (hf >= 1_000n * WAD) return "∞"; // type(uint256).max territory
  const f = Number(hf) / 1e18;
  return f.toFixed(2);
}

export function parseUsdcInput(input: string): bigint {
  if (!input.trim()) return 0n;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) throw new Error("Enter a non-negative USDC amount");
  return BigInt(Math.floor(n * 10 ** USDC_DECIMALS));
}

export function parseCirBtcInput(input: string): bigint {
  if (!input.trim()) return 0n;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) throw new Error("Enter a non-negative cirBTC amount");
  return BigInt(Math.floor(n * 10 ** CIRBTC_DECIMALS));
}
