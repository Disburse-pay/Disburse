# Webhooks and API

Disburse exposes APIs for server-backed QR requests, PSP retrieval and
verification, private statements, notifications, direct-payment registration,
and wallet-owned webhooks.

## Webhooks

Webhook management is not anonymous. Every list, create/rotate, and deactivate
operation requires a short-lived EIP-712 authorization in:

- `X-Disburse-Wallet`
- `X-Disburse-Expires-At`
- `X-Disburse-Signature`

An active webhook is scoped to PSPs whose invoice recipient is the owner wallet.
Each wallet may have at most five active registrations. Creation accepts only
HTTPS on port 443, rejects embedded credentials, private/reserved IP addresses,
unsafe DNS results, redirects, and non-public single-label hosts. Delivery pins
the vetted IP address to close DNS-rebinding gaps.

Every `psp.issued` delivery contains the full PSP and is signed over the exact
JSON body with HMAC-SHA256 in `X-Disburse-Signature`. Use the signed `createdAt`
and PSP UID for freshness and deduplication. Deliveries time out, run with
bounded concurrency, and a registration is disabled after ten consecutive
failures.

Webhook secrets are returned only in masked form. Store the original secret in
a secret manager.

## Direct disbursements

`POST /api/disburse` registers an Arc transfer only after the payer authorizes
the exact transaction hash and normalized invoice metadata with EIP-712:

```json
{
  "txHash": "0x...",
  "rail": "direct",
  "recipient": "0x...",
  "amount": "25",
  "token": "USDC",
  "label": "Invoice 1",
  "note": "Subscription",
  "invoiceDate": "2026-07-29",
  "signature": "0x..."
}
```

The server independently reads the Arc receipt and exact token `Transfer` log.
For a Disburse-balance payment, use `"rail": "gateway"`; the server instead
requires the exact Circle Gateway `AttestationUsed` event, including its Arc
source domain, depositor/signer, recipient, token, amount, block, and log index.
The signed registration binds the selected rail so the interpretation cannot
be changed after approval. The `@disburse/cli` uses the direct rail.

## Wallet history

`POST /api/history` requires a short-lived EIP-712 signature from the wallet.
It returns only requests received by that wallet and receipts paid by it. Owner
QR capabilities are decrypted only for the request recipient, responses use
`Cache-Control: no-store`, and the browser keeps the ledger in memory only.

## PSP retrieval and verification

A PSP may be fetched by its unguessable UID through `/api/psp`. A
`request_id` lookup additionally requires that QR request's
`X-Disburse-Request-Token`; knowing a UUID is not enough. Responses use
`Cache-Control: no-store`, and database-wide PSP enumeration is not public.

`POST /api/psp/verify?issuer=0x...` verifies structure, digest, UID, and
signature against an issuer supplied independently from the PSP. It explicitly
does not claim that settlement was checked onchain. Never use the issuer field
inside the same PSP as its own trust root.

## Statements

`GET` and `POST /api/statements` require a short-lived EIP-712 authorization in
the same wallet/expiry/signature headers used above. The signed query must name
the authorizing wallet as payer or recipient.

The server applies recipient, payer, token, network, and date filters before
pagination. Results above the signed proof limit fail instead of silently
truncating. USDC and EURC totals are summed in integer base units and kept
separate when a statement contains both tokens.

## QR API

All server-backed QR status and mutation calls require the request capability in
`X-Disburse-Request-Token`. Creation additionally requires the recipient
wallet's short-lived EIP-712 authorization. Confirmation additionally requires
the payer's request authorization and a transaction hash that passes the exact
onchain checks.

## Authorization migration

These authorization requirements are intentionally incompatible with the
earlier anonymous API:

- Re-register legacy webhooks. Existing registrations are deactivated by the
  privacy migration and cannot be adopted without a new owner signature.
- Send `X-Disburse-Wallet`, `X-Disburse-Expires-At`, and
  `X-Disburse-Signature` with every statement request. The signature covers the
  normalized filters and proof limit; the default is 100 and the hard maximum
  is 500.
- Sign every QR-creation body as
  `DisbursePaymentRequestAuthorization`. The body includes `wallet`,
  `expiresAt`, and `signature`, and the signed message binds the normalized
  recipient, optional notification target, token, amount, label, note, and
  invoice date.
- Upgrade direct-payment clients that predate the EIP-712 registration schema;
  legacy plaintext or incomplete registration signatures are rejected.

Deploy the application and migrations `202607290101` through `202607290103`
as one tested release. Do not expose the new handlers against an older schema.
