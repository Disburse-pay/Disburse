-- Portable Settlement Proof (PSP) documents
-- Stores signed, independently verifiable settlement proofs.

create table if not exists public.psp_documents (
  uid text primary key check (uid ~* '^psp:[0-9a-f]{16}$'),
  request_id uuid not null references public.payment_requests(id) on delete cascade,
  network_mode text not null check (network_mode in ('testnet', 'mainnet')),
  digest text not null check (digest ~* '^0x[0-9a-f]{64}$'),
  document jsonb not null,
  issuer_public_key text not null check (issuer_public_key ~* '^0x[0-9a-f]{40}$'),
  signature text not null,
  created_at timestamptz not null default now()
);

-- One PSP per payment request (idempotent issuance)
create unique index if not exists psp_documents_request_id_key
  on public.psp_documents(request_id);

-- Lookup by digest for external verification
create index if not exists psp_documents_digest_idx
  on public.psp_documents(digest);

alter table public.psp_documents enable row level security;

-- Public read access by UID (anyone with the UID can verify)
drop policy if exists "psp_documents_are_publicly_readable" on public.psp_documents;
create policy "psp_documents_are_publicly_readable"
  on public.psp_documents
  for select
  to anon
  using (true);

-- Service role can insert/update
drop policy if exists "psp_documents_service_role_write" on public.psp_documents;
create policy "psp_documents_service_role_write"
  on public.psp_documents
  for all
  to service_role
  using (true)
  with check (true);

grant select on public.psp_documents to anon;

-- Extend payment_request_events check constraint to include 'psp_issue' event type
-- We use a new check that includes the new value alongside existing ones
alter table public.payment_request_events
  drop constraint if exists payment_request_events_event_type_check;

alter table public.payment_request_events
  add constraint payment_request_events_event_type_check
  check (event_type in ('submitted', 'paid', 'failed', 'expired', 'proving', 'settling', 'settled', 'psp_issue'));
