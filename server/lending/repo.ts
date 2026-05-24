/**
 * Supabase-side persistence for the lending indexer + API handlers.
 *
 * Tables (see migrations/202605240001_lending.sql):
 *   lending_events           — append-only event log
 *   lending_positions        — per-user cached state
 *   lending_pool_snapshots   — periodic pool-wide snapshots
 *   lending_indexer_state    — single-row bookkeeping
 */
import type { Address, Hex } from "viem";
import { HttpError } from "../http.js";
import { getSupabaseAdmin } from "../supabase.js";

export type LendingEventRow = {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTime: Date;
  eventType: string;
  userAddress?: Address | null;
  relatedAddress?: Address | null;
  amountA?: bigint | null;
  amountB?: bigint | null;
  amountC?: bigint | null;
};

export type LendingPosition = {
  userAddress: Address;
  collateralAmount: bigint;
  scaledBorrow: bigint;
  cachedDebtUsdc: bigint;
  cachedCollateralUsdc: bigint;
  cachedHealthFactor: bigint | null;
  isLiquidatable: boolean;
  lastUpdatedBlock: bigint | null;
  lastUpdatedAt: string;
};

export type LendingPoolSnapshot = {
  blockNumber: bigint;
  observedAt?: Date;
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

// ─── Indexer state ───────────────────────────────────────────────────────

export async function getLastScannedBlock(): Promise<bigint> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lending_indexer_state")
    .select("last_scanned_block")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return BigInt(data?.last_scanned_block ?? 0);
}

export async function setLastScannedBlock(block: bigint): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("lending_indexer_state")
    .update({ last_scanned_block: block.toString(), last_run_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new HttpError(500, error.message);
}

// ─── Events ──────────────────────────────────────────────────────────────

/**
 * Insert events idempotently. Conflict on (tx_hash, log_index) is ignored
 * so the indexer can safely replay overlapping block ranges.
 */
export async function insertEvents(events: LendingEventRow[]): Promise<number> {
  if (events.length === 0) return 0;
  const supabase = getSupabaseAdmin();
  const rows = events.map((e) => ({
    tx_hash: e.txHash.toLowerCase(),
    log_index: e.logIndex,
    block_number: e.blockNumber.toString(),
    block_time: e.blockTime.toISOString(),
    event_type: e.eventType,
    user_address: e.userAddress ? e.userAddress.toLowerCase() : null,
    related_address: e.relatedAddress ? e.relatedAddress.toLowerCase() : null,
    amount_a: e.amountA?.toString() ?? null,
    amount_b: e.amountB?.toString() ?? null,
    amount_c: e.amountC?.toString() ?? null,
  }));
  const { error, count } = await supabase
    .from("lending_events")
    .upsert(rows, { onConflict: "tx_hash,log_index", ignoreDuplicates: true, count: "exact" });
  if (error) throw new HttpError(500, error.message);
  return count ?? 0;
}

export async function listRecentEvents(opts: { user?: string; limit?: number } = {}) {
  const supabase = getSupabaseAdmin();
  const limit = Math.min(opts.limit ?? 50, 200);
  let q = supabase
    .from("lending_events")
    .select("tx_hash,log_index,block_number,block_time,event_type,user_address,related_address,amount_a,amount_b,amount_c")
    .order("block_number", { ascending: false })
    .order("log_index", { ascending: false })
    .limit(limit);
  if (opts.user) q = q.or(`user_address.eq.${opts.user.toLowerCase()},related_address.eq.${opts.user.toLowerCase()}`);
  const { data, error } = await q;
  if (error) throw new HttpError(500, error.message);
  return data ?? [];
}

// ─── Positions ──────────────────────────────────────────────────────────

export async function upsertPosition(pos: LendingPosition): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("lending_positions").upsert(
    {
      user_address: pos.userAddress.toLowerCase(),
      collateral_amount: pos.collateralAmount.toString(),
      scaled_borrow: pos.scaledBorrow.toString(),
      cached_debt_usdc: pos.cachedDebtUsdc.toString(),
      cached_collateral_usdc: pos.cachedCollateralUsdc.toString(),
      cached_health_factor: pos.cachedHealthFactor?.toString() ?? null,
      is_liquidatable: pos.isLiquidatable,
      last_updated_block: pos.lastUpdatedBlock?.toString() ?? null,
      last_updated_at: pos.lastUpdatedAt,
    },
    { onConflict: "user_address" }
  );
  if (error) throw new HttpError(500, error.message);
}

export async function getPosition(user: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lending_positions")
    .select("*")
    .eq("user_address", user.toLowerCase())
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data;
}

export async function listAllPositions() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lending_positions")
    .select("user_address,collateral_amount,scaled_borrow,cached_debt_usdc,cached_collateral_usdc,cached_health_factor,is_liquidatable,last_updated_at")
    .order("cached_health_factor", { ascending: true, nullsFirst: false });
  if (error) throw new HttpError(500, error.message);
  return data ?? [];
}

export async function listLiquidatable() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lending_positions")
    .select("user_address,collateral_amount,scaled_borrow,cached_debt_usdc,cached_collateral_usdc,cached_health_factor")
    .eq("is_liquidatable", true);
  if (error) throw new HttpError(500, error.message);
  return data ?? [];
}

// ─── Pool snapshots ─────────────────────────────────────────────────────

export async function insertPoolSnapshot(s: LendingPoolSnapshot): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("lending_pool_snapshots").insert({
    block_number: s.blockNumber.toString(),
    observed_at: (s.observedAt ?? new Date()).toISOString(),
    cash_usdc: s.cashUsdc.toString(),
    total_borrows_usdc: s.totalBorrowsUsdc.toString(),
    total_reserves_usdc: s.totalReservesUsdc.toString(),
    supply_index: s.supplyIndex.toString(),
    borrow_index: s.borrowIndex.toString(),
    utilization_wad: s.utilizationWad.toString(),
    borrow_apr_wad: s.borrowAprWad.toString(),
    supply_apr_wad: s.supplyAprWad.toString(),
    btc_price_wad: s.btcPriceWad?.toString() ?? null,
  });
  if (error) throw new HttpError(500, error.message);
}

export async function getLatestPoolSnapshot() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lending_pool_snapshots")
    .select("*")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data;
}
