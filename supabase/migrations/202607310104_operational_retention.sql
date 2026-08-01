-- Bound operational storage without deleting the canonical payment ledger.
-- This migration only installs the maintenance primitive; production rollout
-- and scheduling remain an explicit operator action.

create table public.disburse_maintenance_state (
  task text primary key,
  last_run_at timestamptz not null default '-infinity'::timestamptz
);

insert into public.disburse_maintenance_state (task)
values ('operational_retention')
on conflict (task) do nothing;

alter table public.disburse_maintenance_state enable row level security;
revoke all on public.disburse_maintenance_state from public, anon, authenticated;
grant select, update on public.disburse_maintenance_state to service_role;

-- BRIN keeps the time-based maintenance scans cheap with negligible index
-- growth compared with a B-tree on append-oriented operational tables.
create index payment_request_events_created_brin_idx
  on public.payment_request_events using brin (created_at)
  with (pages_per_range = 32);

create index notifications_created_brin_idx
  on public.notifications using brin (created_at)
  with (pages_per_range = 32);

create or replace function public.prune_disburse_operational_data(
  p_now timestamptz default clock_timestamp(),
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed integer;
  v_capabilities integer := 0;
  v_events integer := 0;
  v_notifications integer := 0;
begin
  if p_now is null or not isfinite(p_now) then
    raise exception using
      errcode = '22023',
      message = 'Maintenance timestamp is invalid.';
  end if;

  update public.disburse_maintenance_state
     set last_run_at = p_now
   where task = 'operational_retention'
     and (p_force or last_run_at <= p_now - interval '23 hours');
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    return jsonb_build_object('state', 'skipped');
  end if;

  -- Closed QR bearer capabilities no longer need to be recoverable. Removing
  -- their encrypted envelopes after 30 days limits secret retention without
  -- affecting receipts, statements, or wallet history.
  delete from public.payment_request_capabilities as capability
  using public.payment_requests as request
  where capability.request_id = request.id
    and request.status in ('paid', 'failed', 'expired')
    and request.updated_at < p_now - interval '30 days';
  get diagnostics v_capabilities = row_count;

  -- Events are a delivery/change feed, not the canonical ledger. Retain a
  -- generous recovery window, then remove events for terminal requests only.
  delete from public.payment_request_events as event
  using public.payment_requests as request
  where event.request_id = request.id
    and request.status in ('paid', 'failed', 'expired')
    and event.created_at < p_now - interval '90 days';
  get diagnostics v_events = row_count;

  -- Handled inbox entries are ephemeral. Unread entries get a six-month
  -- window so maintenance cannot silently erase a recent payment request.
  delete from public.notifications
  where (status in ('read', 'ignored') and created_at < p_now - interval '30 days')
     or (status = 'unread' and created_at < p_now - interval '180 days');
  get diagnostics v_notifications = row_count;

  return jsonb_build_object(
    'state', 'pruned',
    'capabilities', v_capabilities,
    'events', v_events,
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.prune_disburse_operational_data(
  timestamptz,
  boolean
) from public, anon, authenticated;

grant execute on function public.prune_disburse_operational_data(
  timestamptz,
  boolean
) to service_role;
