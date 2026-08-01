-- Backend privacy and authorization hardening.
--
-- 1. Webhook registrations become wallet-owned and recipient-scoped.
-- 2. PSP documents and payment events are no longer globally enumerable.
-- 3. PSP invoice fields used by statements are indexed before pagination.
-- 4. Private reservation state supports the all-or-nothing QR creation RPC
--    installed after the capability-hash column exists.
-- 5. Legacy notification capabilities are redacted without deleting inbox
--    rows, and webhook mutation signatures become single-use.

-- Legacy payment-request notifications stored the raw bearer capability in
-- payload.request.requestToken. Remove only that key in place. This preserves
-- the notification, its request object, unrelated payload fields, and any
-- encrypted requestTokenEnvelope written by the replacement server path.
update public.notifications
   set payload = payload #- '{request,requestToken}'
 where kind = 'payment_request'
   and jsonb_typeof(payload -> 'request') = 'object'
   and (payload -> 'request') ? 'requestToken';

-- ───── Wallet-owned webhook registrations ─────

alter table public.webhooks
  add column if not exists owner_wallet text,
  add column if not exists registration_key text;

-- Legacy registrations were created without owner authorization. Do not
-- silently grandfather them into an owner's trust boundary.
update public.webhooks
set active = false,
    updated_at = now()
where active = true
  and (owner_wallet is null or recipient is null);

alter table public.webhooks
  drop constraint if exists webhooks_owner_wallet_format,
  add constraint webhooks_owner_wallet_format
    check (owner_wallet is null or owner_wallet ~ '^0x[0-9a-f]{40}$'),
  drop constraint if exists webhooks_registration_key_format,
  add constraint webhooks_registration_key_format
    check (registration_key is null or registration_key ~ '^[0-9a-f]{64}$'),
  drop constraint if exists webhooks_active_owner_scope,
  add constraint webhooks_active_owner_scope
    check (
      not active
      or (
        owner_wallet is not null
        and recipient is not null
        and registration_key is not null
        and lower(owner_wallet) = lower(recipient)
        and recipient = lower(recipient)
        and events = array['psp.issued']::text[]
        and char_length(secret) between 32 and 256
      )
    );

create unique index if not exists webhooks_owner_registration_key
  on public.webhooks (owner_wallet, registration_key);

create index if not exists webhooks_owner_active_idx
  on public.webhooks (owner_wallet, active, created_at desc);

create or replace function public.enforce_webhook_owner_quota()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  active_count integer;
begin
  if not new.active then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(new.owner_wallet), 0));

  select count(*)
    into active_count
    from public.webhooks
   where owner_wallet = lower(new.owner_wallet)
     and active = true
     and id <> new.id;

  if active_count >= 5 then
    raise exception 'webhook owner quota exceeded'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_webhook_owner_quota() from public;

drop trigger if exists webhooks_owner_quota on public.webhooks;
create trigger webhooks_owner_quota
before insert or update of active, owner_wallet
on public.webhooks
for each row execute function public.enforce_webhook_owner_quota();

-- Delivery workers must not update failure_count from a stale row snapshot.
-- Completion order defines the consecutive-failure order. Once deactivated,
-- an older in-flight success cannot silently reactivate or reset the webhook.
create or replace function public.record_webhook_delivery_result_atomic(
  p_webhook_id uuid,
  p_succeeded boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_webhook public.webhooks%rowtype;
  v_failure_count integer;
begin
  if p_webhook_id is null or p_succeeded is null then
    raise exception using
      errcode = '22023',
      message = 'Webhook delivery result input is invalid.';
  end if;

  select *
    into v_webhook
    from public.webhooks
    where id = p_webhook_id
    for update;

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;

  if not v_webhook.active then
    return jsonb_build_object(
      'state', 'inactive',
      'failure_count', v_webhook.failure_count,
      'active', false
    );
  end if;

  if p_succeeded then
    update public.webhooks
       set failure_count = 0,
           updated_at = clock_timestamp()
     where id = p_webhook_id
     returning * into v_webhook;

    return jsonb_build_object(
      'state', 'succeeded',
      'failure_count', 0,
      'active', true
    );
  end if;

  -- Saturate at the deactivation threshold so integer growth and concurrent
  -- stale writes cannot keep an invalid endpoint active.
  v_failure_count := least(greatest(v_webhook.failure_count, 0), 9) + 1;
  update public.webhooks
     set failure_count = v_failure_count,
         active = v_failure_count < 10,
         updated_at = clock_timestamp()
   where id = p_webhook_id
   returning * into v_webhook;

  return jsonb_build_object(
    'state', case when v_webhook.active then 'failed' else 'deactivated' end,
    'failure_count', v_webhook.failure_count,
    'active', v_webhook.active
  );
end;
$$;

revoke all on function public.record_webhook_delivery_result_atomic(
  uuid,
  boolean
) from public, anon, authenticated;

grant execute on function public.record_webhook_delivery_result_atomic(
  uuid,
  boolean
) to service_role;

-- ───── Remove global PSP and event enumeration ─────

-- A valid create/delete signature is a one-time mutation authorization. The
-- digest is the EIP-712 typed-data digest, so global digest uniqueness is the
-- replay boundary. Rows live only briefly beyond the five-minute signature
-- lifetime and are pruned transactionally by later successful calls.
create table public.webhook_mutation_authorization_consumptions (
  authorization_digest text primary key
    check (authorization_digest ~ '^0x[0-9a-f]{64}$'),
  owner_wallet text not null
    check (owner_wallet ~ '^0x[0-9a-f]{40}$'),
  action text not null
    check (action in ('create', 'delete')),
  consumed_at timestamptz not null default now()
);

create index webhook_mutation_authorization_consumptions_time_idx
  on public.webhook_mutation_authorization_consumptions (consumed_at);

alter table public.webhook_mutation_authorization_consumptions
  enable row level security;
revoke all on public.webhook_mutation_authorization_consumptions
  from public, anon, authenticated;

create or replace function public.consume_webhook_mutation_authorization(
  p_digest text,
  p_owner_wallet text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digest text := lower(p_digest);
  v_owner_wallet text := lower(p_owner_wallet);
  v_inserted integer;
begin
  if p_digest is null
     or v_digest !~ '^0x[0-9a-f]{64}$'
     or p_owner_wallet is null
     or v_owner_wallet !~ '^0x[0-9a-f]{40}$'
     or p_action is null
     or p_action not in ('create', 'delete') then
    raise exception using
      errcode = '22023',
      message = 'Webhook mutation authorization input is invalid.';
  end if;

  delete from public.webhook_mutation_authorization_consumptions
   where consumed_at < clock_timestamp() - interval '1 hour';

  insert into public.webhook_mutation_authorization_consumptions (
    authorization_digest,
    owner_wallet,
    action,
    consumed_at
  ) values (
    v_digest,
    v_owner_wallet,
    p_action,
    clock_timestamp()
  )
  on conflict (authorization_digest) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('state', 'replay');
  end if;
  return jsonb_build_object('state', 'ok');
end;
$$;

revoke all on function public.consume_webhook_mutation_authorization(
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.consume_webhook_mutation_authorization(
  text,
  text,
  text
) to service_role;

drop policy if exists "psp_documents_are_publicly_readable"
  on public.psp_documents;
revoke select on public.psp_documents from anon, authenticated;
revoke select on public.psp_documents from public;

drop policy if exists "payment_request_events_are_publicly_readable"
  on public.payment_request_events;
revoke select on public.payment_request_events from anon, authenticated;
revoke select on public.payment_request_events from public;

do $$
begin
  if exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'payment_request_events'
  ) then
    alter publication supabase_realtime
      drop table public.payment_request_events;
  end if;
end
$$;

-- The API uses these stored generated columns so address/token filters happen
-- in PostgreSQL before limits and pagination.
alter table public.psp_documents
  add column if not exists invoice_recipient text
    generated always as (lower(document #>> '{invoice,recipient}')) stored,
  add column if not exists invoice_payer text
    generated always as (lower(document #>> '{invoice,payer}')) stored,
  add column if not exists invoice_token text
    generated always as (document #>> '{invoice,token}') stored;

create index if not exists psp_documents_statement_recipient_idx
  on public.psp_documents (network_mode, invoice_recipient, created_at, uid)
  where invoice_recipient is not null;

create index if not exists psp_documents_statement_payer_idx
  on public.psp_documents (network_mode, invoice_payer, created_at, uid)
  where invoice_payer is not null;

create index if not exists psp_documents_statement_token_idx
  on public.psp_documents (network_mode, invoice_token, created_at, uid)
  where invoice_token is not null;

-- ───── Private QR-creation reservation state ─────

create table public.payment_request_creation_reservations (
  authorization_digest text primary key
    check (authorization_digest ~ '^0x[0-9a-f]{64}$'),
  request_id uuid not null unique
    references public.payment_requests(id) on delete restrict,
  sender_wallet text not null check (sender_wallet ~ '^0x[0-9a-f]{40}$'),
  target_handle extensions.citext
    references public.disburse_ids(handle) on delete set null,
  reserved_at timestamptz not null default now()
);

create index request_creation_reservations_wallet_time_idx
  on public.payment_request_creation_reservations
    (sender_wallet, reserved_at desc);

create index request_creation_reservations_time_idx
  on public.payment_request_creation_reservations
    (reserved_at);

create index request_creation_reservations_target_time_idx
  on public.payment_request_creation_reservations
    (target_handle, reserved_at desc)
  where target_handle is not null;

create index request_creation_reservations_sender_target_time_idx
  on public.payment_request_creation_reservations
    (sender_wallet, target_handle, reserved_at desc)
  where target_handle is not null;

alter table public.payment_request_creation_reservations enable row level security;
revoke all on public.payment_request_creation_reservations from anon, authenticated;
revoke all on public.payment_request_creation_reservations from public;

-- QR bearer capabilities must survive a browser refresh without ever being
-- stored in plaintext or exposed through the public payment-request row. The
-- application encrypts each capability with AES-256-GCM and binds its AAD to
-- the owner wallet plus request id before this private row is inserted by the
-- atomic creation RPC.
create table public.payment_request_capabilities (
  request_id uuid primary key
    references public.payment_requests(id) on delete cascade,
  owner_wallet text not null check (owner_wallet ~ '^0x[0-9a-f]{40}$'),
  capability_envelope jsonb not null
    check (
      jsonb_typeof(capability_envelope) = 'object'
      and octet_length(capability_envelope::text) between 80 and 4096
    ),
  created_at timestamptz not null default now()
);

create index payment_request_capabilities_owner_created_idx
  on public.payment_request_capabilities (owner_wallet, created_at desc, request_id);

alter table public.payment_request_capabilities enable row level security;
revoke all on public.payment_request_capabilities from anon, authenticated;
revoke all on public.payment_request_capabilities from public;
grant select, insert, update, delete on public.payment_request_capabilities to service_role;

-- There is deliberately no standalone "reserve" RPC. Reserving quota without
-- inserting the request can consume a one-time signature while losing the only
-- copy of its raw capability. Migration 202607290103 installs the combined
-- create_payment_request_atomic RPC after the evidence schema is ready.
