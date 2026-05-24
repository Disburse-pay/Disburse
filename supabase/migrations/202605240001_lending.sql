-- Lending — cirBTC collateral / USDC borrow, Aave-style pool.
-- See contracts/src/lending/ for the on-chain contracts.
--
-- Tables:
--   lending_events           — append-only log of LendingPool events
--   lending_positions        — per-user cached state (collateral, debt, HF)
--   lending_pool_snapshots   — periodic pool-wide state (util, rates, reserves)
--   lending_indexer_state    — bookkeeping: last block scanned

-- ───── Indexer bookkeeping ─────
-- Single-row table tracking how far the indexer has scanned. Initialized to
-- 0 so the first run starts at the LendingPool deployment block (or
-- whatever LENDING_DEPLOY_BLOCK env says).

create table if not exists public.lending_indexer_state (
  id integer primary key default 1 check (id = 1),
  last_scanned_block bigint not null default 0,
  last_run_at timestamptz not null default now()
);

insert into public.lending_indexer_state (id, last_scanned_block)
  values (1, 0)
  on conflict (id) do nothing;

-- ───── Events ─────
-- One row per LendingPool log entry. Unique on (tx_hash, log_index) so the
-- indexer is idempotent on reruns. `event_type` mirrors the Solidity event
-- name (Deposited, Withdrew, Borrowed, Repaid, …). `amount_a/b/c` carry the
-- numeric payload; the shape varies by event (see indexer for the mapping).

create table if not exists public.lending_events (
  id bigserial primary key,
  tx_hash text not null check (tx_hash ~* '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null,
  block_time timestamptz not null,
  event_type text not null,
  user_address text check (user_address is null or user_address ~* '^0x[0-9a-f]{40}$'),
  related_address text check (related_address is null or related_address ~* '^0x[0-9a-f]{40}$'),
  amount_a numeric(78, 0),
  amount_b numeric(78, 0),
  amount_c numeric(78, 0),
  unique (tx_hash, log_index)
);

create index if not exists lending_events_user_idx
  on public.lending_events(user_address)
  where user_address is not null;

create index if not exists lending_events_block_idx
  on public.lending_events(block_number desc);

create index if not exists lending_events_type_idx
  on public.lending_events(event_type);

-- ───── Per-user position cache ─────
-- The on-chain LendingPool is the source of truth; this row is a cache the
-- indexer refreshes after every state-changing tx by that user, AND
-- periodically when the price moves (to keep HF current). Liquidator keeper
-- queries the `is_liquidatable` flag for candidates.

create table if not exists public.lending_positions (
  user_address text primary key check (user_address ~* '^0x[0-9a-f]{40}$'),

  -- Raw on-chain numbers (8 decimals for cirBTC, scaled-borrow for debt)
  collateral_amount numeric(78, 0) not null default 0 check (collateral_amount >= 0),
  scaled_borrow numeric(78, 0) not null default 0 check (scaled_borrow >= 0),

  -- Derived values at last refresh (6-decimal USDC, 1e18 HF). Cached so
  -- the UI doesn't need to call price-adapter for every position card.
  cached_debt_usdc numeric(78, 0) not null default 0,
  cached_collateral_usdc numeric(78, 0) not null default 0,
  cached_health_factor numeric(78, 0),

  is_liquidatable boolean not null default false,
  last_updated_block bigint,
  last_updated_at timestamptz not null default now()
);

create index if not exists lending_positions_is_liquidatable_idx
  on public.lending_positions(is_liquidatable)
  where is_liquidatable = true;

create index if not exists lending_positions_updated_idx
  on public.lending_positions(last_updated_at desc);

-- ───── Pool snapshots ─────
-- Periodic snapshot of pool-wide state, used by the UI's "Pool stats" panel
-- and as historical data for an APR chart. Indexer writes one row per scan.

create table if not exists public.lending_pool_snapshots (
  id bigserial primary key,
  block_number bigint not null,
  observed_at timestamptz not null default now(),

  cash_usdc numeric(78, 0) not null,
  total_borrows_usdc numeric(78, 0) not null,
  total_reserves_usdc numeric(78, 0) not null,

  supply_index numeric(78, 0) not null,
  borrow_index numeric(78, 0) not null,

  utilization_wad numeric(78, 0) not null,
  borrow_apr_wad numeric(78, 0) not null,
  supply_apr_wad numeric(78, 0) not null,

  -- Latest BTC/USD price seen at the time of the snapshot (may be null if
  -- the Pyth feed was stale at scan time — indexer caches the last good).
  btc_price_wad numeric(78, 0)
);

create index if not exists lending_pool_snapshots_block_idx
  on public.lending_pool_snapshots(block_number desc);

-- ───── Realtime publication ─────
-- Mirror the markets pattern so the UI can subscribe to position changes
-- without needing to poll. Frontend filters by user_address.

alter publication supabase_realtime add table public.lending_positions;
alter publication supabase_realtime add table public.lending_events;
alter publication supabase_realtime add table public.lending_pool_snapshots;
