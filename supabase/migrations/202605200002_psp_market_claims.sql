-- Extend psp_documents to accept market-claim PSPs alongside payment PSPs.
--
-- Before: psp_documents.request_id is NOT NULL with a FK to payment_requests.
-- After:  request_id is nullable; market_claim_id is added (nullable, FK to
--         market_claims); a CHECK constraint enforces exactly one is set.
--
-- The existing unique index on request_id stays valid (NULLs are not
-- considered equal in unique indexes by default). We add a parallel unique
-- index on market_claim_id so PSP issuance remains idempotent per claim.

alter table public.psp_documents
  alter column request_id drop not null;

alter table public.psp_documents
  add column if not exists market_claim_id uuid references public.market_claims(id) on delete cascade;

-- Exactly one of (request_id, market_claim_id) must be set.
alter table public.psp_documents
  drop constraint if exists psp_documents_kind_check;

alter table public.psp_documents
  add constraint psp_documents_kind_check
  check (
    (request_id is not null and market_claim_id is null)
    or
    (request_id is null and market_claim_id is not null)
  );

-- One PSP per market claim.
create unique index if not exists psp_documents_market_claim_id_key
  on public.psp_documents(market_claim_id)
  where market_claim_id is not null;
