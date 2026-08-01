-- Fail-closed payment rollout barrier and transactional server RPCs.
--
-- Do not weaken these checks to make a deployment pass. Migration 102 added
-- exact-evidence columns under NOT VALID constraints so operators can backfill
-- block_hash, settlement_log_index, and chain_id from canonical successful
-- receipts.
-- This migration refuses to proceed while any legacy ambiguity remains.

do $preflight$
declare
  v_count bigint;
begin
  select count(*)
    into v_count
    from (
      select lower(tx_hash)
        from public.payment_receipts
       group by lower(tx_hash)
      having count(*) > 1
    ) duplicate_hashes;
  if v_count > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'Payment integrity preflight failed: %s case-insensitive transaction hash collision group(s).',
        v_count
      ),
      hint = 'Quarantine and adjudicate every duplicate receipt manually; do not delete or merge automatically.';
  end if;

  select count(*)
    into v_count
    from public.payment_requests request_row
    left join public.payment_receipts receipt_row
      on receipt_row.request_id = request_row.id
   where request_row.status = 'paid'
     and receipt_row.request_id is null;
  if v_count > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'Payment integrity preflight failed: %s paid request(s) have no receipt.',
        v_count
      ),
      hint = 'Reconstruct exact evidence from the canonical chain or quarantine the request; do not synthesize a receipt.';
  end if;

  select count(*)
    into v_count
    from public.payment_receipts receipt_row
    join public.payment_requests request_row
      on request_row.id = receipt_row.request_id
   where request_row.status <> 'paid';
  if v_count > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'Payment integrity preflight failed: %s receipt(s) belong to a request that is not paid.',
        v_count
      ),
      hint = 'Investigate and quarantine inconsistent rows; this migration never changes payment status.';
  end if;

  select count(*)
    into v_count
    from public.payment_receipts receipt_row
    join public.payment_requests request_row
      on request_row.id = receipt_row.request_id
   where request_row.tx_hash is null
      or lower(request_row.tx_hash) <> lower(receipt_row.tx_hash)
      or lower(request_row.recipient) <> lower(receipt_row.recipient)
      or request_row.token <> receipt_row.token
      or request_row.amount <> receipt_row.amount;
  if v_count > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'Payment integrity preflight failed: %s request/receipt pair(s) disagree on payment identity.',
        v_count
      ),
      hint = 'Verify transaction, recipient, token, and amount from canonical chain evidence before proceeding.';
  end if;

  select count(*)
    into v_count
    from public.payment_requests
   where start_block !~ '^(0|[1-9][0-9]{0,77})$'
      or char_length(amount) > 80
      or amount !~ '^([1-9][0-9]*|(0|[1-9][0-9]*)\.[0-9]{0,5}[1-9])$'
      or not isfinite(created_at)
      or (expires_at is not null and not isfinite(expires_at))
      or (due_at is not null and not isfinite(due_at));
  if v_count > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'Payment integrity preflight failed: %s request row(s) contain invalid block, amount, or timestamp data.',
        v_count
      ),
      hint = 'Quarantine invalid legacy requests; do not normalize financially relevant values automatically.';
  end if;

  select count(*)
    into v_count
    from public.payment_receipts
   where block_number !~ '^(0|[1-9][0-9]{0,77})$'
      or char_length(amount) > 80
      or amount !~ '^([1-9][0-9]*|(0|[1-9][0-9]*)\.[0-9]{0,5}[1-9])$'
      or not isfinite(confirmed_at)
      or block_hash is null
      or block_hash !~ '^0x[0-9a-f]{64}$'
      or settlement_log_index is null
      or settlement_log_index < 0
      or chain_id is null
      or chain_id < 1;
  if v_count > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'Payment integrity preflight failed: %s receipt row(s) lack exact canonical block/log evidence or contain invalid values.',
        v_count
      ),
      hint = 'Backfill block_hash, settlement_log_index, and chain_id from the exact successful receipt; quarantine ambiguous transactions.';
  end if;
end
$preflight$;

alter table public.payment_requests
  validate constraint payment_requests_start_block_format;

alter table public.payment_receipts
  validate constraint payment_receipts_block_number_format;

alter table public.payment_receipts
  validate constraint payment_receipts_confirmed_at_finite;

alter table public.payment_receipts
  validate constraint payment_receipts_exact_evidence_required;

-- Ethereum transaction hashes are byte values. Display casing must never create
-- another claim. The legacy case-sensitive UNIQUE constraint remains as an
-- additional invariant.
create unique index payment_receipts_tx_hash_lower_key
  on public.payment_receipts (lower(tx_hash));

-- Unsafe draft RPCs are intentionally removed. Callers must use the combined
-- transactional boundaries below.
drop function if exists public.reserve_payment_request_creation(
  text,
  text,
  text,
  integer,
  integer,
  integer
);

drop function if exists public.record_qr_submission_atomic(uuid, text);

drop function if exists public.create_payment_request_atomic(
  text,
  text,
  text,
  integer,
  integer,
  integer,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text
);

drop function if exists public.confirm_qr_payment_atomic(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text
);

-- Authenticated creation, replay reservation, quota consumption, and request
-- insertion are one transaction. The raw capability is never persisted: this
-- RPC stores its lowercase SHA-256 digest plus an owner-bound AES-GCM envelope
-- in the private capability table used by wallet-authenticated history reads.
create or replace function public.create_payment_request_atomic(
  p_authorization_digest text,
  p_sender_wallet text,
  p_target_handle text,
  p_wallet_limit integer,
  p_sender_target_limit integer,
  p_target_limit integer,
  p_request_id uuid,
  p_request_token_hash text,
  p_capability_envelope jsonb,
  p_recipient text,
  p_token text,
  p_amount text,
  p_label text,
  p_note text,
  p_invoice_date date,
  p_start_block text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  normalized_sender text := lower(p_sender_wallet);
  normalized_recipient text := lower(p_recipient);
  normalized_digest text := lower(p_authorization_digest);
  normalized_target extensions.citext :=
    nullif(lower(btrim(coalesce(p_target_handle, ''))), '')::extensions.citext;
  v_now timestamptz := clock_timestamp();
  window_start timestamptz;
  v_request public.payment_requests%rowtype;
begin
  window_start := v_now - interval '1 hour';

  if p_request_id is null
     or normalized_digest is null
     or normalized_digest !~ '^0x[0-9a-f]{64}$'
     or normalized_sender is null
     or normalized_sender !~ '^0x[0-9a-f]{40}$'
     or normalized_recipient is null
     or normalized_recipient !~ '^0x[0-9a-f]{40}$'
     or normalized_sender <> normalized_recipient
     or p_request_token_hash is null
     or p_request_token_hash !~ '^[0-9a-f]{64}$'
     or p_capability_envelope is null
     or jsonb_typeof(p_capability_envelope) <> 'object'
     or p_capability_envelope ->> 'version' <> '1'
     or p_capability_envelope ->> 'algorithm' <> 'A256GCM'
     or coalesce(p_capability_envelope ->> 'iv', '') !~ '^[A-Za-z0-9_-]{16}$'
     or coalesce(p_capability_envelope ->> 'ciphertext', '') !~ '^[A-Za-z0-9_-]{86}$'
     or coalesce(p_capability_envelope ->> 'tag', '') !~ '^[A-Za-z0-9_-]{22}$'
     or octet_length(p_capability_envelope::text) > 4096
     or p_token is null
     or p_token <> 'USDC'
     or p_amount is null
     or char_length(p_amount) > 80
     or p_amount !~ '^([1-9][0-9]*|(0|[1-9][0-9]*)\.[0-9]{0,5}[1-9])$'
     or p_label is null
     or char_length(p_label) < 1
     or char_length(p_label) > 80
     or p_label <> btrim(p_label)
     or (
       p_note is not null
       and (
         char_length(p_note) < 1
         or char_length(p_note) > 240
         or p_note <> btrim(p_note)
       )
     )
     or p_invoice_date is null
     or p_start_block is null
     or p_start_block !~ '^[1-9][0-9]{0,77}$'
     or p_wallet_limit is null
     or p_wallet_limit < 1
     or p_wallet_limit > 20
     or p_sender_target_limit is null
     or p_sender_target_limit < 1
     or p_sender_target_limit > 5
     or p_target_limit is null
     or p_target_limit < 1
     or p_target_limit > 20 then
    raise exception using
      errcode = '22023',
      message = 'Payment request creation input is invalid.';
  end if;

  if normalized_target is not null
     and (
       normalized_target::text !~ '^[a-z0-9_]{3,16}$'
       or not exists (
         select 1
           from public.disburse_ids
          where handle = normalized_target
       )
     ) then
    return jsonb_build_object('state', 'target_not_found');
  end if;

  -- Every caller takes the wallet lock first, then the optional target lock.
  perform pg_advisory_xact_lock(
    hashtextextended('qr-wallet:' || normalized_sender, 0)
  );
  if normalized_target is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('qr-target:' || normalized_target::text, 0)
    );
  end if;

  delete from public.payment_request_creation_reservations
   where reserved_at < v_now - interval '24 hours';

  if exists (
    select 1
      from public.payment_request_creation_reservations
     where authorization_digest = normalized_digest
  ) then
    return jsonb_build_object('state', 'replay');
  end if;

  if (
    select count(*)
      from public.payment_request_creation_reservations
     where sender_wallet = normalized_sender
       and reserved_at >= window_start
  ) >= p_wallet_limit then
    return jsonb_build_object('state', 'wallet_rate_limited');
  end if;

  if normalized_target is not null then
    if (
      select count(*)
        from public.payment_request_creation_reservations
       where target_handle = normalized_target
         and reserved_at >= window_start
    ) >= p_target_limit then
      return jsonb_build_object('state', 'target_rate_limited');
    end if;

    if (
      select count(*)
        from public.payment_request_creation_reservations
       where target_handle = normalized_target
         and sender_wallet = normalized_sender
         and reserved_at >= window_start
    ) >= p_sender_target_limit then
      return jsonb_build_object('state', 'sender_target_rate_limited');
    end if;
  end if;

  insert into public.payment_requests (
    id,
    mode,
    recipient,
    token,
    amount,
    label,
    note,
    invoice_date,
    expires_at,
    due_at,
    created_at,
    submitted_at,
    start_block,
    status,
    tx_hash,
    failure_reason,
    updated_at,
    request_token_hash
  ) values (
    p_request_id,
    'arc',
    normalized_recipient,
    p_token,
    p_amount,
    p_label,
    p_note,
    p_invoice_date,
    v_now + interval '15 minutes',
    null,
    v_now,
    null,
    p_start_block,
    'open',
    null,
    null,
    v_now,
    p_request_token_hash
  )
  returning * into v_request;

  insert into public.payment_request_capabilities (
    request_id,
    owner_wallet,
    capability_envelope,
    created_at
  ) values (
    p_request_id,
    normalized_sender,
    p_capability_envelope,
    v_now
  );

  insert into public.payment_request_creation_reservations (
    authorization_digest,
    request_id,
    sender_wallet,
    target_handle,
    reserved_at
  ) values (
    normalized_digest,
    p_request_id,
    normalized_sender,
    normalized_target,
    v_now
  );

  return jsonb_build_object(
    'state', 'created',
    'request', to_jsonb(v_request) - 'request_token_hash'
  );
exception
  when unique_violation then
    if exists (
      select 1
        from public.payment_request_creation_reservations
       where authorization_digest = normalized_digest
    ) then
      return jsonb_build_object('state', 'replay');
    end if;
    if exists (
      select 1
        from public.payment_requests
       where id = p_request_id
          or request_token_hash = p_request_token_hash
    ) or exists (
      select 1
        from public.payment_request_creation_reservations
       where request_id = p_request_id
    ) then
      return jsonb_build_object('state', 'request_conflict');
    end if;
    raise;
end;
$$;

-- Return one coherent request/receipt snapshot and perform the expiry
-- transition plus its event under the same request-row lock.
create or replace function public.get_qr_payment_status_atomic(
  p_request_id uuid,
  p_request_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_receipt public.payment_receipts%rowtype;
  v_has_receipt boolean := false;
  v_expired_now boolean := false;
  v_now timestamptz := clock_timestamp();
  v_expiry timestamptz;
begin
  if p_request_id is null
     or p_request_token_hash is null
     or p_request_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'Payment status capability input is invalid.';
  end if;

  select *
    into v_request
    from public.payment_requests
    where id = p_request_id
    for update;

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;
  if v_request.request_token_hash is null then
    return jsonb_build_object('state', 'legacy_request');
  end if;
  if v_request.request_token_hash <> p_request_token_hash then
    return jsonb_build_object('state', 'forbidden');
  end if;

  v_expiry := coalesce(v_request.expires_at, v_request.due_at);
  if v_request.status not in ('paid', 'failed', 'expired')
     and v_expiry is not null
     and v_now > v_expiry then
    update public.payment_requests
       set status = 'expired',
           failure_reason = null,
           updated_at = v_now
     where id = p_request_id
     returning * into v_request;

    insert into public.payment_request_events (
      request_id,
      event_type,
      status,
      message,
      tx_hash,
      submitted_at
    ) values (
      p_request_id,
      'expired',
      'expired',
      'This QR request expired before a valid payment was confirmed.',
      v_request.tx_hash,
      v_request.submitted_at
    );
    v_expired_now := true;
  end if;

  select *
    into v_receipt
    from public.payment_receipts
    where request_id = p_request_id;
  v_has_receipt := found;

  if (v_request.status = 'paid' and not v_has_receipt)
     or (v_request.status <> 'paid' and v_has_receipt) then
    return jsonb_build_object('state', 'inconsistent');
  end if;

  if v_has_receipt
     and (
       v_request.tx_hash is null
       or lower(v_request.tx_hash) <> lower(v_receipt.tx_hash)
       or lower(v_request.recipient) <> lower(v_receipt.recipient)
       or v_request.token <> v_receipt.token
       or v_request.amount <> v_receipt.amount
     ) then
    return jsonb_build_object('state', 'inconsistent');
  end if;

  return jsonb_build_object(
    'state', 'snapshot',
    'expired_now', v_expired_now,
    'request', to_jsonb(v_request) - 'request_token_hash',
    'receipt', case when v_has_receipt then to_jsonb(v_receipt) else null end
  );
end;
$$;

-- Submission is advisory and therefore deliberately single-assignment. A
-- repeated identical hash is idempotent; a different hash never overwrites it.
create or replace function public.record_qr_submission_atomic(
  p_request_id uuid,
  p_request_token_hash text,
  p_tx_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_now timestamptz := clock_timestamp();
  v_expiry timestamptz;
begin
  if p_request_id is null
     or p_request_token_hash is null
     or p_request_token_hash !~ '^[0-9a-f]{64}$'
     or p_tx_hash is null
     or p_tx_hash !~* '^0x[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'Payment submission input is invalid.';
  end if;

  select *
    into v_request
    from public.payment_requests
    where id = p_request_id
    for update;

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;
  if v_request.request_token_hash is null then
    return jsonb_build_object('state', 'legacy_request');
  end if;
  if v_request.request_token_hash <> p_request_token_hash then
    return jsonb_build_object('state', 'forbidden');
  end if;
  if v_request.status = 'paid' then
    return jsonb_build_object(
      'state', 'paid',
      'request', to_jsonb(v_request) - 'request_token_hash'
    );
  end if;

  if v_request.status = 'expired' then
    return jsonb_build_object(
      'state', 'expired',
      'request', to_jsonb(v_request) - 'request_token_hash'
    );
  end if;

  v_expiry := coalesce(v_request.expires_at, v_request.due_at);
  if v_expiry is not null and v_now > v_expiry then
    if v_request.status <> 'expired' then
      update public.payment_requests
         set status = 'expired',
             failure_reason = null,
             updated_at = v_now
       where id = p_request_id
       returning * into v_request;

      insert into public.payment_request_events (
        request_id,
        event_type,
        status,
        message,
        tx_hash,
        submitted_at
      ) values (
        p_request_id,
        'expired',
        'expired',
        'This QR request expired before a valid payment was confirmed.',
        v_request.tx_hash,
        v_request.submitted_at
      );
    end if;

    return jsonb_build_object(
      'state', 'expired',
      'request', to_jsonb(v_request) - 'request_token_hash'
    );
  end if;

  if v_request.status <> 'open' then
    return jsonb_build_object(
      'state', 'closed',
      'request', to_jsonb(v_request) - 'request_token_hash'
    );
  end if;

  if v_request.tx_hash is not null then
    if lower(v_request.tx_hash) = lower(p_tx_hash) then
      return jsonb_build_object(
        'state', 'already_submitted',
        'request', to_jsonb(v_request) - 'request_token_hash'
      );
    end if;
    return jsonb_build_object('state', 'submission_conflict');
  end if;

  if v_request.submitted_at is not null then
    return jsonb_build_object('state', 'submission_conflict');
  end if;

  update public.payment_requests
     set submitted_at = v_now,
         tx_hash = lower(p_tx_hash),
         failure_reason = null,
         updated_at = v_now
   where id = p_request_id
   returning * into v_request;

  insert into public.payment_request_events (
    request_id,
    event_type,
    status,
    message,
    tx_hash,
    submitted_at
  ) values (
    p_request_id,
    'submitted',
    'open',
    'Payment submitted. Waiting for on-chain confirmation.',
    lower(p_tx_hash),
    v_request.submitted_at
  );

  return jsonb_build_object(
    'state', 'submitted',
    'request', to_jsonb(v_request) - 'request_token_hash'
  );
end;
$$;

-- Confirm one exact on-chain receipt. Request state, exact receipt evidence,
-- and the paid event commit together.
create or replace function public.confirm_qr_payment_atomic(
  p_request_id uuid,
  p_request_token_hash text,
  p_tx_hash text,
  p_payer text,
  p_recipient text,
  p_token text,
  p_amount text,
  p_block_number text,
  p_block_hash text,
  p_settlement_log_index integer,
  p_confirmed_at timestamptz,
  p_explorer_url text,
  p_chain_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_receipt public.payment_receipts%rowtype;
  v_claimed_request_id uuid;
  v_now timestamptz := clock_timestamp();
  v_expiry timestamptz;
begin
  if p_request_id is null
     or p_request_token_hash is null
     or p_request_token_hash !~ '^[0-9a-f]{64}$'
     or p_tx_hash is null
     or p_tx_hash !~* '^0x[0-9a-f]{64}$'
     or p_payer is null
     or p_payer !~* '^0x[0-9a-f]{40}$'
     or p_recipient is null
     or p_recipient !~* '^0x[0-9a-f]{40}$'
     or p_token is null
     or p_token not in ('USDC', 'EURC')
     or p_amount is null
     or char_length(p_amount) > 80
     or p_amount !~ '^([1-9][0-9]*|(0|[1-9][0-9]*)\.[0-9]{0,5}[1-9])$'
     or p_block_number is null
     or p_block_number !~ '^(0|[1-9][0-9]{0,77})$'
     or p_block_hash is null
     or p_block_hash !~* '^0x[0-9a-f]{64}$'
     or p_settlement_log_index is null
     or p_settlement_log_index < 0
     or p_confirmed_at is null
     or not isfinite(p_confirmed_at)
     or p_explorer_url is null
     or char_length(p_explorer_url) > 2048
     or p_explorer_url !~ '^https://'
     or p_chain_id is null
     or p_chain_id < 1 then
    raise exception using
      errcode = '22023',
      message = 'Payment confirmation input is invalid.';
  end if;

  -- All exact writers acquire the transaction lock before a request-row lock.
  perform pg_advisory_xact_lock(
    hashtextextended('payment-tx:' || lower(p_tx_hash), 0)
  );

  select *
    into v_request
    from public.payment_requests
    where id = p_request_id
    for update;

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;
  if v_request.request_token_hash is null then
    return jsonb_build_object('state', 'legacy_request');
  end if;
  if v_request.request_token_hash <> p_request_token_hash then
    return jsonb_build_object('state', 'forbidden');
  end if;

  if v_request.status = 'paid' then
    select *
      into v_receipt
      from public.payment_receipts
      where request_id = p_request_id;

    if not found then
      return jsonb_build_object('state', 'inconsistent');
    end if;

    if lower(v_request.tx_hash) is distinct from lower(v_receipt.tx_hash)
       or lower(v_request.recipient) is distinct from lower(v_receipt.recipient)
       or v_request.token is distinct from v_receipt.token
       or v_request.amount is distinct from v_receipt.amount then
      return jsonb_build_object('state', 'inconsistent');
    end if;

    if lower(v_receipt.tx_hash) = lower(p_tx_hash)
       and lower(v_receipt.payer) = lower(p_payer)
       and lower(v_receipt.recipient) = lower(p_recipient)
       and v_receipt.token = p_token
       and v_receipt.amount = p_amount
       and v_receipt.block_number = p_block_number
       and lower(v_receipt.block_hash) = lower(p_block_hash)
       and v_receipt.settlement_log_index = p_settlement_log_index
       and v_receipt.confirmed_at = p_confirmed_at
       and v_receipt.chain_id = p_chain_id then
      return jsonb_build_object(
        'state', 'already_confirmed',
        'request', to_jsonb(v_request) - 'request_token_hash',
        'receipt', to_jsonb(v_receipt)
      );
    end if;

    return jsonb_build_object('state', 'request_conflict');
  end if;

  if lower(p_recipient) <> lower(v_request.recipient)
     or p_token <> v_request.token
     or p_amount <> v_request.amount then
    return jsonb_build_object('state', 'request_mismatch');
  end if;

  v_expiry := coalesce(v_request.expires_at, v_request.due_at);
  if p_block_number::numeric < v_request.start_block::numeric
     or (v_expiry is not null and p_confirmed_at > v_expiry) then
    return jsonb_build_object('state', 'outside_payment_window');
  end if;

  select request_id
    into v_claimed_request_id
    from public.payment_receipts
    where lower(tx_hash) = lower(p_tx_hash);

  if found then
    if v_claimed_request_id = p_request_id then
      return jsonb_build_object('state', 'inconsistent');
    end if;
    return jsonb_build_object('state', 'transaction_claimed');
  end if;

  insert into public.payment_receipts (
    request_id,
    tx_hash,
    payer,
    recipient,
    token,
    amount,
    block_number,
    block_hash,
    settlement_log_index,
    confirmed_at,
    explorer_url,
    chain_id
  ) values (
    p_request_id,
    lower(p_tx_hash),
    lower(p_payer),
    lower(p_recipient),
    p_token,
    p_amount,
    p_block_number,
    lower(p_block_hash),
    p_settlement_log_index,
    p_confirmed_at,
    p_explorer_url,
    p_chain_id
  )
  returning * into v_receipt;

  update public.payment_requests
     set submitted_at = coalesce(submitted_at, v_now),
         status = 'paid',
         tx_hash = lower(p_tx_hash),
         failure_reason = null,
         updated_at = v_now
   where id = p_request_id
   returning * into v_request;

  insert into public.payment_request_events (
    request_id,
    event_type,
    status,
    message,
    tx_hash,
    submitted_at,
    receipt
  ) values (
    p_request_id,
    'paid',
    'paid',
    'Payment confirmed. Invoice is ready.',
    lower(p_tx_hash),
    v_request.submitted_at,
    to_jsonb(v_receipt)
  );

  return jsonb_build_object(
    'state', 'confirmed',
    'request', to_jsonb(v_request) - 'request_token_hash',
    'receipt', to_jsonb(v_receipt)
  );
exception
  when unique_violation then
    select request_id
      into v_claimed_request_id
      from public.payment_receipts
      where lower(tx_hash) = lower(p_tx_hash);
    if found then
      if v_claimed_request_id = p_request_id then
        return jsonb_build_object('state', 'inconsistent');
      end if;
      return jsonb_build_object('state', 'transaction_claimed');
    end if;
    if exists (
      select 1
        from public.payment_receipts
       where request_id = p_request_id
    ) then
      return jsonb_build_object('state', 'inconsistent');
    end if;
    raise;
end;
$$;

-- Direct registration uses the same exact-evidence and replay boundary. A
-- receipt failure can never leave behind an orphan paid request.
create or replace function public.record_direct_payment_atomic(
  p_request_id uuid,
  p_tx_hash text,
  p_payer text,
  p_recipient text,
  p_token text,
  p_amount text,
  p_label text,
  p_note text,
  p_invoice_date date,
  p_block_number text,
  p_block_hash text,
  p_settlement_log_index integer,
  p_confirmed_at timestamptz,
  p_explorer_url text,
  p_chain_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_receipt public.payment_receipts%rowtype;
  v_claimed_request_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_request_id is null
     or p_tx_hash is null
     or p_tx_hash !~* '^0x[0-9a-f]{64}$'
     or p_payer is null
     or p_payer !~* '^0x[0-9a-f]{40}$'
     or p_recipient is null
     or p_recipient !~* '^0x[0-9a-f]{40}$'
     or p_token is null
     or p_token not in ('USDC', 'EURC')
     or p_amount is null
     or char_length(p_amount) > 80
     or p_amount !~ '^([1-9][0-9]*|(0|[1-9][0-9]*)\.[0-9]{0,5}[1-9])$'
     or p_label is null
     or char_length(p_label) < 1
     or char_length(p_label) > 80
     or p_label <> btrim(p_label)
     or (
       p_note is not null
       and (
         char_length(p_note) < 1
         or char_length(p_note) > 240
         or p_note <> btrim(p_note)
       )
     )
     or p_block_number is null
     or p_block_number !~ '^(0|[1-9][0-9]{0,77})$'
     or p_block_hash is null
     or p_block_hash !~* '^0x[0-9a-f]{64}$'
     or p_settlement_log_index is null
     or p_settlement_log_index < 0
     or p_confirmed_at is null
     or not isfinite(p_confirmed_at)
     or p_explorer_url is null
     or char_length(p_explorer_url) > 2048
     or p_explorer_url !~ '^https://'
     or p_chain_id is null
     or p_chain_id < 1 then
    raise exception using
      errcode = '22023',
      message = 'Direct payment input is invalid.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('payment-tx:' || lower(p_tx_hash), 0)
  );

  select *
    into v_request
    from public.payment_requests
    where id = p_request_id
    for update;

  if found then
    if v_request.status <> 'paid'
       or lower(v_request.recipient) <> lower(p_recipient)
       or v_request.token <> p_token
       or v_request.amount <> p_amount
       or v_request.label <> p_label
       or v_request.note is distinct from p_note
       or v_request.invoice_date is distinct from p_invoice_date
       or v_request.start_block <> p_block_number
       or v_request.tx_hash is null
       or lower(v_request.tx_hash) <> lower(p_tx_hash) then
      return jsonb_build_object('state', 'request_conflict');
    end if;

    select *
      into v_receipt
      from public.payment_receipts
      where request_id = p_request_id;

    if not found
       or lower(v_receipt.tx_hash) is distinct from lower(p_tx_hash)
       or lower(v_receipt.payer) is distinct from lower(p_payer)
       or lower(v_receipt.recipient) is distinct from lower(p_recipient)
       or v_receipt.token is distinct from p_token
       or v_receipt.amount is distinct from p_amount
       or v_receipt.block_number is distinct from p_block_number
       or lower(v_receipt.block_hash) is distinct from lower(p_block_hash)
       or v_receipt.settlement_log_index is distinct from p_settlement_log_index
       or v_receipt.confirmed_at is distinct from p_confirmed_at
       or v_receipt.chain_id is distinct from p_chain_id then
      return jsonb_build_object('state', 'request_conflict');
    end if;

    return jsonb_build_object(
      'state', 'already_recorded',
      'request', to_jsonb(v_request) - 'request_token_hash',
      'receipt', to_jsonb(v_receipt)
    );
  end if;

  select request_id
    into v_claimed_request_id
    from public.payment_receipts
    where lower(tx_hash) = lower(p_tx_hash);
  if found then
    return jsonb_build_object('state', 'transaction_claimed');
  end if;

  insert into public.payment_requests (
    id,
    mode,
    recipient,
    token,
    amount,
    label,
    note,
    invoice_date,
    expires_at,
    due_at,
    created_at,
    submitted_at,
    start_block,
    status,
    tx_hash,
    failure_reason,
    updated_at,
    request_token_hash
  ) values (
    p_request_id,
    'arc',
    lower(p_recipient),
    p_token,
    p_amount,
    p_label,
    p_note,
    p_invoice_date,
    null,
    null,
    v_now,
    p_confirmed_at,
    p_block_number,
    'paid',
    lower(p_tx_hash),
    null,
    v_now,
    null
  )
  returning * into v_request;

  insert into public.payment_receipts (
    request_id,
    tx_hash,
    payer,
    recipient,
    token,
    amount,
    block_number,
    block_hash,
    settlement_log_index,
    confirmed_at,
    explorer_url,
    chain_id
  ) values (
    p_request_id,
    lower(p_tx_hash),
    lower(p_payer),
    lower(p_recipient),
    p_token,
    p_amount,
    p_block_number,
    lower(p_block_hash),
    p_settlement_log_index,
    p_confirmed_at,
    p_explorer_url,
    p_chain_id
  )
  returning * into v_receipt;

  insert into public.payment_request_events (
    request_id,
    event_type,
    status,
    message,
    tx_hash,
    submitted_at,
    receipt
  ) values (
    p_request_id,
    'paid',
    'paid',
    'Direct payment recorded with exact on-chain evidence.',
    lower(p_tx_hash),
    p_confirmed_at,
    to_jsonb(v_receipt)
  );

  return jsonb_build_object(
    'state', 'recorded',
    'request', to_jsonb(v_request) - 'request_token_hash',
    'receipt', to_jsonb(v_receipt)
  );
exception
  when unique_violation then
    select request_id
      into v_claimed_request_id
      from public.payment_receipts
      where lower(tx_hash) = lower(p_tx_hash);
    if found and v_claimed_request_id <> p_request_id then
      return jsonb_build_object('state', 'transaction_claimed');
    end if;
    if found
       or exists (
         select 1
           from public.payment_requests
          where id = p_request_id
       )
       or exists (
         select 1
           from public.payment_receipts
          where request_id = p_request_id
       ) then
      return jsonb_build_object('state', 'request_conflict');
    end if;
    raise;
end;
$$;

-- Wallet-authenticated API callers use this service-role-only snapshot instead
-- of browser-local history. A wallet sees requests it receives and payments it
-- sent; another wallet's ledger and encrypted QR capabilities are never part
-- of the result. The extra row reports whether the caller should paginate.
create or replace function public.get_wallet_payment_history(
  p_wallet text,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_wallet text := lower(p_wallet);
  result jsonb;
begin
  if normalized_wallet is null
     or normalized_wallet !~ '^0x[0-9a-f]{40}$'
     or p_limit is null
     or p_limit < 1
     or p_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'Wallet history input is invalid.';
  end if;

  with scoped as materialized (
    select request.*
      from public.payment_requests request
     where lower(request.recipient) = normalized_wallet
        or exists (
          select 1
            from public.payment_receipts receipt
           where receipt.request_id = request.id
             and lower(receipt.payer) = normalized_wallet
        )
     order by request.created_at desc, request.id desc
     limit p_limit + 1
  ),
  visible as materialized (
    select *
      from scoped
     order by created_at desc, id desc
     limit p_limit
  )
  select jsonb_build_object(
    'requests', coalesce(
      (
        select jsonb_agg(
          (to_jsonb(request_row) - 'request_token_hash')
          order by request_row.created_at desc, request_row.id desc
        )
          from visible request_row
      ),
      '[]'::jsonb
    ),
    'receipts', coalesce(
      (
        select jsonb_agg(
          to_jsonb(receipt_row)
          order by receipt_row.confirmed_at desc, receipt_row.request_id desc
        )
          from public.payment_receipts receipt_row
          join visible request_row on request_row.id = receipt_row.request_id
      ),
      '[]'::jsonb
    ),
    'capabilities', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'request_id', capability.request_id,
            'capability_envelope', capability.capability_envelope
          )
          order by capability.created_at desc, capability.request_id desc
        )
          from public.payment_request_capabilities capability
          join visible request_row on request_row.id = capability.request_id
         where capability.owner_wallet = normalized_wallet
      ),
      '[]'::jsonb
    ),
    'has_more', (select count(*) > p_limit from scoped)
  ) into result;

  return result;
end;
$$;

revoke all on function public.create_payment_request_atomic(
  text,
  text,
  text,
  integer,
  integer,
  integer,
  uuid,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  date,
  text
) from public, anon, authenticated;

grant execute on function public.create_payment_request_atomic(
  text,
  text,
  text,
  integer,
  integer,
  integer,
  uuid,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  date,
  text
) to service_role;

revoke all on function public.get_qr_payment_status_atomic(
  uuid,
  text
) from public, anon, authenticated;

grant execute on function public.get_qr_payment_status_atomic(
  uuid,
  text
) to service_role;

revoke all on function public.record_qr_submission_atomic(
  uuid,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.record_qr_submission_atomic(
  uuid,
  text,
  text
) to service_role;

revoke all on function public.confirm_qr_payment_atomic(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  timestamptz,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.confirm_qr_payment_atomic(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  timestamptz,
  text,
  integer
) to service_role;

revoke all on function public.record_direct_payment_atomic(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text,
  integer,
  timestamptz,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.record_direct_payment_atomic(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text,
  integer,
  timestamptz,
  text,
  integer
) to service_role;

revoke all on function public.get_wallet_payment_history(
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.get_wallet_payment_history(
  text,
  integer
) to service_role;
