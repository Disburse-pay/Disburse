-- Enable Row-Level Security on tables created without it.
--
-- Supabase's security advisor flags these as `rls_disabled_in_public`:
-- without RLS, anyone holding the anon key can read and write them through
-- PostgREST. All six tables are accessed exclusively by server code using
-- the service-role key (server/lending/repo.ts, server/credit/repo.ts),
-- which bypasses RLS — so enabling RLS with no policies locks out the
-- public roles without changing server behavior. The browser reads this
-- data only via the /api/lending-* and /api/credit-* handlers.
--
-- `if exists` guards the credit tables, whose migration may not be applied
-- to every environment yet.

alter table if exists public.lending_indexer_state enable row level security;
alter table if exists public.lending_events enable row level security;
alter table if exists public.lending_positions enable row level security;
alter table if exists public.lending_pool_snapshots enable row level security;
alter table if exists public.credit_profiles enable row level security;
alter table if exists public.credit_attestations enable row level security;
