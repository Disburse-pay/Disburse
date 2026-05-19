/**
 * Markets — Supabase repository
 *
 * Typed wrappers around the prediction-markets tables in Supabase. Keeps
 * SQL/column-mapping out of API handlers and indexers — they consume domain
 * types from `src/lib/markets/types.ts`.
 *
 * Convention: snake_case in DB, camelCase in the app. Mapping happens at
 * exactly one boundary (this file), so callers never see snake_case.
 */

import type { Address, Hex } from "viem";
import { HttpError } from "../http.js";
import { getSupabaseAdmin } from "../supabase.js";
import type {
  Market,
  MarketClaim,
  MarketStatus,
  Outcome,
  OrderSide,
  OrderStatus,
} from "../../src/lib/markets/types.js";

// ---------- Outcome <-> smallint conversion ----------

export function outcomeFromInt(n: number): Outcome {
  return n === 1 ? "YES" : "NO";
}

export function outcomeToInt(o: Outcome): 0 | 1 {
  return o === "YES" ? 1 : 0;
}

export function sideFromInt(n: number): OrderSide {
  return n === 1 ? "SELL" : "BUY";
}

export function sideToInt(s: OrderSide): 0 | 1 {
  return s === "SELL" ? 1 : 0;
}

// ---------- Market row mapping ----------

type MarketRow = {
  id: string;
  onchain_address: string;
  question: string;
  description: string | null;
  category: string;
  closes_at: string;
  resolves_at: string | null;
  status: MarketStatus;
  winning_outcome: number | null;
  metadata_uri: string | null;
  created_at: string;
  created_by: string | null;
  // Aggregated price/volume columns are computed via views or RPC in v2;
  // for now these are zero placeholders until indexers populate them.
};

function rowToMarket(row: MarketRow): Market {
  return {
    id: row.id,
    onchainAddress: row.onchain_address as Address,
    question: row.question,
    description: row.description ?? undefined,
    category: row.category,
    closesAt: row.closes_at,
    resolvesAt: row.resolves_at ?? undefined,
    status: row.status,
    winningOutcome:
      row.winning_outcome === null ? undefined : outcomeFromInt(row.winning_outcome),
    // The schema doesn't aggregate these — UI fills via separate queries.
    // Zero defaults keep the `Market` type total without forcing every caller
    // to backfill them.
    yesPriceMicros: 0,
    noPriceMicros: 0,
    volumeMicros: 0,
    openInterestMicros: 0,
    metadataUri: row.metadata_uri ?? undefined,
    createdAt: row.created_at,
  };
}

export async function listMarkets(options?: {
  status?: MarketStatus;
  limit?: number;
}): Promise<Market[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("markets")
    .select(
      "id,onchain_address,question,description,category,closes_at,resolves_at,status,winning_outcome,metadata_uri,created_at,created_by"
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(options?.limit ?? 100, 500));

  if (options?.status) {
    q = q.eq("status", options.status);
  }

  const { data, error } = await q;
  if (error) throw new HttpError(500, error.message);
  return (data ?? []).map(rowToMarket);
}

export async function getMarketById(id: string): Promise<Market | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("markets")
    .select(
      "id,onchain_address,question,description,category,closes_at,resolves_at,status,winning_outcome,metadata_uri,created_at,created_by"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data ? rowToMarket(data as MarketRow) : null;
}

export async function getMarketByAddress(
  address: Address
): Promise<Market | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("markets")
    .select(
      "id,onchain_address,question,description,category,closes_at,resolves_at,status,winning_outcome,metadata_uri,created_at,created_by"
    )
    .ilike("onchain_address", address)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data ? rowToMarket(data as MarketRow) : null;
}

export type InsertMarketInput = {
  id: string;
  onchainAddress: Address;
  question: string;
  description?: string;
  category?: string;
  closesAt: string;
  metadataUri?: string;
  createdBy?: Address;
};

export async function insertMarket(input: InsertMarketInput): Promise<Market> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("markets")
    .insert({
      id: input.id,
      onchain_address: input.onchainAddress.toLowerCase(),
      question: input.question,
      description: input.description ?? null,
      category: input.category ?? "General",
      closes_at: input.closesAt,
      status: "open",
      metadata_uri: input.metadataUri ?? null,
      created_by: input.createdBy?.toLowerCase() ?? null,
    })
    .select(
      "id,onchain_address,question,description,category,closes_at,resolves_at,status,winning_outcome,metadata_uri,created_at,created_by"
    )
    .single();
  if (error) throw new HttpError(500, error.message);
  return rowToMarket(data as MarketRow);
}

export async function setMarketResolved(
  marketId: string,
  winningOutcome: Outcome,
  resolverAddress: Address,
  txHash: Hex,
  resolvedAt: string
): Promise<Market> {
  const supabase = getSupabaseAdmin();

  // Update the markets row.
  const { data, error } = await supabase
    .from("markets")
    .update({
      status: "resolved",
      winning_outcome: outcomeToInt(winningOutcome),
      resolves_at: resolvedAt,
    })
    .eq("id", marketId)
    .select(
      "id,onchain_address,question,description,category,closes_at,resolves_at,status,winning_outcome,metadata_uri,created_at,created_by"
    )
    .single();
  if (error) throw new HttpError(500, error.message);

  // Insert the matching resolution row (idempotent on PK = market_id).
  const { error: resErr } = await supabase
    .from("market_resolutions")
    .upsert(
      {
        market_id: marketId,
        winning_outcome: outcomeToInt(winningOutcome),
        resolved_by: resolverAddress.toLowerCase(),
        tx_hash: txHash.toLowerCase(),
        resolved_at: resolvedAt,
      },
      { onConflict: "market_id" }
    );
  if (resErr) throw new HttpError(500, resErr.message);

  return rowToMarket(data as MarketRow);
}

// ---------- Order rows ----------

export type InsertOrderInput = {
  hash: Hex;
  marketId: string;
  maker: Address;
  outcome: 0 | 1;
  side: 0 | 1;
  price: bigint;
  size: bigint;
  expiry: bigint;
  salt: bigint;
  signature: Hex;
};

export async function insertOrder(input: InsertOrderInput): Promise<void> {
  const supabase = getSupabaseAdmin();
  // Idempotent on PK = hash. Re-posting the same signed order is a no-op.
  const { error } = await supabase.from("market_orders").upsert(
    {
      hash: input.hash.toLowerCase(),
      market_id: input.marketId,
      maker: input.maker.toLowerCase(),
      outcome: input.outcome,
      side: input.side,
      price: Number(input.price),
      size: input.size.toString(),
      filled: 0,
      expiry: new Date(Number(input.expiry) * 1000).toISOString(),
      salt: input.salt.toString(16).startsWith("0x")
        ? input.salt.toString(16)
        : `0x${input.salt.toString(16)}`,
      signature: input.signature.toLowerCase(),
      status: "open",
    },
    { onConflict: "hash" }
  );
  if (error) throw new HttpError(500, error.message);
}

export type OrderbookRow = {
  hash: Hex;
  maker: Address;
  outcome: 0 | 1;
  side: 0 | 1;
  price: bigint;
  size: bigint;
  filled: bigint;
  expiry: string;
  /** Maker-chosen nonce (hex string in DB; bigint here). Required to reconstruct the Order tuple for fillOrder. */
  salt: bigint;
  signature: Hex;
  status: OrderStatus;
  createdAt: string;
};

type DbOrderRow = {
  hash: string;
  maker: string;
  outcome: number;
  side: number;
  price: number;
  size: string;
  filled: string;
  expiry: string;
  salt: string;
  signature: string;
  status: OrderStatus;
  created_at: string;
};

function rowToOrder(row: DbOrderRow): OrderbookRow {
  // salt is stored as a hex string with `0x` prefix; BigInt() handles either form.
  return {
    hash: row.hash as Hex,
    maker: row.maker as Address,
    outcome: (row.outcome === 1 ? 1 : 0) as 0 | 1,
    side: (row.side === 1 ? 1 : 0) as 0 | 1,
    price: BigInt(row.price),
    size: BigInt(row.size),
    filled: BigInt(row.filled),
    expiry: row.expiry,
    salt: BigInt(row.salt),
    signature: row.signature as Hex,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function getOpenOrdersForMarket(
  marketId: string,
  outcome?: 0 | 1,
  side?: 0 | 1
): Promise<OrderbookRow[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("market_orders")
    .select(
      "hash,maker,outcome,side,price,size,filled,expiry,salt,signature,status,created_at"
    )
    .eq("market_id", marketId)
    .in("status", ["open", "partial"]);
  if (outcome !== undefined) q = q.eq("outcome", outcome);
  if (side !== undefined) q = q.eq("side", side);
  const { data, error } = await q;
  if (error) throw new HttpError(500, error.message);
  return (data ?? []).map((r) => rowToOrder(r as DbOrderRow));
}

export async function getOrderByHash(hash: Hex): Promise<OrderbookRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("market_orders")
    .select(
      "hash,maker,outcome,side,price,size,filled,expiry,salt,signature,status,created_at"
    )
    .eq("hash", hash.toLowerCase())
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data ? rowToOrder(data as DbOrderRow) : null;
}

export async function applyFillToOrder(
  hash: Hex,
  newFilled: bigint,
  size: bigint
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const status: OrderStatus = newFilled >= size ? "filled" : "partial";
  const { error } = await supabase
    .from("market_orders")
    .update({ filled: newFilled.toString(), status })
    .eq("hash", hash.toLowerCase());
  if (error) throw new HttpError(500, error.message);
}

export async function cancelOrderRow(hash: Hex): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("market_orders")
    .update({ status: "cancelled" })
    .eq("hash", hash.toLowerCase());
  if (error) throw new HttpError(500, error.message);
}

export async function expireOpenOrders(now = new Date()): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("market_orders")
    .update({ status: "expired" })
    .in("status", ["open", "partial"])
    .lte("expiry", now.toISOString())
    .select("hash");
  if (error) throw new HttpError(500, error.message);
  return Array.isArray(data) ? data.length : 0;
}

// ---------- Fills ----------

export type InsertFillInput = {
  marketId: string;
  orderHash: Hex;
  taker: Address;
  maker: Address;
  outcome: 0 | 1;
  side: 0 | 1;
  price: bigint;
  size: bigint;
  totalUsdc: bigint;
  txHash: Hex;
  blockNumber: string;
};

export async function insertFill(input: InsertFillInput): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  // Idempotent on (tx_hash, order_hash, size) — re-indexing the same Filled
  // event is a no-op. The unique index in the migration matches this triplet.
  const { data, error } = await supabase
    .from("market_fills")
    .upsert(
      {
        market_id: input.marketId,
        order_hash: input.orderHash.toLowerCase(),
        taker: input.taker.toLowerCase(),
        maker: input.maker.toLowerCase(),
        outcome: input.outcome,
        side: input.side,
        price: Number(input.price),
        size: input.size.toString(),
        total_usdc: input.totalUsdc.toString(),
        tx_hash: input.txHash.toLowerCase(),
        block_number: input.blockNumber,
      },
      { onConflict: "tx_hash,order_hash,size", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw new HttpError(500, error.message);
  return Array.isArray(data) && data.length > 0;
}

export type ApplyPositionDeltaInput = {
  marketId: string;
  userAddress: Address;
  outcome: 0 | 1;
  shareDelta: bigint;
  costBasisDelta?: bigint;
  realizedPnlDelta?: bigint;
};

export async function applyPositionDelta(
  input: ApplyPositionDeltaInput
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("apply_market_position_delta", {
    p_market_id: input.marketId,
    p_user_address: input.userAddress.toLowerCase(),
    p_outcome: input.outcome,
    p_share_delta: input.shareDelta.toString(),
    p_cost_basis_delta: (input.costBasisDelta ?? 0n).toString(),
    p_realized_pnl_delta: (input.realizedPnlDelta ?? 0n).toString(),
  });
  if (error) throw new HttpError(500, error.message);
}

// ---------- Claims ----------

type MarketClaimRow = {
  id: string;
  market_id: string;
  user_address: string;
  outcome: number;
  shares: string;
  payout: string;
  tx_hash: string;
  block_number: string;
  settlement_id: string;
  psp_uid: string | null;
  claimed_at: string;
};

function rowToClaim(row: MarketClaimRow): MarketClaim {
  return {
    id: row.id,
    marketId: row.market_id,
    userAddress: row.user_address as Address,
    outcome: outcomeFromInt(row.outcome),
    sharesMicros: Number(row.shares),
    payoutMicros: Number(row.payout),
    txHash: row.tx_hash as Hex,
    blockNumber: row.block_number,
    settlementId: row.settlement_id as Hex,
    pspUid: row.psp_uid ?? undefined,
    claimedAt: row.claimed_at,
  };
}

export type InsertClaimInput = {
  marketId: string;
  userAddress: Address;
  outcome: 0 | 1;
  shares: bigint;
  payout: bigint;
  txHash: Hex;
  blockNumber: string;
  settlementId: Hex;
};

/**
 * Insert a claim row. Idempotent on `tx_hash` (the schema's unique index) —
 * re-indexing the same MarketClaimed event returns the existing row instead
 * of erroring.
 */
export async function insertClaim(input: InsertClaimInput): Promise<MarketClaim> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("market_claims")
    .upsert(
      {
        market_id: input.marketId,
        user_address: input.userAddress.toLowerCase(),
        outcome: input.outcome,
        shares: input.shares.toString(),
        payout: input.payout.toString(),
        tx_hash: input.txHash.toLowerCase(),
        block_number: input.blockNumber,
        settlement_id: input.settlementId.toLowerCase(),
      },
      { onConflict: "tx_hash" }
    )
    .select(
      "id,market_id,user_address,outcome,shares,payout,tx_hash,block_number,settlement_id,psp_uid,claimed_at"
    )
    .single();
  if (error) throw new HttpError(500, error.message);
  return rowToClaim(data as MarketClaimRow);
}

export async function getClaimByTxHash(txHash: Hex): Promise<MarketClaim | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("market_claims")
    .select(
      "id,market_id,user_address,outcome,shares,payout,tx_hash,block_number,settlement_id,psp_uid,claimed_at"
    )
    .eq("tx_hash", txHash.toLowerCase())
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data ? rowToClaim(data as MarketClaimRow) : null;
}

export async function getClaimsByUser(
  userAddress: Address,
  limit = 100
): Promise<MarketClaim[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("market_claims")
    .select(
      "id,market_id,user_address,outcome,shares,payout,tx_hash,block_number,settlement_id,psp_uid,claimed_at"
    )
    .eq("user_address", userAddress.toLowerCase())
    .order("claimed_at", { ascending: false })
    .limit(Math.min(limit, 500));
  if (error) throw new HttpError(500, error.message);
  return (data ?? []).map((r) => rowToClaim(r as MarketClaimRow));
}
