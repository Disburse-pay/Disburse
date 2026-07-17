-- In-app notification inbox, addressed to Disburse IDs (usernames), never
-- email. A payment request targeting @name creates a payment_request
-- notification for that user; a confirmed payment creates a
-- payment_received notification for the requester. Reads and status updates
-- go through /api/notifications, which authenticates the wallet with a
-- short-lived EIP-712 inbox-access signature and uses the service-role key.
-- No public policies: RLS locks anon/authenticated out entirely.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_handle extensions.citext not null references public.disburse_ids(handle) on delete cascade,
  kind text not null check (kind in ('payment_request', 'payment_received')),
  request_id uuid,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'unread' check (status in ('unread', 'read', 'ignored')),
  created_at timestamptz not null default now()
);

create index notifications_recipient_created_idx
  on public.notifications (recipient_handle, created_at desc);

-- One payment_request notification per request and recipient, so retried
-- request creation cannot spam the inbox.
create unique index notifications_request_dedupe_idx
  on public.notifications (recipient_handle, kind, request_id)
  where request_id is not null;

alter table public.notifications enable row level security;
