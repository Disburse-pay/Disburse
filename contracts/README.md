# Contracts workspace status

The only application contract source currently present and supported in this
checkout is `src/PspVerifier.sol`. Its security model, rollout configuration,
and migration procedure are documented in
[PSP_VERIFIER.md](./PSP_VERIFIER.md).

Compile it without network access:

```bash
node scripts/deploy-psp-verifier.mjs --compile-only
```

Run its Forge tests when Foundry is installed:

```bash
forge test --root contracts --match-contract PspVerifierTest -vv
```

`contracts/lib/forge-std` is vendored as a submodule. The Foundry profile uses
solc 0.8.35, optimizer 200, and `viaIR`, matching the PSP deployment helper.

## Fund-contract source limitation

This checkout contains historical build artifacts under `contracts/out/` for
unsupported systems whose Solidity sources and deployment scripts are absent.
The artifacts are not authoritative or deployable source. There is no
supported QR/fund-contract deployment command in this checkout.

Do not:

- deploy bytecode reconstructed from `contracts/out/`;
- infer current security properties from stale ABIs or build metadata; or
- restore an older implementation solely to make a historical command work.

Before any fund-holding contract is built or deployed, recover the exact audited
source from version control or verified deployed source, compare it with live
bytecode, restore its unit/fuzz/invariant tests, and repeat the security review.
