# PSP v2 — Zero-Knowledge Revenue Proofs

**Status:** v2.0 draft (Arc Testnet)
**Depends on:** [PSP v1](psp-v1.md)
**Reference impl:** `server/credit/merkle.ts` (TS, tested), `circuits/revenue/` (Noir), `contracts/src/credit/` (Solidity)

---

## Abstract

A v2 revenue proof lets a business prove a **predicate over its settled receipts** — "I received ≥ T USDC from ≥ N distinct payers in a window" — **in zero knowledge**, revealing none of the underlying receipts, amounts, or counterparties. It is the privacy/trust upgrade for revenue-backed credit: instead of trusting Disburse's attestation, a contract verifies the proof and grants the credit line itself.

The construction leverages that Disburse already signs every PSP: rather than verifying N receipt signatures in-circuit (expensive), Disburse commits receipts into a Merkle tree and posts the root on-chain. The proof then only needs Merkle membership + a predicate over selected leaves.

---

## 1. Revenue leaf

Each settled USDC receipt commits to a leaf:

```
leaf = keccak256(abi.encode(
  address recipient,   // PSP invoice.recipient
  address payer,       // PSP invoice.payer
  uint256 amountUsdc,  // base units (6 decimals)
  uint64  timestamp,   // settledAt (unix seconds)
  bytes32 uidHash      // keccak256(utf8(PSP uid))
))
```

`keccak256` is used (not Poseidon) so the TS commitment root and the circuit's computed root are byte-identical with no extra dependency. Poseidon leaves would lower proving cost — a planned optimization.

## 2. Commitment tree

A **commutative (sorted-pair) keccak256 Merkle tree** over the epoch's leaves:

```
parent = keccak256(sorted(left, right))
```

Odd nodes carry up unchanged. The issuer (Disburse) posts the root to `RevenueRegistry.postRoot(root)`. `server/credit/merkle.ts` builds the tree, root, and membership proofs.

## 3. Predicate (circuit)

The circuit (`circuits/revenue/src/main.nr`) has `K` fixed slots; the first `num_payers` are real receipts (one per distinct payer) and the rest are zero padding. For each **active** slot it asserts:

1. each leaf is a Merkle member of the public `root`;
2. each receipt's `recipient == borrower` (public, used to build the leaf);
3. `window_from <= timestamp <= window_to`;
4. payers are **strictly increasing** across active slots ⇒ pairwise distinct;
5. `sum(active amounts) >= threshold`;
6. `1 <= num_payers <= K` (the exact proven distinct-payer count; the controller checks it against its own floor).

It reveals only the public inputs; the leaves, amounts, and payers stay private. Selecting one receipt per distinct payer simultaneously proves distinctness (constraint 4) and a conservative revenue floor (constraint 5).

## 4. Public inputs

Ordering is fixed and **must match `CreditController`'s `bytes32[6]`**:

| # | name | meaning |
|---|------|---------|
| 0 | `root` | registered commitment root |
| 1 | `borrower` | address the line is granted to |
| 2 | `provenRevenueUsdc` | proven summed revenue (= `threshold`) |
| 3 | `num_payers` | proven distinct-payer count (controller checks ≥ its floor) |
| 4 | `windowFrom` | window start (unix) |
| 5 | `windowTo` | window end (unix) |

> The exact byte/field marshalling of public inputs is finalized when the Solidity verifier is generated (`bb write_vk` → `bb contract`); `CreditController`'s array is the canonical ABI the generated verifier is matched against.

## 5. On-chain verification flow

1. `RevenueRegistry` — issuer posts/rotates roots; `isKnownRoot(root)`.
2. `CreditController.openCreditLine(proof, root, borrower, provenRevenueUsdc, provenMinPayers, windowFrom, windowTo)`:
   - requires `registry.isKnownRoot(root)` and `provenMinPayers >= minDistinctPayers`;
   - calls `IRevenueProofVerifier.verify(proof, publicInputs)` (the bb-generated verifier);
   - maps `provenRevenueUsdc → limit = min(revenueMultipleBps × revenue, cap)`;
   - grants it via `LendingPool.setCreditLimit` (the controller is the pool `underwriter`).

This replaces the Phase-1 relayer attestation with a path where the pool trusts a proof, not Disburse.

## 6. Toolchain (remaining step)

```bash
cd circuits/revenue
nargo test                 # exercise the predicate
nargo compile
bb write_vk -b ./target/revenue.json -o ./target
bb contract                # → Solidity verifier (implements IRevenueProofVerifier)
# deploy verifier, then CreditController.setVerifier(verifier)
```

Until then, `MockRevenueProofVerifier` stands in so the full on-chain integration (`RevenueRegistry` + `CreditController` + `LendingPool`) is testable — see `contracts/test/CreditController.t.sol`.

## 7. Security notes

- **Issuer trust** is confined to *which* receipts exist (the committed root); the proof itself is trustless. A bad root can be revoked (`RevenueRegistry.revokeRoot`).
- **Sybil / wash revenue** — constraint 4 forces distinct payers; the underwriting policy (multiple, cap, payer floor) is conservative. Per-payer reputation is a future addition.
- **Replay** — a proof re-grants the same borrower the same line; harmless (idempotent). Roots are epoch-scoped.
- **Mainnet** — must not gate real funds before an external audit of the circuit + verifier + controller, a multisig owner, and a KMS-held issuer key.
