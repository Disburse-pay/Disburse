# Compliance and Receipts

Disburse turns on-chain transfers into structured, verifiable documents suitable for accounting, tax reporting, and auditing.

## Portable Settlement Proofs (PSP)

Every settled payment can produce a Portable Settlement Proof (PSP). A PSP is a signed, content-addressed JSON document verifiable in three ways:

1. **Offline**: Using the `@disburse/psp-verify` npm package.
2. **CLI**: Running `npx @disburse/psp-verify proof.json --issuer 0x...`
3. **On-chain**: Calling `PspVerifier.verify` on Arc.

PSPs do not require trust in Disburse infrastructure. They mathematically prove that a specific stablecoin invoice was settled by a specific on-chain transfer.

## Export Formats

A successful verification produces three export formats. All are derived from the same underlying on-chain fact.

* **VSR (JSON)**: Structured settlement record with a SHA-256 fingerprint. Built for auditors and third-party verifiers.
* **UBL 2.1 (XML)**: Machine-readable invoice compatible with existing EU e-invoicing pipelines, public sector systems, and enterprise AP systems.
* **PDF**: Clean one-page receipt with amount, parties, transaction hash, and an Arcscan link. Ideal for human reading and finance inboxes.

## Statement Generation

Disburse can generate statement bundles for counterparties. This aggregates PSPs over a time period into exportable statement documents. 

Use cases include monthly reconciliation, tax reporting, and audit bundles.
