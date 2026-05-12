# PSP — Tasks

Ordered. Each task is small enough to review in isolation.

## PR-1: Foundation (feature-flagged, no UI)

- [ ] T1.1 Create `src/lib/psp/types.ts` with `PspV1`, `PspCore`, `PspSignature`,
  `NetworkMode`.
- [ ] T1.2 Implement `src/lib/psp/canonical.ts`:
  - deterministic JSON stringify
  - normalization helpers
  - `canonicalBytes(psp)`, `digest(psp)`
  - unit tests (snapshot + key-reorder fuzz)
- [ ] T1.3 Implement `src/lib/psp/sign.ts` using viem's secp256k1:
  - `signPsp(core, privateKey)` → `{ digest, signature, issuerAddress }`
  - `verifyPspSignature(core, signature, issuerAddress)`
  - unit tests (round-trip, tamper detection)
- [ ] T1.4 Implement `src/lib/psp/verify.ts`:
  - `verify(psp)` → `{ ok, reason?, fields }`
  - checks: version, digest, signature, issuer address match
  - unit tests
- [ ] T1.5 Add migration `supabase/migrations/202605130001_psp_documents.sql`.
- [ ] T1.6 `server/psp/fetchLogs.ts`:
  - `readArcSettledLog(requestId)` for direct and cross-chain cases
  - `readSourceInitiatedLog(requestId, sourceChainId)` for cross-chain
  - mock-friendly (injected RPC client)
- [ ] T1.7 `server/psp/issue.ts`:
  - `issuePsp(requestId, supabase, signer)`
  - idempotent; writes to `psp_documents`
  - emits `payment_request_events` entry
- [ ] T1.8 Hook issuance into `server/qr.ts` (direct confirm) and
  `server/crosschain.ts` (settle). Gated on `process.env.ENABLE_PSP === "1"`.
  Non-fatal.
- [ ] T1.9 `api/psp/[uid].ts` — JSON GET by UID.
- [ ] T1.10 Extend `server/qr.test.ts` / `crosschain.test.ts` with PSP-exists
  assertions when the flag is on.
- [ ] T1.11 Update `.env.example` with `ENABLE_PSP`, `DISBURSE_PSP_SIGNING_KEY`.

Exit: merged to `main`, flag OFF by default; developers can turn it on locally
and see PSPs land in DB after settlements.

## PR-2: Verifier package + UI

- [ ] T2.1 Create `packages/psp-verify/` as npm workspace; copy or re-export
  `canonical.ts` and `verify.ts`; zero runtime deps besides `@noble/secp256k1`.
- [ ] T2.2 CLI entry `psp-verify psp.json --issuer 0x…`.
- [ ] T2.3 `packages/psp-verify/README.md` with usage.
- [ ] T2.4 Publish config (not actually published in PR, but `package.json` and
  `files` configured).
- [ ] T2.5 React: PSP panel in existing receipt view — UID, digest, download,
  copy JSON, link to `/psp/:uid`.
- [ ] T2.6 `api/psp/viewer/[uid].ts` — minimal HTML viewer page with issuer,
  invoice summary, chain links, digest, verify-me-in-your-terminal snippet.
- [ ] T2.7 `src/lib/invoice.ts` — embed digest + verifier URL in PDF footer.
- [ ] T2.8 UBL digest linkedDocument.
- [ ] T2.9 Toggle flag default to ON.

Exit: Disburse users can share a PSP URL; anyone with the npm lib or CLI can
verify it independently.

## PR-3: Onchain verifier + open spec

- [ ] T3.1 `contracts/src/PspVerifier.sol` + Foundry tests.
- [ ] T3.2 Conformance test: TS issuer → bytes → Solidity verifier returns ok.
- [ ] T3.3 Deploy script in `scripts/deploy-psp-verifier.mjs`; deployment JSON
  in `deployments/`.
- [ ] T3.4 `verifyOnline()` in `packages/psp-verify` using viem.
- [ ] T3.5 `spec/psp-v1.md` — the open standard doc.
- [ ] T3.6 README section linking spec + verifier + deployed address.

Exit: PSP is publicly verifiable three ways — library, CLI, onchain.

## Out of scope for this spec (tracked for later)

- Agent chat surface (v2; thin UX over PSP).
- EAS onchain attestation variant.
- Issuer key rotation tooling.
- Mainnet deployment.
