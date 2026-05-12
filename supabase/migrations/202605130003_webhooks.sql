-- Webhooks
-- Register URLs to receive PSP documents when payments settle.
-- Enables integrations with accounting tools, agent orchestrators, etc.

create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~* '^https://'),
  secret text not null,
  recipient text check (recipient is null or recipient ~* '^0x[0-9a-f]{40}$'),
  events text[] not null default '{psp.issued}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  failure_count integer not null default 0
);

create index if not exists webhooks_active_idx on public.webhooks(active) where active = true;
create index if not exists webhooks_recipient_idx on public.webhooks(recipient) where recipient is not null;

alter table public.webhooks enable row level security;

drop policy if exists "webhooks_service_role" on public.webhooks;
create policy "webhooks_service_role"
  on public.webhooks for all to service_role
  using (true) with check (true);
