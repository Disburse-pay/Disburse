import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  buildMerkleTree,
  evaluatePredicate,
  getProof,
  revenueLeaf,
  verifyProof,
  type RevenueLeaf,
} from "./merkle.js";

const BORROWER = "0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0" as Address;
const OTHER = "0x9999999999999999999999999999999999999999" as Address;
const P1 = "0x1111111111111111111111111111111111111111" as Address;
const P2 = "0x2222222222222222222222222222222222222222" as Address;
const P3 = "0x3333333333333333333333333333333333333333" as Address;

function leaf(payer: Address, amount: bigint, ts: number, uid: string, recipient = BORROWER): RevenueLeaf {
  return { recipient, payer, amountUsdc: amount, timestamp: ts, uid };
}

describe("merkle commitment", () => {
  it("produces a deterministic leaf hash", () => {
    const a = revenueLeaf(leaf(P1, 100_000000n, 1000, "psp:1"));
    const b = revenueLeaf(leaf(P1, 100_000000n, 1000, "psp:1"));
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes the leaf hash when any field changes", () => {
    const base = revenueLeaf(leaf(P1, 100_000000n, 1000, "psp:1"));
    expect(revenueLeaf(leaf(P2, 100_000000n, 1000, "psp:1"))).not.toBe(base);
    expect(revenueLeaf(leaf(P1, 100_000001n, 1000, "psp:1"))).not.toBe(base);
    expect(revenueLeaf(leaf(P1, 100_000000n, 1001, "psp:1"))).not.toBe(base);
    expect(revenueLeaf(leaf(P1, 100_000000n, 1000, "psp:2"))).not.toBe(base);
  });

  it("verifies membership proofs for every leaf", () => {
    const entries = [
      leaf(P1, 100_000000n, 1000, "psp:1"),
      leaf(P2, 200_000000n, 1001, "psp:2"),
      leaf(P3, 300_000000n, 1002, "psp:3"),
      leaf(P1, 50_000000n, 1003, "psp:4"),
      leaf(P2, 75_000000n, 1004, "psp:5"),
    ];
    const leaves = entries.map(revenueLeaf);
    const tree = buildMerkleTree(leaves);

    leaves.forEach((lf, i) => {
      const proof = getProof(tree, i);
      expect(verifyProof(lf, proof, tree.root)).toBe(true);
    });
  });

  it("rejects a tampered proof", () => {
    const leaves = [
      leaf(P1, 100_000000n, 1000, "psp:1"),
      leaf(P2, 200_000000n, 1001, "psp:2"),
      leaf(P3, 300_000000n, 1002, "psp:3"),
    ].map(revenueLeaf);
    const tree = buildMerkleTree(leaves);
    const proof = getProof(tree, 0);
    const wrongLeaf = revenueLeaf(leaf(P1, 999_000000n, 1000, "psp:x"));
    expect(verifyProof(wrongLeaf, proof, tree.root)).toBe(false);
  });

  it("handles a single-leaf tree (root == leaf)", () => {
    const lf = revenueLeaf(leaf(P1, 100_000000n, 1000, "psp:1"));
    const tree = buildMerkleTree([lf]);
    expect(tree.root).toBe(lf);
    expect(verifyProof(lf, getProof(tree, 0), tree.root)).toBe(true);
  });

  it("evaluates the predicate (threshold + distinct payers + window)", () => {
    const entries = [
      leaf(P1, 100_000000n, 1000, "psp:1"),
      leaf(P2, 100_000000n, 1001, "psp:2"),
      leaf(P3, 100_000000n, 1002, "psp:3"),
      leaf(P1, 100_000000n, 5000, "psp:4", OTHER), // wrong recipient → excluded
      leaf(P2, 100_000000n, 99_999, "psp:5"), // out of window → excluded
    ];

    const res = evaluatePredicate(entries, {
      borrower: BORROWER,
      thresholdUsdc: 250_000000n,
      minDistinctPayers: 3,
      windowFrom: 1000,
      windowTo: 2000,
    });

    expect(res.satisfied).toBe(true);
    expect(res.sumUsdc).toBe(300_000000n);
    expect(res.distinctPayers).toBe(3);
    expect(res.selected).toEqual([0, 1, 2]);
  });

  it("fails the predicate when below threshold or too few payers", () => {
    const entries = [
      leaf(P1, 100_000000n, 1000, "psp:1"),
      leaf(P1, 100_000000n, 1001, "psp:2"),
    ];
    const res = evaluatePredicate(entries, {
      borrower: BORROWER,
      thresholdUsdc: 500_000000n,
      minDistinctPayers: 3,
      windowFrom: 0,
      windowTo: 10_000,
    });
    expect(res.satisfied).toBe(false);
    expect(res.reasons).toContain("sum below threshold");
    expect(res.reasons).toContain("too few distinct payers");
  });
});
