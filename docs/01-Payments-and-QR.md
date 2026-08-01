# Payments and QR

## Current flow

1. **Authorize the request:** the recipient connects the destination wallet and
   signs the normalized invoice fields with EIP-712.
2. **Create:** the server enforces replay and rate limits, chooses the current
   Arc start block, and stores the request with a hash of a random capability.
3. **Share:** the QR contains an opaque v3 reference: request ID plus
   capability. It does not contain payable invoice fields.
4. **Review:** the payer resolves that reference through the API and reviews the
   canonical recipient, token, amount, label, date, and expiry.
5. **Authorize and pay:** the payer signs the request authorization and submits
   the ERC-20 transfer on Arc Testnet.
6. **Confirm:** Disburse verifies a successful transaction receipt, the exact
   USDC contract and `Transfer` log, the payer, recipient, amount, request block
   window, expiry, and transaction uniqueness.
7. **Record:** the database atomically inserts the receipt and marks the request
   paid. A PSP can then be issued.

Invalid transaction hashes never terminally fail somebody else's payment
request. A request remains pending until a valid transfer is confirmed or its
payment window expires.

## Direct send versus QR payments

**Direct send** is an immediate Arc Testnet USDC or EURC transfer. The sender
reviews and signs the transaction, then authorizes the exact label, note,
invoice date, token, amount, recipient, and transaction hash used to register
the PSP.

**QR payments** are server-backed USDC invoices on Arc Testnet. Every new QR
requires the recipient wallet's signature. Legacy v1/v2 QR links placed unsigned
invoice fields in the URL; the app rejects those links and asks the requester to
create a fresh v3 request.

## Capability handling

Treat a QR link as a bearer capability:

- share it only with intended payers;
- do not put it in support tickets, analytics events, or public screenshots;
- the API sends the capability in `X-Disburse-Request-Token`, not a query
  parameter;
- only the SHA-256 digest is stored with the payment request;
- an owner-bound AES-256-GCM envelope is stored in a private table so the
  wallet-authenticated history API can restore the request after a refresh; and
- routine JSON exports omit the raw capability and payer authorization.

## Wallet-scoped history

The browser does not cache historical requests or receipts. The active wallet
signs a short-lived EIP-712 history authorization, the API reads only incoming
or outgoing rows for that wallet, and account changes clear the current ledger
from memory before loading the next one. A wallet-specific pending-transaction
journal is retained only until a broadcast direct payment is registered or
explicitly reconciled.
