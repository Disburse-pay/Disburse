# Disburse Bridge threat model

## Assets

- The user's native USDC on the source chain.
- ERC-20 allowances granted to Circle's official CCTP V2 contracts.
- The CCTP V2 burn message, nonce, attestation, and destination mint.
- Source and destination transaction hashes used for recovery.
- The connected wallet's signing authority.

## Actors and trust boundaries

- The user controls the wallet and approves every source/destination
  transaction.
- Circle controls the official CCTP V2 contracts and attestation service.
- Source and destination RPC providers, browser extensions, the frontend,
  relayers, DNS, and remote APIs are untrusted transports.
- Disburse never controls a signing key, custody account, validator set,
  liquidity pool, or upgradeable bridge contract.

## Invariants

1. Only native USDC is transferable.
2. Only the explicit Ethereum Sepolia ↔ Arc Testnet route is executable.
3. Only CCTP V2 Standard Transfer is allowed; Arc Fast Transfer is rejected.
4. The destination recipient is the checksummed connected wallet address.
5. Amount is a positive base-10 value with no more than six decimals.
6. Testnet platform fee and maximum CCTP fee are both zero.
7. Source success is not reported as transfer success until destination mint
   succeeds.
8. A failed or partial operation exposes completed steps and never starts a
   second burn automatically.
9. No bridge history or recovery credential is persisted in browser storage.
10. Mainnet has no executable manifest and fails closed.

## Principal threats and controls

- **Route or domain confusion:** route identifiers are a closed typed set;
  chain IDs are never treated as CCTP domains.
- **Malicious recipient substitution:** recipient is derived from the active
  wallet immediately before estimate and execution and is shown in the review.
- **Fee manipulation:** Standard mode is explicit and `maxFee` is zero on
  testnet; the estimate is invalidated whenever amount or direction changes.
- **Stale estimate / account switch:** account, direction, and amount changes
  clear estimates and prior results. Execution rebuilds the adapter from the
  current provider.
- **Replay or double burn:** Bridge Kit/CCTP nonce rules provide protocol replay
  resistance; the UI disables concurrent execution and never auto-retries a
  burn. Retry resumes the returned partial result.
- **Compromised RPC or API:** signed transactions and canonical on-chain
  receipts are the authority. API progress is not treated as destination mint
  proof.
- **Frontend or DNS compromise:** the frontend is not a custody boundary. Users
  must verify wallet transaction destination, amount, network, and spender.
- **Unlimited allowance:** approval behavior is delegated to the audited Circle
  adapter; the UI discloses the approval step and does not add its own spender.
- **Dependency compromise:** Circle packages are exact-pinned, the vulnerable
  ethers/elliptic line is excluded, and `npm audit` must remain clean.
- **Partial completion:** completed steps and explorer links remain visible;
  retry is allowed only from the existing Bridge Kit result.

## Required tests

- Reject zero, negative, exponent, comma, whitespace, and >6-decimal amounts.
- Reject same-chain and unknown routes.
- Verify estimate invalidation on amount, account, and direction changes.
- Verify Standard/SLOW transfer mode and zero fee cap.
- Verify no local/session storage access in the bridge bundle.
- Verify source success plus destination failure renders partial, not success.
- Verify mainnet remains non-addressable.
