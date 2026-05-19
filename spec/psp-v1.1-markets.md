# PSP v1.1 Markets Addendum

## Summary

PSP v1.1 extends Portable Settlement Proofs from invoice payments to prediction-market payouts. A market-claim PSP proves that a resolved market paid a claimant on Arc after burning winning outcome shares.

Exactly one of `invoice` or `marketClaim` is present in the PSP core. Existing PSP v1 payment proofs keep their wire shape.

## Market Claim PSP Shape

`marketClaim` is included in the signed PSP core:

| Field | Type | Notes |
| --- | --- | --- |
| `marketId` | string | Off-chain market UUID. |
| `onchainMarket` | address | Arc `Market` contract that emitted `MarketClaimed`. |
| `question` | string | Denormalized market question for offline readability. |
| `outcome` | `"YES" | "NO"` | Outcome redeemed by the claimant. |
| `winningOutcome` | `"YES" | "NO"` | Resolved winning outcome. Must equal `outcome` for successful claims. |
| `sharesRedeemed` | string | 1e6 fixed-point share amount. |
| `payoutAmount` | string | Human-readable USDC amount. |
| `resolvedAt` | ISO-8601 string | Market resolution timestamp. |

The standard `settlement` block points at the Arc claim transaction. Its `settlementEvent` uses:

- `contract`: the `Market` contract address
- `settlementId`: `MarketClaimed.settlementId`
- `eventTopic`: `keccak256("MarketClaimed(bytes32,bytes32,address,uint256,uint8)")`
- `logIndex`: the log index in the claim transaction

## On-Chain Event Binding

Each `Market.claim(amount)` emits:

```solidity
event MarketClaimed(
    bytes32 indexed settlementId,
    bytes32 indexed marketId,
    address indexed claimant,
    uint256 amount,
    uint8 outcome
);
```

The backend indexes a claim only if:

- the receipt succeeded,
- the log was emitted by the expected market contract,
- `marketId == keccak256(bytes(offchainMarketUuid))`,
- the tx hash has not already been indexed for a different market.

After indexing, PSP issuance is idempotent on `psp_documents.market_claim_id`.

## Position Cache

`market_positions` is a cache, not the source of truth. OutcomeToken balances on Arc remain authoritative.

The fills indexer updates the cache only when a `market_fills` row is newly inserted. Replayed fill receipts do not reapply deltas.

For each `Filled` event:

- `side = BUY`: maker gains shares, taker loses shares.
- `side = SELL`: taker gains shares, maker loses shares.
- Buyer cost basis increases by `totalUsdc`.
- Seller realized PnL increases by `totalUsdc`.

The database function `apply_market_position_delta(...)` performs atomic upserts so concurrent fill indexing cannot lose updates.

## Smoke Probe

`scripts/smoke-markets.ts` is a live Arc/Supabase probe. It requires an existing market:

- `MARKETS_SMOKE_MARKET_ID`
- `MARKETS_SMOKE_TRADER_PRIVATE_KEY` or `MARKETS_RELAYER_PRIVATE_KEY`
- `ENABLE_PSP=1`
- `DISBURSE_PSP_SIGNING_KEY`

The probe asserts the market is open and closes within `MARKETS_SMOKE_MAX_WAIT_MS` (default 10 minutes), mints a complete set, waits for close, resolves, claims, fetches the returned PSP, and verifies it offline.

## Verifier Responsibilities

Offline verifiers must validate:

- exactly one of `invoice` or `marketClaim`,
- canonical digest and UID,
- issuer signature,
- market-claim field structure.

`MarketsPspVerifier.sol` provides the market-claim on-chain path. Because market claims are emitted by per-market contracts rather than a single settlement registry, it stores owner-recorded claim facts keyed by `settlementId` and verifies:

- PSP signature recovers the configured issuer,
- the recorded claim fact exists,
- market, claimant, amount, and outcome match verifier calldata.

Admin ownership of markets contracts should be held by `MarketsAdminMultisig` in hardened deployments.

