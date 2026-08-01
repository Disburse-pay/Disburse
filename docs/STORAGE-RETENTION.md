# Storage retention

Disburse keeps canonical `payment_requests`, `payment_receipts`, and
`psp_documents`. They are the reconciliation ledger and are not cache data.

Redis stores only hashed rate-limit counters with a 60-second TTL. It never
stores payment payloads, history, replay state, bridge state, or bearer
capabilities. Configure either `REDIS_URL` or the Upstash REST pair, never both.

Migration `202607310104_operational_retention.sql` installs a service-role-only
maintenance RPC. It can run at most once per 23 hours unless an operator passes
`p_force = true` and removes only:

- encrypted QR capabilities for terminal requests older than 30 days;
- redundant request events for terminal requests older than 90 days;
- read/ignored notifications older than 30 days; and
- unread notifications older than 180 days.

After staging validation, schedule this call once daily with Supabase Cron or an
authenticated operator job:

```sql
select public.prune_disburse_operational_data();
```

Do not expose the RPC through an anonymous HTTP endpoint. Review returned row
counts and table statistics during the first production week. PostgreSQL space
may remain allocated for reuse after deletes; routine autovacuum should reclaim
dead tuples without a blocking `VACUUM FULL`.
