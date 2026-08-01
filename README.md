# Disburse

Disburse is a testnet receipt layer for stablecoin payments. It creates
wallet-authorized payment requests, verifies confirmed Arc token transfers,
and issues Portable Settlement Proofs (PSPs) for accounting and audit
workflows.

> **Testnet and source-availability notice**
>
> This repository is not production payment infrastructure. Its supported
> scope is the Arc Testnet payment gateway and the source-controlled PSP
> verifier. Do not deploy or fund contracts outside that reviewed scope.

## What is implemented

- **Server-backed QR requests:** the recipient wallet signs every request.
  The QR contains only an opaque request ID and a high-entropy capability;
  canonical invoice fields are fetched from the API.
- **Arc settlement verification:** a request is marked paid only after a
  successful receipt contains the exact token contract, payer, recipient,
  amount, transaction hash, and an in-window block.
- **Atomic payment state:** transaction reuse, concurrent confirmation, expiry,
  the receipt insert, and the paid event are enforced in database transactions.
- **Direct sends:** the web app and CLI transfer USDC or EURC on Arc Testnet,
  validate the exact confirmed transfer, and register payer-authorized invoice
  metadata.
- **Portable Settlement Proofs:** PSP JSON is content-addressed and signed.
  Trusted verification requires an issuer address obtained independently from
  the proof.
- **Private statements and inboxes:** wallet signatures scope server reads to
  the participating wallet. Statement filtering occurs before pagination and
  token totals use exact integer arithmetic.
- **Wallet-owned webhooks:** registrations are signed, recipient-scoped,
  quota-limited, HTTPS-only, protected against private-network SSRF, and
  delivered with HMAC-SHA256 signatures.

## CLI

Install the direct-disbursement CLI:

```bash
npm install -g @disburse/cli
```

The CLI rejects private keys passed in command-line arguments because process
listings and shell history can expose them. Prefer a secret manager that injects
`DISBURSE_PRIVATE_KEY` into the process environment. Review with `--dry-run`;
an interactive broadcast then requires typing `SEND` or `BATCH`.

```bash
# DISBURSE_PRIVATE_KEY is injected by your secret manager, not typed literally.
disburse send \
  --to 0xRecipient \
  --amount 10 \
  --label "Invoice 1" \
  --dry-run

disburse send \
  --to 0xRecipient \
  --amount 10 \
  --label "Invoice 1"
```

For non-interactive secret-manager output, use `--private-key-stdin`. Unattended
broadcasts require explicit `--yes`; perform and review the matching dry run
first.

```bash
secret-manager read disburse-key | disburse batch \
  --csv payouts.csv \
  --private-key-stdin \
  --dry-run
```

See [packages/cli/README.md](packages/cli/README.md) for the complete CLI
workflow.

## QR security model

1. The recipient signs the normalized request fields with EIP-712.
2. The server reserves the authorization atomically to prevent replay and
   enforce per-wallet and inbox quotas.
3. The payment-request row stores only a SHA-256 digest of the random QR
   capability. AES-256-GCM envelopes for owner history and optional inbox
   delivery live only in private, service-role tables and are bound to their
   wallet/request context.
4. A payer resolves the opaque QR reference through the authenticated status
   API and reviews the canonical fields.
5. The payer signs an EIP-712 authorization for that request before sending.
6. Confirmation verifies a successful Arc receipt, exact ERC-20 `Transfer`
   log, payer signature, request start block, expiry timestamp, and global
   transaction uniqueness.
7. The database atomically stores the receipt and transitions the request to
   paid. Invalid caller-supplied hashes do not terminally fail the invoice.

Historical requests and receipts are never cached in browser storage. The
active wallet signs a short-lived history authorization, and the API returns
only rows where that wallet is payer or recipient. A wallet-specific local
journal is used solely to recover a broadcast direct transfer until its
canonical server registration completes.

Legacy v1/v2 QR payloads embedded unsigned invoice fields. They are intentionally
not payable and must be recreated as v3 server-backed requests.

## PSP trust model

A PSP has two distinct verification levels:

- **Self-consistency:** its digest, UID, and signature agree with the issuer key
  embedded in the same document. Anyone can create such a self-consistent
  document, so this does not establish trust.
- **Trusted issuer verification:** the recovered signer matches an issuer
  address obtained independently, such as deployment configuration or an
  audited registry.

Offline CLI verification therefore requires `--issuer`:

```bash
npx @disburse/psp-verify proof.json \
  --issuer 0xIndependentlyTrustedIssuer
```

Offline verification does not assert that settlement exists onchain. The
version-2 [PspVerifier contract](contracts/src/PspVerifier.sol) supports explicit
`direct-signature-only` and `settlement` claims, trusted-issuer and settlement
registries, EIP-712 field binding, and two-step ownership. See
[contracts/PSP_VERIFIER.md](contracts/PSP_VERIFIER.md). A proof needs a matching
onchain claim, and the verifier must be deployed and configured, before online
verification can report a confirmed settlement.

## Repository layout

```text
api/                    Vercel API router
api-handlers/           Endpoint controllers
contracts/              PspVerifier v2 source, tests, and operator notes
docs/                    Product and API documentation
packages/cli/            Direct-disbursement CLI
packages/psp-verify/     Standalone PSP verification library and CLI
server/                  QR, PSP, statement, notification, and webhook logic
src/                     React application and shared browser-safe libraries
supabase/migrations/     Database schema and security migrations
tests/                   API-focused tests
```

## Local development

Requirements: Node.js 20 or newer.

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build
npm run dev
```

The development and preview servers bind to `127.0.0.1` by default.

Copy `.env.example` to a local, ignored environment file and configure only the
services you need. Important server-only values include:

- `SUPABASE_SERVICE_ROLE_KEY`
- `DISBURSE_CAPABILITY_ENCRYPTION_KEY`
- `DISBURSE_PSP_SIGNING_KEY`
- `PSP_TRUSTED_ISSUER`
- PSP verifier deployment settings documented in
  [contracts/PSP_VERIFIER.md](contracts/PSP_VERIFIER.md)

Never expose service-role or signing keys through `VITE_*` variables.

Optional `REDIS_URL` enables a standard Redis/Redis Cloud connection. As an
alternative, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` enable
short-lived hashed abuse-rate counters for signed API routes. Redis is never a
payment ledger or replay source of truth; the Supabase RPCs remain authoritative.

## Database rollout

The source changes depend on the latest Supabase migrations, including:

- wallet-owned webhook and statement privacy controls;
- atomic signed QR creation, replay, and quota enforcement;
- exact receipt block-hash/log-index evidence;
- atomic QR status, submission, confirmation, and direct-payment writes;
- atomic webhook delivery accounting and single-use create/delete signatures;
- in-place redaction of legacy raw QR capabilities from notifications; and
- removal of public PSP/event enumeration.

Treat migrations `202607290101` through `202607290103` as a coordinated,
write-paused cutover:

1. Drain outstanding 15-minute QR links and pause QR/direct writes plus webhook
   management and delivery.
2. Apply `101` and `102`. Migration `101` removes only the legacy
   `payload.request.requestToken` key from existing payment-request
   notifications (rows and encrypted envelopes are preserved). Migration
   `102` adds `block_hash` and `settlement_log_index` under `NOT VALID`
   constraints; unsafe new rows are rejected immediately.
3. Backfill every legacy receipt from its exact canonical successful
   transaction, including `block_hash`, `settlement_log_index`, and `chain_id`.
   Never guess a log index or chain. Quarantine ambiguous rows for manual
   adjudication.
4. Apply `103`. Its preflight aborts on case-insensitive transaction replay,
   request/receipt divergence, invalid financial values, or missing exact
   evidence. It never deletes or repairs data.
5. Deploy callers wired to the new service-role-only RPC signatures, smoke-test
   one QR and one direct payment, then resume writes. Legacy webhooks must be
   re-registered by their wallet owners.

Validate this sequence in a non-production environment first. This repository
change does not apply remote migrations or deploy contracts automatically.

## Contracts

Run the PSP verifier tests with Foundry when it is installed:

```bash
forge test --root contracts -vvv
```

The PSP verifier has a separate, explicit deployment workflow described in
[contracts/PSP_VERIFIER.md](contracts/PSP_VERIFIER.md).

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
Do not include keys, secrets, private customer data, or live webhook endpoints
in public issues.

## License

MIT. See [LICENSE](LICENSE).

Disburse is an independent project built on the USDC ecosystem and is not
affiliated with Circle Internet Financial.
