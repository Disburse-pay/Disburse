# Compliance and receipts

Disburse turns confirmed testnet transfers into structured records that can
support accounting and audit workflows. These artifacts are technical evidence,
not legal, tax, or regulatory approval.

## Portable Settlement Proofs

A PSP is a signed, content-addressed JSON document. Verification has distinct
levels:

1. **Self-consistency** checks that the digest, UID, document, and signature
   agree. This does not establish trust because the issuer key came from the
   same document.
2. **Trusted offline verification** uses
   `npx @disburse/psp-verify proof.json --issuer 0x...`, where the issuer address
   comes from independent configuration. This verifies the signed document but
   reports settlement as not checked.
3. **PspVerifier v2 verification** requires a separately signed EIP-712
   `onchainClaim` bound to a deployed verifier. Direct mode checks a trusted
   issuer only; settlement mode also checks a versioned registered settlement
   contract.

Legacy PSPs without a v2 claim remain eligible for trusted offline
verification, but must not be described as onchain settlement-verified.

`createdAt` is unsigned PSP v1 envelope metadata. It is never used to derive
statement periods or settlement chronology; those use the signed
`settlement.settledAt` field.

## Export formats

- **JSON/local VSR:** a structured settlement record with a self-generated
  fingerprint for change detection. This fingerprint is not an issuer
  signature; use the signed PSP when independent issuer trust is required.
  workflows.
- **UBL 2.1 XML:** a standards-based machine-readable invoice starting point.
  Country, network, and recipient-specific e-invoicing profiles may require
  additional validation or fields.
- **PDF:** a human-readable summary with the parties, amount, transaction hash,
  and explorer link.

The PDF and XML are derived documents. Verify the PSP trust root and, when
needed, the underlying chain evidence before relying on them.

## Statements

Statement generation requires a short-lived wallet authorization, and the
authorizing wallet must be a payer or recipient in the signed query. Database
filters are applied before pagination. Token values are summed with exact
integer arithmetic; mixed USDC/EURC statements report separate totals.

Statement bundles can support reconciliation and audit collection, but users
remain responsible for jurisdiction-specific tax and accounting treatment.
