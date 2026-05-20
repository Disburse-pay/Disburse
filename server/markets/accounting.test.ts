import { describe, expect, it } from "vitest";
import {
  clampShareReduction,
  costBasisForShareReduction,
  prorateAmount,
  type CachedPosition,
} from "./accounting.js";

describe("markets accounting helpers", () => {
  it("allocates cost basis pro-rata to the outcome being reduced", () => {
    const position: CachedPosition = {
      yesShares: 6_000_000n,
      noShares: 4_000_000n,
      costBasis: 5_000_000n,
      realizedPnl: 0n,
    };

    expect(costBasisForShareReduction(position, 1, 3_000_000n)).toBe(1_500_000n);
    expect(costBasisForShareReduction(position, 0, 2_000_000n)).toBe(1_000_000n);
  });

  it("clamps reductions to cached positive shares", () => {
    const position: CachedPosition = {
      yesShares: 1_000_000n,
      noShares: 0n,
      costBasis: 400_000n,
      realizedPnl: 0n,
    };

    expect(clampShareReduction(position, 1, 5_000_000n)).toBe(1_000_000n);
    expect(costBasisForShareReduction(position, 1, 5_000_000n)).toBe(400_000n);
  });

  it("prorates proceeds for partial cached reductions", () => {
    expect(prorateAmount(900_000n, 1_000_000n, 3_000_000n)).toBe(300_000n);
  });
});
