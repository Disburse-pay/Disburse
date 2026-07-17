-- Disburse IDs: a public username bound to one Arc wallet address.
-- Handles are payment destinations (request-to-username, notifications),
-- so anon may read them. Claims are written only by server code holding
-- the service-role key after verifying an EIP-712 signature from the
-- wallet, so no insert/update/delete policies exist for public roles.

create extension if not exists citext with schema extensions;

create table public.disburse_ids (
  handle extensions.citext primary key,
  address text not null unique,
  claimed_at timestamptz not null default now(),
  -- citext's ~ matches case-insensitively; cast to text so uppercase
  -- handles cannot sneak past the lowercase-only format.
  constraint disburse_ids_handle_format check (handle::text ~ '^[a-z0-9_]{3,16}$'),
  constraint disburse_ids_address_format check (address ~ '^0x[0-9a-f]{40}$')
);

alter table public.disburse_ids enable row level security;

create policy "disburse_ids_public_read"
  on public.disburse_ids
  for select
  to anon, authenticated
  using (true);
