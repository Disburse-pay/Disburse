# PSP — Design

## Architecture

```
                  ┌────────────────────────────────────────────┐
                  │  Disburse app (existing)                   │
                  │                                            │
  payment_request │   qr.ts ─ confirm ───────┐                 │
       │          │   crosschain.ts ─ settle ┘                 │
       ▼          │                 │                          │
  settles onchain │                 ▼                          │
  (Arc Testnet)   │            issue PSP  (server/psp/*)       │
                  │                 │                          │
                  │                 ├─► psp_documents (DB)     │
                  │                 ├─► GET /api/psp/:uid      │
                  │                 └─► /psp/:uid viewer       │
                  └─────────────────┬──────────────────────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                      ▼
    packages/psp-verify       PspVerifier.sol       UBL/PDF export
    (npm, zero-dep)           (Arc, view fn)        (embedded digest)
```

## Module layout

New:
- `src/lib/psp/types.ts` — PSP TS types.
- `src/lib/psp/canonical.ts` — canonicalization + keccak digest (browser-safe).
- `src/lib/psp/sign.ts` — secp256k1 signing helpers (viem primitives).
- `src/lib/psp/verify.ts` — offline verify (shared with package).
- `server/psp/issue.ts` — PSP issuer, called after confirm/settle.
- `server/psp/fetchLogs.ts` — pulls Arc/source logs for the event anchors.
- `api/psp/[uid].ts` — JSON endpoint.
- `api/psp/viewer/[uid].ts` — HTML viewer (SSR-lite, small template).
- `contracts/src/PspVerifier.sol` — onchain verifier.
- `packages/psp-verify/` — publishable npm lib + CLI, re-uses
  `src/lib/psp/{canonical,verify}.ts` via a copy or symlink step.
- `supabase/migrations/202605130001_psp_documents.sql`.
- `spec/psp-v1.md` — the open spec, linked from README.

Touched (minimal):
- `src/lib/attestation.ts` — add `digest` alongside `fingerprint`, new
  `attester: "psp"` value, delegate to `psp/canonical` when available.
- `server/qr.ts` — call PSP issuer after terminal status transitions.
- `server/crosschain.ts` — same hook on settle.
- `src/components/SettlementTimeline.tsx` (or existing receipt view) — PSP panel.
- `src/lib/invoice.ts` — PDF embeds digest + verifier URL.
- `README.md` — PSP section and verifier docs.

## Canonicalization

Encoding algorithm (`src/lib/psp/canonical.ts`):

1. Build the `PspCore` object: every field except `digest`, `signature`, `uid`,
   `createdAt`.
2. Normalize:
   - addresses: `getAddress().toLowerCase()` → lowercased hex
   - amounts: base-10 string of parsed bigint (no exponent, no leading zeros)
   - hashes/hex: lowercase, `0x` prefixed, length-checked
   - timestamps: ISO-8601 with `Z`, milliseconds if present
   - optionals: omitted when undefined, never `null`
3. Serialize using a deterministic stringifier: keys sorted at every depth,
   arrays preserved in order, no whitespace.
4. Prepend domain separator bytes: `DISBURSE-PSP-v1\n<networkMode>\n`.
5. `digest = keccak256(domain || serialized)`.

The Solidity verifier consumes a pre-built `bytes` payload that ABI-decodes
into a `PspCanonical` struct; the struct fields mirror the JSON 1:1. The
verifier `keccak256`s the exact same domain-separated canonical bytes by
re-ABI-encoding deterministically. We write conformance tests that issue a PSP
in TS and round-trip it through the Solidity verifier in Foundry.

## Signing

- Issuer key: secp256k1 EVM key, stored in `DISBURSE_PSP_SIGNING_KEY`.
- Signature is `secp256k1(keccak256(domain || canonical))`, compact recoverable
  (65 bytes, `0x04` prefix variant not used).
- `issuer.publicKey` is the EVM address for v1 (not a full uncompressed pubkey)
  — simpler, and `ecrecover` reconstructs it from the signature. The JSON
  field is named `publicKey` for forward compatibility with Ed25519 later.

## Issuance flow

```
confirm/settle ──► readLogs() ──► buildPspCore() ──► canonicalize() ──► sign() ──►
persist(psp_documents) ──► return uid to caller
```

- Idempotent on `request_id`. If a PSP already exists for a request, return it.
- Errors are non-fatal for the payment — logged to `payment_request_events`
  as `event_type: "psp_issue"`, `status: "error"`.

## Storage schema (migration 202605130001)

```sql
create table if not exists psp_documents (
  uid text primary key,
  request_id text not null references payment_requests(id) on delete cascade,
  network_mode text not null check (network_mode in ('testnet', 'mainnet')),
  digest text not null,
  document jsonb not null,
  issuer_public_key text not null,
  signature text not null,
  created_at timestamptz not null default now()
);

create unique index psp_documents_request_id_key on psp_documents(request_id);
create index psp_documents_digest_idx on psp_documents(digest);

alter table psp_documents enable row level security;
-- policies mirror payment_receipts (service role rw, anon read-by-uid)
```

## Onchain verifier (sketch)

```solidity
contract PspVerifier {
    IQrPaymentSettlement public immutable settlement;
    address public issuer; // Disburse PSP signer

    struct PspCanonical { /* mirror of JSON fields */ }

    function verify(bytes calldata psp, bytes calldata signature)
        external
        view
        returns (bool ok, bytes32 settlementId)
    {
        PspCanonical memory p = abi.decode(psp, (PspCanonical));
        bytes32 digest = keccak256(abi.encodePacked("DISBURSE-PSP-v1\n", p.networkMode, "\n", psp));
        require(_recover(digest, signature) == issuer, "bad sig");
        require(settlement.settled(p.settlementId), "not settled");
        return (true, p.settlementId);
    }
}
```

Details are hand-wavy on purpose — we refine once we pin the canonical layout.

## Test plan

- **Canonicalization**: snapshot tests; key-reorder fuzz; boundary cases
  (missing optional, zero amount, unicode labels).
- **Sign/verify**: 1000-iteration round-trip; tampered-field detection.
- **Issuance**: mock `confirm`/`settle` fixtures → PSP matches golden snapshot.
- **Onchain**: Foundry test asserts the TS-generated bytes verify under the
  Solidity contract and that tampered bytes revert.
- **Integration**: existing `qr.test.ts` / `crosschain.test.ts` extended with
  "PSP exists and verifies" assertion.
- **Regression**: all existing tests pass; `exportAttestation()` output still
  parses.

## Rollout

Three PRs, each independently mergeable behind `ENABLE_PSP=0|1`:

1. **PR-1 PSP foundation**: types, canonicalization, sign/verify, migration,
   issuance hook (feature-flagged off), `/api/psp/:uid`, unit tests. No UI.
2. **PR-2 Verifier + UX**: npm package `packages/psp-verify`, `/psp/:uid`
   viewer, receipt panel, PDF/UBL digest embedding.
3. **PR-3 Onchain verifier**: `PspVerifier.sol`, Foundry tests, deployment
   script, README update, spec publication.

PR-1 is the critical review — canonicalization is load-bearing.
