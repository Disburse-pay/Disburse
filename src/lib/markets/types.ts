/**
 * Domain types for the prediction-markets module.
 *
 * These mirror the off-chain Supabase schema and the on-chain Exchange
 * struct described in spec/psp-v1.1-markets.md (to be authored).
 *
 * v1 = binary YES/NO markets only. Shares and USDC use 1e6 fixed-point.
 */

import type { Address, Hex } from "viem";

export type Outcome = "YES" | "NO";

export type MarketStatus = "open" | "closed" | "resolved";

export type OrderSide = "BUY" | "SELL";

export type OrderStatus = "open" | "partial" | "filled" | "cancelled" | "expired";

export type Market = {
  id: string; // uuid
  onchainAddress: Address;
  question: string;
  description?: string;
  category: string;
  closesAt: string; // ISO-8601
  resolvesAt?: string; // ISO-8601, populated after resolution
  status: MarketStatus;
  winningOutcome?: Outcome;
  // Last-trade prices in 1e6 scale (1.00 USDC == 1_000_000). UI divides by 1e6.
  yesPriceMicros: number;
  noPriceMicros: number;
  // Total volume traded in USDC micros.
  volumeMicros: number;
  // Total open interest (shares minted but not redeemed) in 1e6 share units.
  openInterestMicros: number;
  metadataUri?: string;
  createdAt: string;
};

export type OrderbookLevel = {
  priceMicros: number;
  sizeMicros: number; // remaining size at this price
};

export type Orderbook = {
  marketId: string;
  outcome: Outcome;
  bids: OrderbookLevel[]; // sorted desc by price
  asks: OrderbookLevel[]; // sorted asc by price
};

export type Fill = {
  id: string;
  marketId: string;
  outcome: Outcome;
  priceMicros: number;
  sizeMicros: number;
  taker: Address;
  maker: Address;
  txHash: Hex;
  blockNumber: string;
  filledAt: string;
};

export type Position = {
  marketId: string;
  userAddress: Address;
  yesSharesMicros: number;
  noSharesMicros: number;
  costBasisMicros: number; // total USDC spent acquiring the position
  realizedPnlMicros: number;
};

export type SignedOrder = {
  maker: Address;
  market: Address;
  outcome: Outcome;
  side: OrderSide;
  priceMicros: number;
  sizeMicros: number;
  expiry: number; // unix seconds
  salt: string; // hex
  signature?: Hex; // populated after maker signs
};

export type Resolution = {
  marketId: string;
  winningOutcome: Outcome;
  resolvedBy: Address;
  txHash: Hex;
  resolvedAt: string;
};

export type MarketClaim = {
  id: string;
  marketId: string;
  userAddress: Address;
  outcome: Outcome;
  sharesMicros: number;
  payoutMicros: number;
  txHash: Hex;
  blockNumber: string;
  settlementId: Hex;
  pspUid?: string; // populated by PSP issuer after claim
  claimedAt: string;
};

// ---------- Display helpers ----------

const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

export function microsToUsdcString(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(micros);
  return `${sign}${(abs / USDC_SCALE).toFixed(2)}`;
}

// Compact human-readable USDC for grids and headers: 12_450 -> "12.5K".
// Sub-1000 values keep the dollar precision so "$5.00" still looks right.
export function microsToUsdcCompact(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(micros);
  const usd = abs / USDC_SCALE;
  if (usd >= 1_000_000) return `${sign}${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `${sign}${(usd / 1_000).toFixed(1)}K`;
  if (usd >= 100) return `${sign}${usd.toFixed(0)}`;
  return `${sign}${usd.toFixed(2)}`;
}

export function microsToProbability(priceMicros: number): number {
  return Math.max(0, Math.min(1, priceMicros / USDC_SCALE));
}

export function probabilityToPercent(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function microsToShares(micros: number): string {
  return (micros / USDC_SCALE).toFixed(2);
}

export function formatCloseCountdown(closesAt: string, now: Date = new Date()): string {
  const ms = new Date(closesAt).getTime() - now.getTime();
  if (ms <= 0) return "Closed";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
