# Disburse circuits

Noir circuits for Phase 2 ZK revenue proofs (see [spec/psp-v2-zk-revenue.md](../spec/psp-v2-zk-revenue.md)).

- **`smoke/`** — a trivial circuit (`x*x == y`) to validate the toolchain on a fresh VPS before building the heavy one.
- **`revenue/`** — the real predicate: prove ≥ `threshold` USDC revenue from `num_payers` distinct payers in a window, all committed under a Merkle `root`, revealing nothing. `Prover.toml` is a **valid, internally-consistent witness** generated from the tested TS builders via `npx tsx scripts/emit-revenue-prover-toml.ts`.

> These can't be compiled in the JS dev env (no `nargo`). They're validated by their TS counterparts — `server/credit/merkle.ts` and `proofInputs.ts` (unit-tested), which use the identical leaf encoding and sorted-pair keccak hashing — plus this runbook. Compile/prove them on the VPS.

## VPS prerequisites

- Linux x86_64. The `revenue` circuit is **keccak-heavy** (each leaf + Merkle level is a keccak), so with `K=8, DEPTH=16` it is large — budget **≥ 16 GB RAM** for proving and expect minutes. The `smoke` circuit needs almost nothing.
- For a faster first build, lower the circuit globals `K` / `DEPTH` in `revenue/src/main.nr` **and** the matching `PROOF_K` / `PROOF_DEPTH` in `server/credit/proofInputs.ts`, then re-run the emit script. (Poseidon leaves instead of keccak are the real cost reduction — a follow-up.)

## Install toolchain

```bash
# Noir (nargo)
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup                       # latest stable; pin with `noirup --version <v>` if needed
nargo --version

# Barretenberg (bb) — proving backend / Solidity verifier generator
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
bbup
bb --version
```

## 1. Validate the toolchain (smoke)

```bash
cd circuits/smoke
nargo test                   # runs the in-file #[test]
nargo execute                # witness from Prover.toml → ./target/smoke.gz
bb prove -b ./target/smoke.json -w ./target/smoke.gz -o ./target
bb write_vk -b ./target/smoke.json -o ./target
bb verify -k ./target/vk -p ./target/proof          # should succeed
```

If that round-trips, the VPS is set.

## 2. Build the revenue circuit

```bash
cd circuits/revenue
nargo check                  # type/constraint check
nargo test                   # in-file unit test
nargo execute                # uses the generated Prover.toml witness
bb prove -b ./target/revenue.json -w ./target/revenue.gz -o ./target
bb write_vk -b ./target/revenue.json -o ./target
bb verify -k ./target/vk -p ./target/proof
bb contract                  # → Solidity verifier implementing IRevenueProofVerifier
```

## 3. Wire it in

1. Deploy the generated verifier contract.
2. `CreditController.setVerifier(<verifier address>)`.
3. `RevenueRegistry.postRoot(<root>)` for each committed epoch (the root printed by the emit script, or produced by `server/credit/merkle.ts` in prod).

## Known integration points to confirm on first build

- **API drift.** The circuit uses `Field::to_be_bytes::<32>()` and `std::hash::keccak256(input, len)`. If `nargo compile` errors on those, they moved between Noir versions — adjust to your `nargo --version`'s stdlib.
- **Public-input encoding.** `bb`'s generated verifier fixes how public inputs are laid out (a `[u8;32]` like `root` is typically expanded to 32 one-byte field elements, not one `bytes32`). `CreditController`'s `bytes32[6]` is the *logical* ABI; match `openCreditLine`'s `publicInputs` construction to whatever the generated verifier's `verify(bytes, bytes32[])` actually expects before mainnet. The mock-verifier tests cover the control flow; this marshalling is the one thing to reconcile against the real verifier.
