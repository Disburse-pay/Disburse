-- Credit — unsecured, revenue-backed credit lines on top of LendingPool.
--
-- A borrower's signed PSP receipts (psp_documents) form a verifiable revenue
-- history. server/credit/score.ts turns that into a CreditScore; the relayer
-- (the pool's `underwriter`) grants the resulting limit on-chain via
-- LendingPool.setCreditLimit. These tables are the off-chain mirror/audit
-- trail — the on-chain creditLimitUsdc/creditExpiry remain the source of truth.
--
-- Tables:
--   credit_profiles      — latest score + active offer per borrower
--   credit_attestations  — append-only log of every limit the underwriter set

-- ───── Per-borrower profile (latest score + active offer) ─────
create table if not exists public.credit_profiles (
  borrower text primary key check (borrower ~* '^0x[0-9a-f]{40}$'),

  network_mode text not null default 'testnet' check (network_mode in ('testnet', 'mainnet')),

  -- Full CreditScore snapshot (eligibility signals, reasons, pspUids…) so the
  -- UI and audits can see exactly what the offer was based on.
  score jsonb not null,

  -- Denormalized headline fields for cheap querying / sorting.
  eligible boolean not null default false,
  max_credit_usdc numeric(78, 0) not null default 0 check (max_credit_usdc >= 0),
  apr_premium_bps integer not null default 0 check (apr_premium_bps >= 0),
  window_from timestamptz,
  window_to timestamptz,

  -- 'none' (never opened), 'active' (line granted, unexpired), 'expired',
  -- 'defaulted' (frozen by the underwriter).
  status text not null default 'none' check (status in ('none', 'active', 'expired', 'defaulted')),
  expiry timestamptz,

  updated_at timestamptz not null default now()
);

create index if not exists credit_profiles_status_idx
  on public.credit_profiles(status);

create index if not exists credit_profiles_updated_idx
  on public.credit_profiles(updated_at desc);

-- ───── Attestation log (one row per on-chain setCreditLimit) ─────
-- Append-only. `nonce` is the borrower-supplied idempotency key from
-- /api/credit-open, unique per borrower so a retried open doesn't double-set.
create table if not exists public.credit_attestations (
  id bigserial primary key,
  borrower text not null check (borrower ~* '^0x[0-9a-f]{40}$'),
  max_credit_usdc numeric(78, 0) not null check (max_credit_usdc >= 0),
  apr_premium_bps integer not null default 0,
  expiry timestamptz not null,
  nonce text not null,
  tx_hash text check (tx_hash is null or tx_hash ~* '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (borrower, nonce)
);

create index if not exists credit_attestations_borrower_idx
  on public.credit_attestations(borrower);

-- ───── Realtime publication ─────
-- Mirror the lending pattern so the UI can stream credit-limit changes
-- without polling. Frontend filters by borrower.
alter publication supabase_realtime add table public.credit_profiles;
