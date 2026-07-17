-- Retire the bet product (prediction markets + lending + credit).
--
-- psp_documents: market-claim PSPs are signed, verifiable proofs and MUST
-- survive. We do NOT reverse 202605200002_psp_market_claims.sql. Instead we
-- detach psp_documents from market_claims:
--   * drop the FK (it cascades deletes from market_claims — dangerous once
--     market_claims goes away) and the exactly-one CHECK,
--   * keep the market_claim_id column and every existing row intact.
-- request_id stays nullable; the unique indexes on both columns stay valid.

alter table public.psp_documents
  drop constraint if exists psp_documents_kind_check;

alter table public.psp_documents
  drop constraint if exists psp_documents_market_claim_id_fkey;

-- Market position cache function (kept its own migration; drop first since
-- it references market_positions).
drop function if exists public.apply_market_position_delta(uuid, text, smallint, numeric, numeric, numeric);

-- Markets. Children first, parents last.
drop table if exists public.market_whitelist_codes;
drop table if exists public.market_claims;
drop table if exists public.market_resolutions;
drop table if exists public.market_positions;
drop table if exists public.market_fills;
drop table if exists public.market_orders;
drop table if exists public.markets;

-- Lending.
drop table if exists public.lending_pool_snapshots;
drop table if exists public.lending_positions;
drop table if exists public.lending_events;
drop table if exists public.lending_indexer_state;

-- Credit.
drop table if exists public.credit_attestations;
drop table if exists public.credit_profiles;
