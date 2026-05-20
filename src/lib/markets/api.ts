/**
 * Browser-side fetch helpers for the markets backend.
 *
 * Every server response that contains 1e6-scale fixed-point numbers ships them
 * as decimal strings (because JSON doesn't have a bigint type). The wire
 * shapes below name those fields `*Wire` so the boundary is obvious; the
 * helpers here convert to the `number`-based domain types in `./types`.
 *
 * Errors are surfaced as thrown `MarketsApiError` — callers wrap with
 * try/catch and render the message. Per CLAUDE.md Rule 12 (fail loud), a
 * non-2xx response is never swallowed.
 */

import type { Address, Hex } from "viem";
import { getSupabaseBrowserClient } from "../supabaseClient";
import type {
  Fill,
  Market,
  MarketClaim,
  MarketStatus,
  Orderbook,
  OrderbookLevel,
  Outcome,
  Position
} from "./types";

// ---------- error type ----------

export class MarketsApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "MarketsApiError";
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON body: still surface the raw text below.
    }
  }
  if (!response.ok) {
    const message =
      (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : text) || `Request failed with ${response.status}`;
    throw new MarketsApiError(response.status, message);
  }
  return body as T;
}

// ---------- markets list / detail ----------

/**
 * GET /api/markets
 *
 * The server response is `{ markets: Market[] }` with every fixed-point field
 * already numeric (the markets table stores micros as bigint columns but
 * `getMarketById` casts them on read). We pass it straight through.
 */
export async function fetchMarkets(options?: { status?: MarketStatus }): Promise<Market[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  const q = params.toString();
  const result = await fetchJson<{ markets: Market[] }>(`/api/markets${q ? `?${q}` : ""}`);
  return result.markets;
}

export async function fetchMarketDetail(id: string): Promise<{
  market: Market;
  /** Raw open orders — pre-aggregation. Use `aggregateOrderbook` to fold. */
  rawOrders: RawOpenOrder[];
}> {
  const result = await fetchJson<{ market: Market; orderbook: RawOpenOrderWire[] }>(
    `/api/markets-detail?id=${encodeURIComponent(id)}`
  );
  return { market: result.market, rawOrders: result.orderbook.map(rawOrderFromWire) };
}

// `markets-detail` returns ALL open orders (both outcomes, both sides) so the
// caller can render two orderbooks from one round-trip and keep them in sync.
type RawOpenOrderWire = Omit<RawOpenOrder, "expiry"> & {
  expiry: number | string;
};

export type RawOpenOrder = {
  hash: Hex;
  maker: Address;
  outcome: 0 | 1;
  side: 0 | 1;
  price: string;
  size: string;
  filled: string;
  expiry: number;
  /** uint256 nonce as a decimal string. Required to reconstruct the Order tuple for fillOrder. */
  salt: string;
  /** Maker's EIP-712 signature. Public — every taker reads this to fill on-chain. */
  signature: Hex;
  status: "open" | "partial" | "filled" | "cancelled" | "expired";
  createdAt: string;
};

function rawOrderFromWire(order: RawOpenOrderWire): RawOpenOrder {
  const expiry =
    typeof order.expiry === "number"
      ? order.expiry
      : Math.floor(new Date(order.expiry).getTime() / 1000);
  return {
    ...order,
    price: String(order.price),
    size: String(order.size),
    filled: String(order.filled),
    salt: String(order.salt),
    expiry: Number.isFinite(expiry) ? expiry : 0
  };
}

// ---------- orderbook ----------

/**
 * Aggregate raw orders into the price-level depth structure the UI renders.
 * Filters to one outcome; sums (size − filled) per price level; sorts bids
 * descending and asks ascending. Matches the server's
 * `/api/markets-orderbook` aggregation exactly so we can use this either
 * client-side from `markets-detail` data or to convert server depth.
 */
export function aggregateOrderbook(
  rawOrders: RawOpenOrder[],
  marketId: string,
  outcome: Outcome
): Orderbook {
  const outcomeInt = outcome === "YES" ? 1 : 0;
  const bidLevels = new Map<number, number>();
  const askLevels = new Map<number, number>();
  const nowSec = Math.floor(Date.now() / 1000);
  for (const o of rawOrders) {
    if (o.outcome !== outcomeInt) continue;
    if (o.status !== "open" && o.status !== "partial") continue;
    if (o.expiry <= nowSec) continue;
    const remaining = BigInt(o.size) - BigInt(o.filled);
    if (remaining <= 0n) continue;
    // 1e6-scale fits comfortably in Number for both price and size as long as
    // we're below ~9e15 — true for any realistic share count in v1.
    const remainingNum = Number(remaining);
    const priceNum = Number(o.price);
    const map = o.side === 0 ? bidLevels : askLevels;
    map.set(priceNum, (map.get(priceNum) ?? 0) + remainingNum);
  }
  const bids: OrderbookLevel[] = Array.from(bidLevels.entries())
    .map(([priceMicros, sizeMicros]) => ({ priceMicros, sizeMicros }))
    .sort((a, b) => b.priceMicros - a.priceMicros);
  const asks: OrderbookLevel[] = Array.from(askLevels.entries())
    .map(([priceMicros, sizeMicros]) => ({ priceMicros, sizeMicros }))
    .sort((a, b) => a.priceMicros - b.priceMicros);
  return { marketId, outcome, bids, asks };
}

/**
 * GET /api/markets-orderbook?marketId=&outcome=
 *
 * Server returns already-aggregated depth — preferred for cold loads where
 * we don't need the full order list. For pages that subscribe to realtime
 * orders, use `fetchMarketDetail` + `aggregateOrderbook` so the client can
 * fold incoming events without a round-trip.
 */
export async function fetchOrderbook(marketId: string, outcome: Outcome): Promise<Orderbook> {
  const outcomeInt = outcome === "YES" ? 1 : 0;
  const result = await fetchJson<{
    marketId: string;
    outcome: 0 | 1;
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
  }>(`/api/markets-orderbook?marketId=${encodeURIComponent(marketId)}&outcome=${outcomeInt}`);
  return {
    marketId,
    outcome,
    bids: result.bids.map((r) => ({ priceMicros: Number(r.price), sizeMicros: Number(r.size) })),
    asks: result.asks.map((r) => ({ priceMicros: Number(r.price), sizeMicros: Number(r.size) }))
  };
}

// ---------- fills ----------

type FillWire = {
  id: string;
  marketId: string;
  orderHash: Hex;
  taker: Address;
  maker: Address;
  outcome: 0 | 1;
  side: 0 | 1;
  price: string;
  size: string;
  totalUsdc: string;
  txHash: Hex;
  blockNumber: string;
  filledAt: string;
};

/**
 * GET /api/markets-fills?marketId=&limit=
 *
 * Returned in descending `filled_at` order — newest first. The PriceChart
 * component sorts ascending again before rendering; the trade tape uses the
 * raw newest-first order.
 */
export async function fetchFills(marketId: string, limit = 100): Promise<Fill[]> {
  const result = await fetchJson<{ fills: FillWire[] }>(
    `/api/markets-fills?marketId=${encodeURIComponent(marketId)}&limit=${limit}`
  );
  return result.fills.map(fillFromWire);
}

function fillFromWire(w: FillWire): Fill {
  return {
    id: w.id,
    marketId: w.marketId,
    outcome: w.outcome === 1 ? "YES" : "NO",
    priceMicros: Number(w.price),
    sizeMicros: Number(w.size),
    taker: w.taker,
    maker: w.maker,
    txHash: w.txHash,
    blockNumber: w.blockNumber,
    filledAt: w.filledAt
  };
}

/**
 * POST /api/markets-fills with `{ txHash }` — indexes every Filled event in
 * the tx. Used after a taker submits an on-chain fill so the indexer doesn't
 * have to wait for a poll cycle.
 */
export async function indexFillsTx(txHash: Hex): Promise<{ insertedCount: number }> {
  const result = await fetchJson<{ insertedCount: number }>("/api/markets-fills", {
    method: "POST",
    body: JSON.stringify({ txHash })
  });
  return { insertedCount: result.insertedCount };
}

// ---------- user fills (portfolio volume) ----------

type MyFillWire = {
  marketId: string;
  outcome: number;
  side: number;
  price: string;
  size: string;
  totalUsdc: string;
  filledAt: string;
};

export type MyFill = {
  marketId: string;
  outcome: number;
  side: number;
  priceMicros: number;
  sizeMicros: number;
  totalUsdcMicros: number;
  filledAt: string;
};

/**
 * GET /api/markets-my-fills?address=0x...
 *
 * Returns all fills where the user is taker or maker. Used by the portfolio
 * dashboard to compute total volume traded.
 */
export async function fetchMyFills(address: Address): Promise<MyFill[]> {
  const result = await fetchJson<{ fills: MyFillWire[] }>(
    `/api/markets-my-fills?address=${encodeURIComponent(address)}`
  );
  return result.fills.map((f) => ({
    marketId: f.marketId,
    outcome: f.outcome,
    side: f.side,
    priceMicros: Number(f.price),
    sizeMicros: Number(f.size),
    totalUsdcMicros: Number(f.totalUsdc),
    filledAt: f.filledAt,
  }));
}

// ---------- orders (post a signed maker order) ----------

export type WireOrder = {
  maker: Address;
  market: Address;
  outcome: 0 | 1;
  side: 0 | 1;
  /** All bigint-sized fields are decimal strings on the wire. */
  price: string;
  size: string;
  expiry: string;
  salt: string;
  signature: Hex;
};

/**
 * POST /api/markets-orders
 *
 * Submits a maker-signed Order. Server verifies the EIP-712 signature against
 * the Exchange domain and persists. Returns the order hash so the client can
 * track its lifecycle via realtime.
 */
export async function postSignedOrder(order: WireOrder): Promise<{ hash: Hex; status: "open" }> {
  return fetchJson<{ hash: Hex; status: "open" }>("/api/markets-orders", {
    method: "POST",
    body: JSON.stringify(order)
  });
}

// ---------- positions ----------

type PositionWire = {
  userAddress: Address;
  marketId: string;
  yesShares: string;
  noShares: string;
  costBasis: string;
  realizedPnl: string;
  updatedAt: string;
};

export async function fetchPositions(address: Address): Promise<Position[]> {
  const result = await fetchJson<{ positions: PositionWire[] }>(
    `/api/markets-positions?address=${encodeURIComponent(address)}`
  );
  return result.positions.map((p) => ({
    userAddress: p.userAddress,
    marketId: p.marketId,
    yesSharesMicros: Number(p.yesShares),
    noSharesMicros: Number(p.noShares),
    costBasisMicros: Number(p.costBasis),
    realizedPnlMicros: Number(p.realizedPnl)
  }));
}

// ---------- claims ----------

type ClaimWire = {
  id: string;
  marketId: string;
  userAddress: Address;
  outcome: "YES" | "NO";
  sharesMicros: string;
  payoutMicros: string;
  txHash: Hex;
  blockNumber: string;
  settlementId: Hex;
  pspUid?: string;
  claimedAt: string;
};

/**
 * POST /api/markets-claims with `{ marketId, txHash }`. Server fetches the
 * receipt, decodes MarketClaimed, persists the row, and (if ENABLE_PSP=1)
 * fires PSP issuance. Returns the claim with `pspUid` populated when the
 * PSP exists.
 *
 * Idempotent — re-POSTing the same txHash returns the cached row.
 */
export async function recordClaim(input: {
  marketId: string;
  txHash: Hex;
}): Promise<{ claim: ReturnType<typeof claimFromWire>; pspUid?: string; isNew: boolean }> {
  const result = await fetchJson<{ claim: ClaimWire; pspUid?: string; isNew: boolean }>(
    "/api/markets-claims",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
  return { claim: claimFromWire(result.claim), pspUid: result.pspUid, isNew: result.isNew };
}

function claimFromWire(w: ClaimWire): MarketClaim {
  return {
    id: w.id,
    marketId: w.marketId,
    userAddress: w.userAddress,
    outcome: w.outcome,
    sharesMicros: Number(w.sharesMicros),
    payoutMicros: Number(w.payoutMicros),
    txHash: w.txHash,
    blockNumber: w.blockNumber,
    settlementId: w.settlementId,
    pspUid: w.pspUid,
    claimedAt: w.claimedAt
  };
}

/**
 * Cold-load the user's claim history via direct Supabase select. The table's
 * RLS policy grants anon read access, so this works from the browser without
 * an additional API endpoint. Realtime updates are wired separately via
 * `subscribeMyClaims`.
 *
 * Returns claims newest-first.
 */
export async function fetchMyClaims(account: Address): Promise<MarketClaim[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("market_claims")
    .select(
      "id,market_id,user_address,outcome,shares,payout,tx_hash,block_number,settlement_id,psp_uid,claimed_at"
    )
    .eq("user_address", account.toLowerCase())
    .order("claimed_at", { ascending: false });
  if (error) {
    throw new MarketsApiError(500, error.message);
  }
  return (data ?? []).map((row): MarketClaim => ({
    id: row.id,
    marketId: row.market_id,
    userAddress: row.user_address as Address,
    outcome: row.outcome === 1 ? "YES" : "NO",
    sharesMicros: Number(row.shares),
    payoutMicros: Number(row.payout),
    txHash: row.tx_hash as Hex,
    blockNumber: row.block_number,
    settlementId: row.settlement_id as Hex,
    pspUid: row.psp_uid ?? undefined,
    claimedAt: row.claimed_at
  }));
}
