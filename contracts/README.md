# Cross-Chain QR Contracts

`QrPaymentSource` is deployed on Base Sepolia and Monad Testnet. It escrows the payer's ERC-20 and emits `QrPaymentInitiated`, which is the event Polymer proves. The owner can sweep escrowed source-chain funds for treasury rebalancing.

`QrPaymentSettlement` is deployed on Arc Testnet. It uses Polymer testnet `CrossL2ProverV2`, authorizes Base/Monad source contracts, maps source tokens to Arc USDC, prevents replay, and transfers prefunded Arc liquidity to the QR recipient.

Deployment checklist:

1. Deploy `QrPaymentSource` to Base Sepolia and Monad Testnet.
2. Deploy `QrPaymentSettlement` to Arc Testnet with prover `0x03Fb5bFA4EB2Cba072A477A372bB87880A60fC96`.
3. On the Arc settlement contract, call `setAllowedSource(sourceChainId, sourceContract, true)` for Base and Monad.
4. On the Arc settlement contract, call `setTokenRoute(sourceChainId, sourceToken, arcUsdcToken)`.
5. Prefund the Arc settlement contract with Arc USDC.
6. Put contract and token addresses into the app and server environment variables from `.env.example`.

For the current MegaETH-to-Monad migration, do not redeploy Base or Arc. Use the Monad-only route setup mode, which deploys a Monad `QrPaymentSource`, configures the existing Arc settlement contract, and disables the old MegaETH source authorization:

The repo includes a deploy helper:

```bash
npm run deploy:qr-contracts -- --compile-only
npm run deploy:qr-contracts -- --add-monad-source
```

Use `npm run deploy:qr-contracts -- --full` only when intentionally deploying a fresh Arc/Base/Monad contract set.

It reads `QR_DEPLOYER_PRIVATE_KEY`, source token addresses, and optional RPC overrides from local env files or the process environment. The helper writes deployment metadata to `deployments/` and public contract env output to `.env.qr-contracts.generated`.

## Testing (Foundry)

The fund-holding contracts are tested with Foundry. `forge-std` is vendored as a git submodule under `contracts/lib/forge-std`.

```bash
# First checkout only: fetch the forge-std submodule
git submodule update --init --recursive

# Run the suite (unit + fuzz + invariant)
forge test --root contracts -vvv

# Heavier fuzz/invariant budget (as CI runs it)
FOUNDRY_PROFILE=ci forge test --root contracts
```

On a fresh VPS, `bash scripts/vps-setup/install-foundry.sh` installs Foundry, initialises the submodule, and runs the suite. CI runs the same suite on every change under `contracts/` via `.github/workflows/contracts.yml`.

Foundry compiles with the same settings as the deploy pipeline (solc 0.8.35, optimizer 200 runs, `viaIR`) so tested bytecode matches deployed bytecode. Coverage: `QrPaymentSettlement`, `QrPaymentSource`, and `LendingPool` (incl. accounting invariants). The markets contracts are not yet covered.

## Settlement hardening — redeploy required

`QrPaymentSettlement` now includes a **pause** circuit breaker, an owner **`rescueTokens`** function, and **two-step ownership** (`transferOwnership` → `acceptOwnership`). The settlement contract currently live on Arc (`0x8c535227ed2b2963a3c1176510bc59e7a7fef07d`) predates these and **must be redeployed** to gain them. This is a manual, operator-run migration (it moves prefunded liquidity), not done automatically:

1. Deploy the new `QrPaymentSettlement` with prover `0x03Fb5bFA4EB2Cba072A477A372bB87880A60fC96`.
2. `setAllowedSource(...)` for the existing Base Sepolia and Monad source contracts (addresses in `deployments/`).
3. `setTokenRoute(...)` mapping each source token to Arc USDC.
4. Prefund the new contract with Arc USDC.
5. Point `ARC_SETTLEMENT_CONTRACT` / `ARC_QR_PAYMENT_SETTLEMENT` at the new address in Vercel, `.env.local`, and the VPS.
6. (Recommended) `transferOwnership(multisig)`, then have the multisig call `acceptOwnership()`.

> The **old** contract has no `rescueTokens`, so its remaining prefunded USDC can only leave via `settle()` — drain it by letting in-flight settlements complete before decommissioning. Avoiding exactly this "stranded liquidity" situation is why `rescueTokens` was added.
