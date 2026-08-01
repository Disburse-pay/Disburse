# PspVerifier v2 operations

PspVerifier v2 is a new trust boundary. Do not point the v2 client at the
previous deployed verifier or reuse its ABI: the old contract accepted a
caller-provided digest, did not bind the displayed fields to that digest, and
treated a zero settlement ID as a successful bypass.

## Security properties

- EIP-712 binds the claim to the verifier contract and chain.
- Deployment is pinned to Arc Testnet chain `5042002`, and claims must be
  labeled `testnet`; a mainnet-labeled claim fails even with a valid signature.
- The signed `PspFields` struct includes the canonical document digest and every
  field consumed by Solidity.
- Full verification requires a non-zero settlement ID, an enabled settlement
  contract, and the exact settlement registry version.
- Direct verification has its own `verifyDirectClaim` entry point and signed
  `direct-signature-only` mode. It never reports settlement existence.
- Issuers and settlements are registries so rotations and migrations can keep
  old proofs valid.
- Ownership uses `transferOwnership` followed by `acceptOwnership`.
- Invalid/malleable signatures return failure rather than reverting.

## Compile and deploy

Compilation is local and makes no network calls:

```bash
node scripts/deploy-psp-verifier.mjs --compile-only
```

Deployment requires:

```text
QR_DEPLOYER_PRIVATE_KEY
DISBURSE_PSP_ISSUER_ADDRESS
ARC_SETTLEMENT_CONTRACT
PSP_VERIFIER_OWNER
```

The deploy helper intentionally takes an issuer address, not the PSP signing
private key. It verifies the RPC chain ID, settlement bytecode and interface,
deployed bytecode, initial registry entries, and ownership state. It waits for
two confirmations and writes a versioned metadata file.

Use a multisig or governance contract for `PSP_VERIFIER_OWNER`. If ownership is
transferred, deployment metadata records `pending_acceptance`; the new owner
must call `acceptOwnership()` before the deployer is decommissioned.

## Settlement migration

Each settlement contract receives a monotonically increasing registry version.
Migration order:

1. Deploy and audit the replacement settlement contract.
2. Call `registerSettlement(newAddress)` and record its returned version.
3. Update PSP issuance to sign new claims with the new address and version.
4. Keep the previous entry enabled while historical proofs must remain valid.
5. Disable an old entry only as an explicit revocation decision. Disabling it
   makes full verification of proofs tied to that entry fail.

Registering the same address twice is rejected. A claim for one address or
version cannot be replayed against another.

Issuer rotation follows the same additive approach: register the new key first
and retain the previous key for the required historical-verification window.
Disabling an issuer invalidates claims signed by it.

## Issuance rollout

Server issuance is intentionally opt-in:

```text
PSP_VERIFIER_V2_ADDRESS=<independently verified deployed v2 address>
PSP_SETTLEMENT_REGISTRY_VERSION=<positive version for cross-chain claims>
PSP_REQUIRE_ONCHAIN_CLAIM=1
```

When `PSP_VERIFIER_V2_ADDRESS` is absent and
`PSP_REQUIRE_ONCHAIN_CLAIM` is not `1`, issuance remains legacy and reports
`claimStatus: "legacy_offline_only"`. If the verifier address is configured,
new direct PSPs receive a `direct-signature-only` claim and cross-chain PSPs
require the configured registry version. Issuance calls the verifier before
persisting and fails if the issuer, registry entry, signature, or settlement
check does not pass.

`PSP_REQUIRE_ONCHAIN_CLAIM=1` makes a missing verifier configuration an error.
Setting a registry version without a verifier address is also an error.
Previously issued legacy PSPs are not silently upgraded or returned as v2
proofs after v2 is configured; use an explicit audited re-attestation flow.

For viewer-side offline verification, configure `PSP_TRUSTED_ISSUER` separately.
That value is a display/API trust root and is not a replacement for the on-chain
issuer registry.

## Legacy proofs

Legacy PSPs have only the portable EIP-191 signature. They can still be checked
offline against an independently trusted issuer, but they cannot be described
as PspVerifier v2 settlement-confirmed proofs. Re-attestation requires an
authorized issuer to attach a new EIP-712 claim after validating the original
document and settlement.

## Missing fund-contract sources

This checkout currently contains stale build artifacts and documentation for
`QrPaymentSource`, `QrPaymentSettlement`, and other fund-holding contracts, but
their Solidity sources and deployment helper are absent. Do not deploy from
`contracts/out/`, reconstruct bytecode from artifacts, or restore an older
unchecked implementation merely to make an old command work.

Before any fund-contract deployment:

1. recover the exact reviewed sources from version control or verified deployed
   source;
2. compare them with deployed bytecode and configuration;
3. restore unit, fuzz, and invariant tests;
4. rerun the security review; and
5. add a reproducible deployment command only after those checks pass.

Until then, only the self-contained PspVerifier v2 source is deployable from
this workspace.
