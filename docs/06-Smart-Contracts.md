# Smart contracts

## Source-controlled contract

The contract source available in this checkout is
[`PspVerifier.sol`](../contracts/src/PspVerifier.sol). Version 2 verifies
field-bound EIP-712 PSP claims and maintains:

- a trusted-issuer registry;
- a versioned settlement-contract registry;
- explicit `direct-signature-only` and `settlement` verification modes; and
- two-step ownership transfer.

Direct mode verifies issuer trust and the signed fields but deliberately does
not assert settlement existence. Settlement mode additionally asks an enabled,
version-matched settlement contract whether the signed settlement ID is
confirmed.

See [the verifier operator guide](../contracts/PSP_VERIFIER.md) for deployment
and migration requirements. Deployment is an explicit operator action; source
changes alone do not update any live contract.

## Supported contract boundary

Only the source-controlled PSP verifier and its reviewed deployment procedure
are part of the supported payment product. Compiled artifacts and addresses
are not a substitute for source, tests, and an operator review.

Do not:

- deploy or fund unsupported contracts or stale artifacts;
- change live ownership, issuer, settlement, or route registries without a
  separately reviewed operator migration.
