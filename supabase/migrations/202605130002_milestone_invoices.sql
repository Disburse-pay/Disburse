-- Milestone Invoice Chains
-- Multi-step invoice sequences where each step unlocks only when the
-- previous step's PSP is presented. Enables conditional payment flows.

create table if not exists public.milestone_chains (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  recipient text not null check (recipient ~* '^0x[0-9a-f]{40}$'),
  counterparty text check (counterparty is null or counterparty ~* '^0x[0-9a-f]{40}$'),
  token text not null check (token in ('USDC', 'EURC')),
  total_amount text not null,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.milestone_steps (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.milestone_chains(id) on delete cascade,
  step_number integer not null check (step_number >= 1),
  label text not null,
  description text,
  amount text not null,
  status text not null default 'locked' check (status in ('locked', 'unlocked', 'payment_pending', 'completed')),
  -- Link to the payment request created for this step
  request_id uuid references public.payment_requests(id) on delete set null,
  -- PSP that proves this step is complete
  psp_uid text references public.psp_documents(uid) on delete set null,
  -- PSP required to unlock this step (from the previous step)
  requires_psp_uid text references public.psp_documents(uid) on delete set null,
  unlocked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chain_id, step_number)
);

create index if not exists milestone_steps_chain_id_idx on public.milestone_steps(chain_id, step_number);
create index if not exists milestone_steps_status_idx on public.milestone_steps(status);

alter table public.milestone_chains enable row level security;
alter table public.milestone_steps enable row level security;

-- Service role full access
drop policy if exists "milestone_chains_service_role" on public.milestone_chains;
create policy "milestone_chains_service_role"
  on public.milestone_chains for all to service_role
  using (true) with check (true);

drop policy if exists "milestone_steps_service_role" on public.milestone_steps;
create policy "milestone_steps_service_role"
  on public.milestone_steps for all to service_role
  using (true) with check (true);

-- Public read access (milestone status is shareable)
drop policy if exists "milestone_chains_public_read" on public.milestone_chains;
create policy "milestone_chains_public_read"
  on public.milestone_chains for select to anon using (true);

drop policy if exists "milestone_steps_public_read" on public.milestone_steps;
create policy "milestone_steps_public_read"
  on public.milestone_steps for select to anon using (true);

grant select on public.milestone_chains to anon;
grant select on public.milestone_steps to anon;
