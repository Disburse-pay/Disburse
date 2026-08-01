-- QR payment integrity schema preparation.
--
-- This migration deliberately separates evidence-column installation from
-- enforcement. Existing receipts may lack a trustworthy block hash, log index,
-- or chain id; these values must be backfilled from canonical successful
-- receipts without guessing. Migration 202607290103 is the fail-closed
-- barrier: it refuses to install mutating RPCs until every legacy
-- inconsistency and missing evidence item has been resolved explicitly by an
-- operator.

alter table public.payment_requests
  add column if not exists request_token_hash text;

alter table public.payment_requests
  drop constraint if exists payment_requests_request_token_hash_check,
  add constraint payment_requests_request_token_hash_check
    check (
      request_token_hash is null
      or request_token_hash ~ '^[0-9a-f]{64}$'
    ),
  drop constraint if exists payment_requests_start_block_format,
  add constraint payment_requests_start_block_format
    check (start_block ~ '^(0|[1-9][0-9]{0,77})$')
    not valid;

create unique index payment_requests_request_token_hash_key
  on public.payment_requests (request_token_hash)
  where request_token_hash is not null;

alter table public.payment_receipts
  add column if not exists block_hash text,
  add column if not exists settlement_log_index integer;

alter table public.payment_receipts
  drop constraint if exists payment_receipts_block_number_format,
  add constraint payment_receipts_block_number_format
    check (block_number ~ '^(0|[1-9][0-9]{0,77})$')
    not valid,
  drop constraint if exists payment_receipts_block_hash_format,
  add constraint payment_receipts_block_hash_format
    check (
      block_hash is null
      or block_hash ~ '^0x[0-9a-f]{64}$'
    ),
  drop constraint if exists payment_receipts_settlement_log_index_check,
  add constraint payment_receipts_settlement_log_index_check
    check (
      settlement_log_index is null
      or settlement_log_index >= 0
    ),
  drop constraint if exists payment_receipts_confirmed_at_finite,
  add constraint payment_receipts_confirmed_at_finite
    check (isfinite(confirmed_at))
    not valid,
  drop constraint if exists payment_receipts_exact_evidence_required,
  add constraint payment_receipts_exact_evidence_required
    check (
      block_hash is not null
      and settlement_log_index is not null
      and chain_id is not null
      and chain_id > 0
    )
    not valid;

-- NOT VALID constraints still reject unsafe new or updated rows. They only
-- exempt legacy rows long enough for an explicit canonical-evidence backfill.
-- Keep payment writes paused until 202607290103 validates these constraints
-- and installs the service-role-only transactional RPCs.
