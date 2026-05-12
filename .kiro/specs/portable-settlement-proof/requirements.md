# Portable Settlement Proof (PSP) — Requirements

Status: draft v0
Branch base: `main` (`9e01131`)

## Problem

Onchain stablecoin commerce has no portable, independently verifiable receipt.
Wallets, invoicing tools, and agents each mint ad-hoc JSON. Auditors cannot verify
a settlement without trusting the issuer's API. Circle's Arc provides a settlement
chain; Polymer provides cross-chain event proofs; neither standardizes the receipt.

Disburse already produces a Verifiable Settlement Receipt (`src/lib/attestation.ts`)
and already emits a terminal onchain settlement event (`QrPaymentSettlement.settle`).
The gap between "we have a fingerprint" and "anyone can verify this without us" is
the 0→1 opportunity.

## Goal

Define and ship **Portable Settlement Proof (PSP) v1**: a signed, content-addressed,
independently verifiable proof that a specific invoice was settled by a specific
onchain transfer on Arc, optionally via a Polymer-proved cross-chain source payment.

The same proof must verify:

1. Offline, from a single JSON blob, against a public key.
2. Onchain, on Arc, by calling a verifier contract with the canonical bytes.
3. Against the source of truth, by re-deriving from `QrPaymentSettled` / Arc transfer.

## Non-goals (v1)

- Autonomous outbound payments, Circle Agent Wallets, custody flows.
- Mainnet. v1 targets Arc Testnet, but schema carries `networkMode`.
- Disputes, chargebacks, multi-signature issuers.
- EAS onchain attestation registration. Leave the `attester: "eas"` slot and ship
  `attester: "local"` and `attester: "arc-verifier"`.

## User stories

- **US-1.** As a Disburse payee, when a `payment_request` finishes settling I get a
  PSP JSON and a shareable link whose URL embeds the content hash.
- **US-2.** As an auditor with only the PSP JSON and the issuer's public key, I can
  verify authenticity and canonical hash in under 10 ms using a zero-dependency
  verifier, with no network calls.
- **US-3.** As another contract on Arc, I can call
  `PspVerifier.verify(bytes psp) returns (bool ok, PspFields f)` and branch on the
  result — useful for agent-to-agent flows that want to gate action on settlement.
- **US-4.** As a Disburse developer, I can change the PSP schema behind a `version`
  field without breaking in-flight proofs; both old and new verifiers coexist.
- **US-5.** As a compliance user, the existing UBL 2.1 XML and PDF exports embed
  a PSP digest + verifier URL so downstream tools inherit verifiability.

## Functional requirements

### FR-1 — Canonical PSP document

A PSP is a JSON object with:

- `version`: `1`
- `networkMode`: `"testnet" | "mainnet"`
- `issuer`: `{ name, url, publicKey }` (Ed25519 or secp256k1; v1 ships secp256k1
  to match EVM tooling)
- `invoice`: `{ requestId, label, invoiceDate?, note?, payer, recipient, token, amount }`
- `settlement`: `{ chainId, txHash, blockNumber, settledAt, settlementEvent:
  { contract, settlementId, eventTopic, logIndex } }`
- `source` (optional, only when cross-chain): `{ chainId, txHash, blockNumber,
  payer, token, amount, polymerProofDigest }`
- `linkedDocuments` (optional): `[{ kind: "ubl" | "pdf" | "custom", digest,
  uri? }]`
- `fingerprint`: hex SHA-256 of the canonical bytes (see FR-2)
- `signature`: `{ alg: "secp256k1-keccak256", value }` over the canonical bytes
- `uid`: `psp:<first-16-hex-of-fingerprint>`
- `createdAt`: ISO-8601

### FR-2 — Canonicalization

A PSP's canonical bytes are built by:

1. Domain separator: `"DISBURSE-PSP-v1\n" + networkMode + "\n"`.
2. A strict, recursive lexicographic JSON encoding of every field except
   `fingerprint`, `signature`, `uid`, and `createdAt`.
3. Addresses lowercased; amounts as base-10 strings with no exponent; hashes
   lowercased hex with `0x`.

The canonicalization MUST match byte-for-byte across:

- TypeScript (`src/lib/psp/canonical.ts`)
- Solidity (`contracts/src/PspVerifier.sol`, via `abi.encode` of the typed
  struct and `keccak256`; we pick a structure that maps 1:1 from JSON)

Because EVM `keccak256` and web `sha256` disagree, the PSP document uses
**keccak256** for the canonical bytes. `fingerprint` is renamed to `digest`
and is the keccak256 over canonical bytes. (Breaks compatibility with the
existing SHA-256 VSR fingerprint — covered in FR-6.)

### FR-3 — Issuance

When `payment_requests.status` transitions to `confirmed` (Arc direct) or
`settled` (cross-chain), the server:

1. Reads the terminal Arc log — `Transfer` for direct, `QrPaymentSettled` for
   cross-chain — and the source `QrPaymentInitiated` log when applicable.
2. Builds the PSP, computes `digest`, signs with the Disburse issuer key.
3. Persists to a new `psp_documents` table (FR-7).
4. Exposes via `GET /api/psp/:uid` (JSON) and `GET /psp/:uid` (HTML viewer).

### FR-4 — Verification (library)

Ship `packages/psp-verify/` as an npm package with **zero Disburse dependencies**:

- `verify(psp): { ok, reason?, fields }` — checks structure, digest, signature.
- `verifyOnline(psp, { rpcUrl, verifierAddress }): Promise<...>` — optional,
  additionally calls the onchain verifier.
- CLI: `npx psp-verify psp.json --issuer 0x… [--rpc … --verifier …]`.

Published alongside Disburse on npm. Docs in the repo README.

### FR-5 — Verification (onchain)

`contracts/src/PspVerifier.sol` on Arc:

- `verify(bytes psp) view returns (bool ok, PspFields f)` — validates digest,
  issuer signature, and that `settlement.settlementEvent.settlementId` exists in
  `QrPaymentSettlement.settled` (for cross-chain) or the Arc USDC `Transfer`
  matches (for direct). Direct-path check is shipped as an allowlisted
  (chain, token) helper to keep the contract small.
- Uses a mirror of the canonicalization logic in Solidity. We design the
  wire format so the contract decodes a `struct PspCanonical` and re-hashes
  deterministically — no JSON parsing onchain.

### FR-6 — Backward compatibility with the existing VSR

- Keep `attestation.ts` exports in place. Deprecate `fingerprint` by adding
  `digest` alongside it on the same object, computed over the PSP canonical
  bytes. Old importers keep working; new tooling prefers `digest`.
- `SettlementAttestation.attester` gains `"psp"` as a value. `easUid` /
  `easUrl` remain for the future EAS path.
- Migration note: `exportAttestation()` output grows fields; all consumers are
  in-repo, so we update them atomically in the same PR.

### FR-7 — Persistence

New table `psp_documents`:

- `uid text primary key`
- `request_id text references payment_requests(id)`
- `network_mode text not null check (network_mode in ('testnet','mainnet'))`
- `digest text not null`
- `document jsonb not null`
- `issuer_public_key text not null`
- `signature text not null`
- `created_at timestamptz not null default now()`
- index on `request_id`, `digest`

RLS: same policy as `payment_receipts`.

### FR-8 — UI surfacing

- On the existing receipt view, add a "Portable Proof" panel with the PSP UID,
  digest, a "Copy JSON", a "Download" button, and a link to `/psp/:uid`.
- `/psp/:uid` renders a minimal public page: issuer, invoice summary, chain
  links, digest, signature, verify-me-in-your-terminal snippet. No auth.
- PDF export embeds the PSP digest and the public verifier URL in the footer.

### FR-9 — Agent surface (deferred to v2, listed for design coherence)

The agent layer we keep for v2 becomes a **thin UX over PSPs**:

- Chat intents: "verify this proof", "why is request X still pending",
  "re-issue PSP for Y", "export Q2 proofs as a bundle".
- No outbound autonomy; read/verify/diagnose only.
- Intent router is deterministic rules first, LLM behind env flag later.

v2 is explicitly not in this spec beyond naming the seam.

## Non-functional requirements

- **Verify performance.** `verify()` must complete in <10 ms on a modern laptop
  for a 4 KB PSP.
- **Issuer key management.** v1 stores issuer private key in env
  (`DISBURSE_PSP_SIGNING_KEY`). Key rotation policy documented but deferred.
- **Determinism.** Canonicalization tests run on both Node and browser.
  Fuzz test with randomized field orders ensures byte-identical output.
- **Compatibility.** No change to current payment, QR, or cross-chain flows.
  PSP issuance runs after the existing confirmation/settlement and failures
  do not roll back the payment.

## Success criteria

- A PSP issued by Disburse verifies:
  - in CLI (`psp-verify`)
  - in the npm lib unit tests
  - onchain (`PspVerifier.verify`)
- Old VSR receipts continue to import and render without errors.
- PSP issuance does not add more than 500 ms to the settlement path (p95).
- Published open spec (`spec/psp-v1.md`) and reference verifier are linked
  from the project README.

## Open questions

- **Q1.** Issuer signature scheme: secp256k1/keccak (EVM-friendly, reusable for
  onchain verification) vs. Ed25519 (smaller, faster off-chain). Spec currently
  says secp256k1 so the same signature verifies in Solidity. Confirm.
- **Q2.** Include a `linkedDocuments` digest for UBL/PDF in v1, or ship v1 with
  just the core and add attachments in v1.1?
- **Q3.** Should `PspVerifier.verify` also verify the Polymer proof digest, or
  trust that `QrPaymentSettled` being present on Arc is sufficient? I'm leaning
  "sufficient" — once it's on Arc, Polymer already verified it at settle time.
- **Q4.** Publish `packages/psp-verify` from this repo as a workspace, or as a
  sibling repo? Monorepo is simpler for v1.
