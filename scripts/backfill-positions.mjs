#!/usr/bin/env node
/**
 * One-time backfill: rebuild market_positions from market_fills.
 * Uses direct table inserts (no RPC needed).
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://rbnhpoqhwepfnuyktsjj.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// 1. Read all fills
const { data: fills, error: fillErr } = await supabase
  .from("market_fills")
  .select("market_id,taker,maker,outcome,side,price,size,total_usdc")
  .order("id", { ascending: true });

if (fillErr) { console.error("fill query failed:", fillErr); process.exit(1); }
console.log(`Found ${fills.length} fill(s) to replay`);

// Accumulate position deltas in memory
const positions = new Map();

function getKey(user, marketId) {
  return `${user.toLowerCase()}:${marketId}`;
}

function getOrCreate(user, marketId) {
  const key = getKey(user, marketId);
  if (!positions.has(key)) {
    positions.set(key, {
      user_address: user.toLowerCase(),
      market_id: marketId,
      yes_shares: 0,
      no_shares: 0,
      cost_basis: 0,
      realized_pnl: 0,
    });
  }
  return positions.get(key);
}

for (const fill of fills) {
  const buyer = fill.side === 0 ? fill.maker : fill.taker;
  const seller = fill.side === 0 ? fill.taker : fill.maker;
  const size = Number(fill.size);
  const totalUsdc = Number(fill.total_usdc);

  console.log(`  fill: buyer=${buyer} seller=${seller} outcome=${fill.outcome} size=${size} usdc=${totalUsdc}`);

  // Buyer gets shares + pays cost
  const buyerPos = getOrCreate(buyer, fill.market_id);
  if (fill.outcome === 1) {
    buyerPos.yes_shares += size;
  } else {
    buyerPos.no_shares += size;
  }
  buyerPos.cost_basis += totalUsdc;

  // Seller loses shares + gets realized PnL
  const sellerPos = getOrCreate(seller, fill.market_id);
  if (fill.outcome === 1) {
    sellerPos.yes_shares -= size;
  } else {
    sellerPos.no_shares -= size;
  }
  sellerPos.realized_pnl += totalUsdc;
}

// 2. Write positions
const rows = Array.from(positions.values());
console.log(`\nWriting ${rows.length} position(s)...`);

for (const row of rows) {
  console.log(`  ${row.user_address} → YES=${row.yes_shares} NO=${row.no_shares} cost=${row.cost_basis} pnl=${row.realized_pnl}`);
  const { error } = await supabase
    .from("market_positions")
    .upsert(row, { onConflict: "user_address,market_id" });
  if (error) {
    console.error(`  FAILED:`, error);
  } else {
    console.log(`  OK`);
  }
}

// 3. Verify
const { data: final } = await supabase
  .from("market_positions")
  .select("user_address,market_id,yes_shares,no_shares,cost_basis,realized_pnl");
console.log(`\nPositions in DB: ${final?.length ?? 0}`);
for (const p of final ?? []) {
  console.log(`  ${p.user_address}: YES=${p.yes_shares} NO=${p.no_shares} cost=${p.cost_basis} pnl=${p.realized_pnl}`);
}
