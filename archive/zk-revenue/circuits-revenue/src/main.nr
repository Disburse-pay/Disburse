// Disburse — ZK revenue predicate (PSP v2).
//
// Proves, in zero knowledge, that a borrower has at least `threshold` of USDC
// revenue from at least `min_distinct_payers` distinct payers within
// [window_from, window_to], where every receipt is committed under the public
// Merkle `root` (posted by Disburse in RevenueRegistry) — without revealing the
// receipts, amounts, or payers.
//
// Predicate (authoritative definition: spec/psp-v2-zk-revenue.md; this circuit
// is the reference implementation, and the matching TS commitment builder in
// server/credit/merkle.ts is unit-tested):
//
//   For K selected receipts (one per distinct payer):
//     1. each leaf is a Merkle member of `root`            (sorted-pair keccak256)
//     2. each receipt's recipient == borrower
//     3. window_from <= timestamp <= window_to
//     4. payers are STRICTLY INCREASING                    (⇒ all distinct)
//     5. sum(amounts) >= threshold
//     6. K >= min_distinct_payers
//
//   leaf = keccak256(abi.encode(recipient, payer, amountUsdc, timestamp, uidHash))
//
// Build: `nargo compile && nargo test`; generate the Solidity verifier with
// `bb write_vk` + `bb contract`, then wire it into CreditController via
// setVerifier (it implements IRevenueProofVerifier). NOTE: the bb public-input
// encoding (byte-decomposed vs field-packed) is finalized at verifier
// generation; CreditController's bytes32[6] layout is the canonical ABI the
// generated verifier must be matched against.

use std::hash::keccak256;

global K: u32 = 8; // receipts proven (one per distinct payer)
global DEPTH: u32 = 16; // Merkle depth → up to 65,536 committed leaves

fn main(
    // ── public inputs (must match CreditController bytes32[6] ordering) ──
    root: pub [u8; 32],
    borrower: pub Field,
    threshold: pub u64,
    // publicInputs[3]: the EXACT number of distinct payers proven (= active
    // slots). The controller checks this against its own minimum.
    num_payers: pub u64,
    window_from: pub u64,
    window_to: pub u64,
    // ── private witness (slots ≥ num_payers are unused/zero padding) ──
    payers: [Field; K],
    amounts: [u64; K],
    timestamps: [u64; K],
    uid_hashes: [[u8; 32]; K],
    siblings: [[[u8; 32]; DEPTH]; K],
    path_lens: [u32; K],
) {
    // 1 ≤ num_payers ≤ K. The first `count` slots are the real receipts.
    assert(num_payers >= 1);
    assert(num_payers <= K as u64);
    let count: u32 = num_payers as u32;

    let mut sum: u64 = 0;
    for i in 0..K {
        let active = i < count;
        if active {
            // (2) recipient == borrower for every selected receipt.
            let leaf = revenue_leaf(borrower, payers[i], amounts[i], timestamps[i], uid_hashes[i]);
            // (1) Merkle membership against the public root.
            assert(eq32(compute_root(leaf, siblings[i], path_lens[i]), root));
            // (3) within the revenue window.
            assert(timestamps[i] >= window_from);
            assert(timestamps[i] <= window_to);
            // (5) accumulate only active slots.
            sum += amounts[i];
        }
    }

    // (4) strictly increasing payers among consecutive ACTIVE slots ⇒ distinct.
    // Separate bounded loop so payers[i + 1] is never a compile-time OOB.
    for i in 0..(K - 1) {
        if i + 1 < count {
            assert(lt_field(payers[i], payers[i + 1]));
        }
    }

    // (6) revenue floor.
    assert(sum >= threshold);
}

// leaf = keccak256(abi.encode(address recipient, address payer,
//                             uint256 amount, uint64 timestamp, bytes32 uidHash))
// ABI encoding right-aligns each value in a 32-byte word → 160 bytes total.
fn revenue_leaf(recipient: Field, payer: Field, amount: u64, timestamp: u64, uid_hash: [u8; 32]) -> [u8; 32] {
    let mut buf: [u8; 160] = [0; 160];

    // word 0: recipient (low 20 bytes of a 32-byte word)
    let r = recipient.to_be_bytes::<32>();
    for j in 0..32 {
        buf[j] = r[j];
    }
    // word 1: payer
    let p = payer.to_be_bytes::<32>();
    for j in 0..32 {
        buf[32 + j] = p[j];
    }
    // word 2: amount (uint256, big-endian in low 8 bytes)
    let a = (amount as Field).to_be_bytes::<32>();
    for j in 0..32 {
        buf[64 + j] = a[j];
    }
    // word 3: timestamp (uint64, big-endian in low 8 bytes)
    let t = (timestamp as Field).to_be_bytes::<32>();
    for j in 0..32 {
        buf[96 + j] = t[j];
    }
    // word 4: uidHash (bytes32)
    for j in 0..32 {
        buf[128 + j] = uid_hash[j];
    }

    keccak256(buf, 160)
}

// Commutative (sorted-pair) Merkle root from a leaf + sibling path. Levels
// beyond `path_len` are inactive (carry the node up), matching the odd-node
// behavior of server/credit/merkle.ts.
fn compute_root(leaf: [u8; 32], siblings: [[u8; 32]; DEPTH], path_len: u32) -> [u8; 32] {
    let mut node = leaf;
    for level in 0..DEPTH {
        if level < path_len {
            node = keccak_pair(node, siblings[level]);
        }
    }
    node
}

fn keccak_pair(a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
    let a_first = le32(a, b);
    let mut buf: [u8; 64] = [0; 64];
    for i in 0..32 {
        buf[i] = if a_first { a[i] } else { b[i] };
        buf[32 + i] = if a_first { b[i] } else { a[i] };
    }
    keccak256(buf, 64)
}

// a <= b, lexicographic over 32 bytes (big-endian).
fn le32(a: [u8; 32], b: [u8; 32]) -> bool {
    let mut decided = false;
    let mut result = true;
    for i in 0..32 {
        if !decided {
            if a[i] < b[i] {
                result = true;
                decided = true;
            }
            if a[i] > b[i] {
                result = false;
                decided = true;
            }
        }
    }
    result
}

fn eq32(a: [u8; 32], b: [u8; 32]) -> bool {
    let mut equal = true;
    for i in 0..32 {
        if a[i] != b[i] {
            equal = false;
        }
    }
    equal
}

// strict a < b over the big-endian byte representation of two Fields (used for
// the distinct-payer ordering constraint).
fn lt_field(a: Field, b: Field) -> bool {
    let ab = a.to_be_bytes::<32>();
    let bb = b.to_be_bytes::<32>();
    let mut decided = false;
    let mut result = false;
    for i in 0..32 {
        if !decided {
            if ab[i] < bb[i] {
                result = true;
                decided = true;
            }
            if ab[i] > bb[i] {
                result = false;
                decided = true;
            }
        }
    }
    result
}

#[test]
fn test_distinct_increasing() {
    assert(lt_field(1, 2));
    assert(!lt_field(2, 2));
}
