-- Prediction markets — off-chain orderbook, fills, positions, resolutions, claims.
-- See spec/psp-v1.1-markets.md for the on-chain ↔ off-chain contract.

-- ───── Markets registry ─────
-- One row per market, mirroring the on-chain Market contract. The on-chain
-- address is the source of truth for collateral/share state; this table
-- carries the question, category, and indexing metadata.

create table if not exists public.markets (
  id uuid primary key,
  onchain_address text not null unique check (onchain_address ~* '^0x[0-9a-f]{40}$'),
  question text not null,
  description text,
  category text not null default 'General',
  closes_at timestamptz not null,
  resolves_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed', 'resolved')),
  winning_outcome smallint check (winning_outcome is null or winning_outcome in (0, 1)),
  metadata_uri text,
  created_at timestamptz not null default now(),
  created_by text check (created_by is null or created_by ~* '^0x[0-9a-f]{40}$')
);

create index if not exists markets_status_idx on public.markets(status);
create index if not exists markets_category_idx on public.markets(category);
create index if not exists markets_closes_at_idx on public.markets(closes_at);

-- ───── Orders (off-chain orderbook) ─────
-- The orderbook lives in this table. Each row is one EIP-712-signed limit
-- order. The on-chain Exchange does NOT store these; it only verifies
-- signatures + records cumulative `filled` per orderHash on settle.

create table if not exists public.market_orders (
  hash text primary key check (hash ~* '^0x[0-9a-f]{64}$'),
  market_id uuid not null references public.markets(id) on delete cascade,
  maker text not null check (maker ~* '^0x[0-9a-f]{40}$'),
  outcome smallint not null check (outcome in (0, 1)),
  side smallint not null check (side in (0, 1)),     -- 0=BUY, 1=SELL
  price bigint not null check (price > 0 and price < 1000000),
  size numeric(78, 0) not null check (size > 0),
  filled numeric(78, 0) not null default 0 check (filled >= 0),
  expiry timestamptz not null,
  salt text not null check (salt ~* '^0x[0-9a-f]{1,64}$'),
  signature text not null check (signature ~* '^0x[0-9a-f]{130}$'),
  status text not null default 'open' check (status in ('open', 'partial', 'filled', 'cancelled', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists market_orders_market_status_idx
  on public.market_orders(market_id, status);
create index if not exists market_orders_market_outcome_side_idx
  on public.market_orders(market_id, outcome, side, status);
create index if not exists market_orders_maker_idx on public.market_orders(maker);

-- ───── Fills ─────
-- One row per on-chain Filled event indexed from Exchange. Source of truth
-- for trade history and price chart.

create table if not exists public.market_fills (
  id bigint generated always as identity primary key,
  market_id uuid not null references public.markets(id) on delete cascade,
  order_hash text not null references public.market_orders(hash),
  taker text not null check (taker ~* '^0x[0-9a-f]{40}$'),
  maker text not null check (maker ~* '^0x[0-9a-f]{40}$'),
  outcome smallint not null check (outcome in (0, 1)),
  side smallint not null check (side in (0, 1)),
  price bigint not null check (price > 0 and price < 1000000),
  size numeric(78, 0) not null check (size > 0),
  total_usdc numeric(78, 0) not null,
  tx_hash text not null check (tx_hash ~* '^0x[0-9a-f]{64}$'),
  block_number text not null,
  filled_at timestamptz not null default now()
);

create index if not exists market_fills_market_time_idx
  on public.market_fills(market_id, filled_at desc);
create unique index if not exists market_fills_tx_log_unique_idx
  on public.market_fills(tx_hash, order_hash, size);

-- ───── Positions ─────
-- Derived from fills + complete-set mints. Maintained by the backend as
-- a cache for fast UI reads. The contract balances on OutcomeToken are
-- always the ground truth.

create table if not exists public.market_positions (
  user_address text not null check (user_address ~* '^0x[0-9a-f]{40}$'),
  market_id uuid not null references public.markets(id) on delete cascade,
  yes_shares numeric(78, 0) not null default 0,
  no_shares numeric(78, 0) not null default 0,
  cost_basis numeric(78, 0) not null default 0,
  realized_pnl numeric(78, 0) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_address, market_id)
);

create index if not exists market_positions_user_idx
  on public.market_positions(user_address, updated_at desc);

-- ───── Resolutions ─────
-- One row per resolved market. Mirrors the MarketResolved event.

create table if not exists public.market_resolutions (
  market_id uuid primary key references public.markets(id) on delete cascade,
  winning_outcome smallint not null check (winning_outcome in (0, 1)),
  resolved_by text not null check (resolved_by ~* '^0x[0-9a-f]{40}$'),
  tx_hash text not null check (tx_hash ~* '^0x[0-9a-f]{64}$'),
  resolved_at timestamptz not null default now()
);

-- ───── Claims ─────
-- One row per on-chain MarketClaimed event. Triggers PSP issuance via
-- the refactored issuePsp({ kind: 'market_claim', claim }) path.

create table if not exists public.market_claims (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  user_address text not null check (user_address ~* '^0x[0-9a-f]{40}$'),
  outcome smallint not null check (outcome in (0, 1)),
  shares numeric(78, 0) not null check (shares > 0),
  payout numeric(78, 0) not null check (payout > 0),
  tx_hash text not null unique check (tx_hash ~* '^0x[0-9a-f]{64}$'),
  block_number text not null,
  settlement_id text not null check (settlement_id ~* '^0x[0-9a-f]{64}$'),
  psp_uid text check (psp_uid is null or psp_uid ~* '^psp:[0-9a-f]{16}$'),
  claimed_at timestamptz not null default now()
);

create index if not exists market_claims_user_idx
  on public.market_claims(user_address, claimed_at desc);
create index if not exists market_claims_market_idx
  on public.market_claims(market_id);

-- ───── RLS ─────

alter table public.markets enable row level security;
alter table public.market_orders enable row level security;
alter table public.market_fills enable row level security;
alter table public.market_positions enable row level security;
alter table public.market_resolutions enable row level security;
alter table public.market_claims enable row level security;

-- Public reads for the orderbook, fills, markets list, resolutions.
do $$
declare
  t text;
begin
  foreach t in array array['markets', 'market_orders', 'market_fills', 'market_resolutions', 'market_claims', 'market_positions']
  loop
    execute format('drop policy if exists "%I_public_read" on public.%I', t || '_public_read', t);
    execute format(
      'create policy "%I" on public.%I for select to anon using (true)',
      t || '_public_read', t
    );
  end loop;
end
$$;

-- Service role writes (the backend's supabase admin client).
do $$
declare
  t text;
begin
  foreach t in array array['markets', 'market_orders', 'market_fills', 'market_resolutions', 'market_claims', 'market_positions']
  loop
    execute format('drop policy if exists "%I_service_write" on public.%I', t || '_service_write', t);
    execute format(
      'create policy "%I" on public.%I for all to service_role using (true) with check (true)',
      t || '_service_write', t
    );
  end loop;
end
$$;

grant select on public.markets, public.market_orders, public.market_fills,
  public.market_positions, public.market_resolutions, public.market_claims
  to anon;

-- ───── Realtime ─────
-- Frontend subscribes to: orderbook depth, fill tape, own positions, own claims.

alter table public.market_orders replica identity full;
alter table public.market_fills replica identity full;
alter table public.market_positions replica identity full;
alter table public.market_claims replica identity full;
alter table public.market_resolutions replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['market_orders', 'market_fills', 'market_positions', 'market_claims', 'market_resolutions']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
