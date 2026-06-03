-- PSP issuance observability
-- Adds the 'psp_error' event type so a swallowed PSP-issuance failure leaves a
-- queryable trace on payment_request_events, instead of only a server log line
-- that rolls off. A 'pending' PSP then becomes distinguishable from one that
-- actively failed to issue (and the reason is captured in `message`).
-- Widening the allowed set only; no data migration needed.

alter table public.payment_request_events
  drop constraint if exists payment_request_events_event_type_check;

alter table public.payment_request_events
  add constraint payment_request_events_event_type_check
  check (event_type in ('submitted', 'paid', 'failed', 'expired', 'proving', 'settling', 'settled', 'psp_issue', 'psp_error'));
