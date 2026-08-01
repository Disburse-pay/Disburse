# @disburse/psp-verify

Verify Disburse Portable Settlement Proofs (PSPs) without trusting Disburse
infrastructure.

The trust root matters: a signature that matches an issuer address copied from
the same PSP is only self-consistent. Trusted verification requires an issuer
address obtained independently, such as from audited configuration or a
published key registry.

## Install

```bash
npm install @disburse/psp-verify
```

## Trusted offline verification

```typescript
import { verify, verifyJson } from "@disburse/psp-verify";

const trustedIssuer = "0x..."; // obtain independently from the PSP

const result = await verify(pspDocument, {
  expectedIssuer: trustedIssuer,
});
const resultFromJson = await verifyJson(jsonString, {
  expectedIssuer: trustedIssuer,
});

if (result.ok) {
  console.log(result.fields?.requestId);
  console.log(result.trust); // "trusted_issuer"
  console.log(result.settlementStatus); // "not_checked"
}
```

Offline verification checks structure, canonical digest, UID, and the signature
against the supplied issuer. It does not query a chain and therefore never
claims that settlement existence was checked.

`createdAt` is envelope metadata in PSP v1 and is not part of the signed core.
Do not use it as an authenticated timestamp; `settlement.settledAt` is signed.

For diagnostics only, `verifySelfConsistency()` and
`verifySelfConsistencyJson()` check against the issuer embedded in the
document. Their result uses `selfConsistent`, not `ok`, and is explicitly marked
`untrusted_self_consistency_only`.

## CLI

The trusted issuer is required exactly once:

```bash
npx psp-verify proof.json --issuer 0xYourIndependentlyTrustedIssuer
curl -fsS "https://example/proof.json" |
  npx psp-verify --stdin --issuer 0xYourIndependentlyTrustedIssuer
```

Exit code `0` means the document is valid for the supplied issuer. Settlement
status remains `not checked`; exit code `1` means invalid input, ambiguous
arguments, or failed verification.

## PspVerifier v2 claims

PspVerifier v2 does not accept a caller-supplied digest. It verifies a separate
EIP-712 claim binding:

- the canonical PSP document digest;
- every field consumed by the Solidity verifier;
- `settlement` or `direct-signature-only` mode;
- the settlement registry version;
- the verifier contract and chain through the EIP-712 domain.

Attach a claim at issuance time:

```typescript
import { attachPspOnchainClaim } from "@disburse/psp-verify";

const claimedPsp = await attachPspOnchainClaim(psp, issuerPrivateKey, {
  verifierAddress: "0x...",
  chainId: 5_042_002,
  mode: "settlement",
  settlementRegistryVersion: 2,
});
```

For a direct payment, choose `mode: "direct-signature-only"` and omit the
registry version. Cross-chain PSPs cannot be downgraded to that reduced scope.

Online verification also requires the mode explicitly:

```typescript
const result = await verifyOnline(claimedPsp, {
  rpcUrl: "https://...",
  verifierAddress: "0x...",
  mode: "settlement",
});

// Full claim:
// result.verificationLevel === "trusted_issuer_and_settlement"
// result.settlementStatus === "confirmed"
```

A successful direct result is instead
`trusted_issuer_signature_only` with settlement status `not_checked`.

## Canonicalization

The portable document digest is:

```text
keccak256(
  "DISBURSE-PSP-v1\n" + networkMode + "\n" + deterministicJSON(core)
)
```

Keys are sorted recursively, hex values are lowercased, null/undefined fields
are omitted, and arrays retain order.

## License

MIT
