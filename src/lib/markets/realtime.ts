/**
 * Supabase realtime subscriptions for the markets tables.
 *
 * Mirrors the pattern in `../realtime.ts` (QR payments): each helper subscribes
 * to a single channel filtered by id/address, decodes the row payload into the
 * domain type the UI uses, and returns an `unsubscribe()` function.
 *
 * Cold reads still go through `./api.ts`; realtime is only for diffs between
 * snapshots. If the channel disconnects, the page should refetch.
 *
 * Schemas come from `supabase/migrations/202605200001_prediction_markets.sql`.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Address, Hex } from "viem";
import { getSupabaseBrowserClient } from "../supabaseClient";
import type { Fill, Position } from "./types";
import type { RawOpenOrder } from "./api";

// ---------- shared types ----------

type Unsubscribe = () => void;
type ChangeKind = "INSERT" | "UPDATE" | "DELETE";

// supabase-js doesn't export a precise payload type for the postgres-changes
// event, so we narrow at the boundary.
type PgChangesPayload<T> = {
  eventType: ChangeKind;
  new: T | null;
  old: T | null;
};

/**
 * Returns an `unsubscribe` that's a no-op when the browser client isn't
 * configured (anon key missing). This keeps the call sites simple — they
 * always get a cleanup function to wire into useEffect.
 */
const NOOP: Unsubscribe = () => {};

// ---------- market_orders ----------

type OrderRow = {
  hash: string;
  market_id: string;
  maker: string;
  outcome: 0 | 1;
  side: 0 | 1;
  price: number | string; // bigint columns arrive as numbers OR strings depending on size; coerce.
  size: string;
  filled: string;
  expiry: string;
  salt: string;
  signature: string;
  status: "open" | "partial" | "filled" | "cancelled" | "expired";
  created_at: string;
};

function orderRowToDomain(row: OrderRow): RawOpenOrder {
  // salt arrives as a hex string ("0x..."); the wire format expects decimal,
  // so coerce via BigInt. Empty/missing salts fall back to "0" so a malformed
  // row doesn't crash the subscriber.
  const saltDecimal = row.salt ? BigInt(row.salt).toString() : "0";
  return {
    hash: row.hash as Hex,
    maker: row.maker as Address,
    outcome: row.outcome,
    side: row.side,
    price: String(row.price),
    size: String(row.size),
    filled: String(row.filled),
    expiry: Math.floor(new Date(row.expiry).getTime() / 1000),
    salt: saltDecimal,
    signature: row.signature as Hex,
    status: row.status,
    createdAt: row.created_at
  };
}

export type OrderChange = {
  kind: ChangeKind;
  order: RawOpenOrder;
};

/**
 * Subscribe to order-row changes for one market. Emits INSERTs (new orders),
 * UPDATEs (partial fills, cancellations, expirations), and DELETEs. The
 * orderbook depth aggregator in `./api.ts` handles all three by recomputing
 * from the up-to-date list.
 */
export function subscribeMarketOrders(
  marketId: string,
  onChange: (change: OrderChange) => void
): Unsubscribe {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return NOOP;
  const channel: RealtimeChannel = supabase
    .channel(`markets:orders:${marketId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "market_orders",
        filter: `market_id=eq.${marketId}`
      },
      (payload) => {
        const p = payload as unknown as PgChangesPayload<OrderRow>;
        const row = p.new ?? p.old;
        if (!row) return;
        onChange({ kind: p.eventType, order: orderRowToDomain(row) });
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ---------- market_fills ----------

type FillRow = {
  id: number | string;
  market_id: string;
  order_hash: string;
  taker: string;
  maker: string;
  outcome: 0 | 1;
  side: 0 | 1;
  price: number | string;
  size: string;
  total_usdc: string;
  tx_hash: string;
  block_number: string;
  filled_at: string;
};

function fillRowToDomain(row: FillRow): Fill {
  return {
    id: String(row.id),
    marketId: row.market_id,
    outcome: row.outcome === 1 ? "YES" : "NO",
    priceMicros: Number(row.price),
    sizeMicros: Number(row.size),
    taker: row.taker as Address,
    maker: row.maker as Address,
    txHash: row.tx_hash as Hex,
    blockNumber: row.block_number,
    filledAt: row.filled_at
  };
}

/**
 * Subscribe to new fills for one market. INSERT-only — fills are append-only
 * so we don't care about UPDATE/DELETE. The trade tape prepends new rows;
 * the price chart appends in time order.
 */
export function subscribeMarketFills(
  marketId: string,
  onInsert: (fill: Fill) => void
): Unsubscribe {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return NOOP;
  const channel = supabase
    .channel(`markets:fills:${marketId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "market_fills",
        filter: `market_id=eq.${marketId}`
      },
      (payload) => {
        const row = (payload as unknown as PgChangesPayload<FillRow>).new;
        if (row) onInsert(fillRowToDomain(row));
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ---------- market_positions ----------

type PositionRow = {
  user_address: string;
  market_id: string;
  yes_shares: string;
  no_shares: string;
  cost_basis: string;
  realized_pnl: string;
  updated_at: string;
};

function positionRowToDomain(row: PositionRow): Position {
  return {
    userAddress: row.user_address as Address,
    marketId: row.market_id,
    yesSharesMicros: Number(row.yes_shares),
    noSharesMicros: Number(row.no_shares),
    costBasisMicros: Number(row.cost_basis),
    realizedPnlMicros: Number(row.realized_pnl)
  };
}

/**
 * Subscribe to the connected wallet's position changes across every market.
 * Emits INSERT/UPDATE (positions are never deleted in v1) — the page merges
 * the row into its in-memory map keyed by marketId.
 */
export function subscribeMyPositions(
  userAddress: Address,
  onChange: (position: Position) => void
): Unsubscribe {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return NOOP;
  const filter = `user_address=eq.${userAddress.toLowerCase()}`;
  const channel = supabase
    .channel(`markets:positions:${userAddress.toLowerCase()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "market_positions", filter },
      (payload) => {
        const row = (payload as unknown as PgChangesPayload<PositionRow>).new;
        if (row) onChange(positionRowToDomain(row));
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ---------- market_claims ----------

type ClaimRow = {
  id: string;
  market_id: string;
  user_address: string;
  outcome: 0 | 1;
  shares: string;
  payout: string;
  tx_hash: string;
  block_number: string;
  settlement_id: string;
  psp_uid: string | null;
  claimed_at: string;
};

export type ClaimUpdate = {
  id: string;
  marketId: string;
  userAddress: Address;
  outcome: "YES" | "NO";
  sharesMicros: number;
  payoutMicros: number;
  txHash: Hex;
  blockNumber: string;
  settlementId: Hex;
  pspUid?: string;
  claimedAt: string;
};

function claimRowToDomain(row: ClaimRow): ClaimUpdate {
  return {
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
  };
}

/**
 * Subscribe to claim rows for one user. Primary use: the HistoryPage waits on
 * UPDATE events to see `psp_uid` flip from null to a real value once the PSP
 * issuer finishes signing.
 */
export function subscribeMyClaims(
  userAddress: Address,
  onChange: (claim: ClaimUpdate) => void
): Unsubscribe {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return NOOP;
  const filter = `user_address=eq.${userAddress.toLowerCase()}`;
  const channel = supabase
    .channel(`markets:claims:${userAddress.toLowerCase()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "market_claims", filter },
      (payload) => {
        const row = (payload as unknown as PgChangesPayload<ClaimRow>).new;
        if (row) onChange(claimRowToDomain(row));
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
