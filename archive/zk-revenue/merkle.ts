/**
 * Revenue commitment Merkle tree (Phase 2 ZK).
 *
 * Disburse commits each recipient's USDC receipts into a keccak256 Merkle tree
 * and publishes the signed root (RevenueRegistry on-chain). A borrower can then
 * prove, in zero knowledge, that a subset of committed leaves sums to ≥ a
 * threshold across ≥ N distinct payers in a window — without revealing the
 * receipts — and a contract verifies the proof to set a credit limit.
 *
 * This module is the trusted-issuer side: it builds the tree, root, and
 * membership proofs, and evaluates the same predicate the circuit enforces.
 * It uses keccak256 (EVM- and Noir-native) so the TS root and the circuit's
 * Merkle root are identical with no extra dependency. (Poseidon would lower
 * proving cost — a documented follow-up.)
 *
 * Leaf and pair hashing match contracts/circuits exactly:
 *   leaf   = keccak256(abi.encode(recipient, payer, amountUsdc, timestamp, uidHash))
 *   parent = keccak256(sorted(left, right))   // commutative (OZ-style)
 */
import { concat, encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import { parseTokenAmount } from "../../src/lib/payments.js";
import type { PspInvoice, PspV1 } from "../../src/lib/psp/types.js";

type PaymentPsp = PspV1 & { invoice: PspInvoice };

export type RevenueLeaf = {
  recipient: Address;
  payer: Address;
  /** USDC base units (6 decimals). */
  amountUsdc: bigint;
  /** Unix seconds. */
  timestamp: number;
  /** PSP uid (content address of the receipt). */
  uid: string;
};

export type RevenuePredicate = {
  borrower: Address;
  /** Minimum summed revenue (USDC base units). */
  thresholdUsdc: bigint;
  /** Minimum distinct payers. */
  minDistinctPayers: number;
  /** Inclusive window (unix seconds). */
  windowFrom: number;
  windowTo: number;
};

// ---------- Leaf + hashing ----------

export function hashUid(uid: string): Hex {
  return keccak256(toBytes(uid));
}

export function revenueLeaf(entry: RevenueLeaf): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }],
      [entry.recipient, entry.payer, entry.amountUsdc, BigInt(entry.timestamp), hashUid(entry.uid)]
    )
  );
}

function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([lo, hi]));
}

// ---------- Tree ----------

export type MerkleTree = {
  leaves: Hex[];
  layers: Hex[][]; // layers[0] = leaves, last layer = [root]
  root: Hex;
};

/** Build a commutative (sorted-pair) keccak Merkle tree. Odd nodes carry up. */
export function buildMerkleTree(leaves: Hex[]): MerkleTree {
  if (leaves.length === 0) {
    throw new Error("buildMerkleTree: need at least one leaf");
  }
  const layers: Hex[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  return { leaves, layers, root: layers[layers.length - 1][0] };
}

/** Sibling path (sorted-pair → no index bits needed) for the leaf at `index`. */
export function getProof(tree: MerkleTree, index: number): Hex[] {
  const proof: Hex[] = [];
  let idx = index;
  for (let level = 0; level < tree.layers.length - 1; level += 1) {
    const layer = tree.layers[level];
    const pairIndex = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (pairIndex < layer.length) proof.push(layer[pairIndex]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let computed = leaf;
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed.toLowerCase() === root.toLowerCase();
}

// ---------- Predicate ----------

export type PredicateResult = {
  satisfied: boolean;
  sumUsdc: bigint;
  distinctPayers: number;
  /** Indices of the leaves that satisfy the window/recipient filter. */
  selected: number[];
  reasons: string[];
};

/**
 * Evaluate the revenue predicate over a set of leaves — the same logic the
 * ZK circuit enforces. A leaf qualifies when recipient == borrower and its
 * timestamp is in [windowFrom, windowTo]. Returns whether the selected
 * leaves meet the threshold and distinct-payer minimum.
 */
export function evaluatePredicate(leaves: RevenueLeaf[], p: RevenuePredicate): PredicateResult {
  const borrower = p.borrower.toLowerCase();
  const selected: number[] = [];
  const payers = new Set<string>();
  let sum = 0n;

  leaves.forEach((leaf, i) => {
    if (leaf.recipient.toLowerCase() !== borrower) return;
    if (leaf.timestamp < p.windowFrom || leaf.timestamp > p.windowTo) return;
    selected.push(i);
    payers.add(leaf.payer.toLowerCase());
    sum += leaf.amountUsdc;
  });

  const reasons: string[] = [];
  if (sum < p.thresholdUsdc) reasons.push("sum below threshold");
  if (payers.size < p.minDistinctPayers) reasons.push("too few distinct payers");

  return {
    satisfied: reasons.length === 0,
    sumUsdc: sum,
    distinctPayers: payers.size,
    selected,
    reasons,
  };
}

// ---------- From PSPs ----------

function pspTimestamp(p: PaymentPsp): number {
  const candidates = [p.settlement?.settledAt, p.createdAt, p.invoice.invoiceDate];
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return 0;
}

/** Convert USDC payment PSPs into revenue leaves (skips non-USDC PSPs). */
export function leavesFromPsps(proofs: PaymentPsp[]): RevenueLeaf[] {
  return proofs
    .filter((p) => p.invoice.token === "USDC")
    .map((p) => ({
      recipient: p.invoice.recipient,
      payer: p.invoice.payer,
      amountUsdc: parseTokenAmount(p.invoice.amount, "USDC"),
      timestamp: pspTimestamp(p),
      uid: p.uid,
    }));
}

/** Build the full commitment (leaves + tree) from a set of payment PSPs. */
export function buildRevenueCommitment(proofs: PaymentPsp[]): { entries: RevenueLeaf[]; tree: MerkleTree } {
  const entries = leavesFromPsps(proofs);
  const tree = buildMerkleTree(entries.map(revenueLeaf));
  return { entries, tree };
}
