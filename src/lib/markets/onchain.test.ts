import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { planTakerFills } from "./onchain";
import type { RawOpenOrder } from "./api";

// Why these tests exist: planTakerFills is the only off-chain logic that
// decides how much USDC moves and which maker signatures get included in a
// fillOrders tx. A bug here either reverts on-chain (cheap) or pays an
// unintended price (expensive). The cases below pin behavior that the
// Exchange contract itself enforces — sort order (best price first), self-
// trade exclusion, expired-order exclusion, slippage gate, partial fills.

const MARKET = "0x000000000000000000000000000000000000aaaa" as Address;
const TAKER = "0x1111111111111111111111111111111111111111" as Address;
const MAKER_A = "0x2222222222222222222222222222222222222222" as Address;
const MAKER_B = "0x3333333333333333333333333333333333333333" as Address;

function order(partial: Partial<RawOpenOrder> & { side: 0 | 1; price: string; size: string }): RawOpenOrder {
  return {
    hash: ("0x" + "a".repeat(64)) as Hex,
    maker: MAKER_A,
    outcome: 1,
    side: partial.side,
    price: partial.price,
    size: partial.size,
    filled: "0",
    expiry: Math.floor(Date.now() / 1000) + 3600,
    salt: "1",
    signature: ("0x" + "b".repeat(130)) as Hex,
    status: "open",
    createdAt: "2026-01-01T00:00:00Z",
    ...partial
  };
}

describe("planTakerFills", () => {
  it("BUY taker sorts asks cheapest-first and stops at requested size", () => {
    const rawOrders: RawOpenOrder[] = [
      order({ maker: MAKER_A, side: 1, price: "600000", size: "5000000" }),
      order({ maker: MAKER_B, side: 1, price: "500000", size: "5000000" })
    ];
    const plan = planTakerFills({
      rawOrders,
      takerAddress: TAKER,
      outcome: "YES",
      intent: "BUY",
      sizeMicros: 7_000_000n,
      limitPriceMicros: 999_999n
    });
    // Cheapest ask (0.5) gets fully consumed; remainder (2) comes from the
    // 0.6 ask. Order matters because totalUsdc depends on it.
    expect(plan.length).toBe(2);
    expect(plan[0].order.maker).toBe(MAKER_B);
    expect(plan[0].fillSize).toBe(5_000_000n);
    expect(plan[1].order.maker).toBe(MAKER_A);
    expect(plan[1].fillSize).toBe(2_000_000n);
  });

  it("BUY taker skips asks above the slippage ceiling", () => {
    const rawOrders: RawOpenOrder[] = [
      order({ maker: MAKER_A, side: 1, price: "700000", size: "5000000" })
    ];
    const plan = planTakerFills({
      rawOrders,
      takerAddress: TAKER,
      outcome: "YES",
      intent: "BUY",
      sizeMicros: 5_000_000n,
      // Ceiling is 0.6; the only ask is at 0.7. Result: empty plan (no fill).
      limitPriceMicros: 600_000n
    });
    expect(plan).toEqual([]);
  });

  it("SELL taker sorts bids highest-first and respects the price floor", () => {
    const rawOrders: RawOpenOrder[] = [
      order({ maker: MAKER_A, side: 0, price: "400000", size: "5000000" }),
      order({ maker: MAKER_B, side: 0, price: "500000", size: "5000000" })
    ];
    const plan = planTakerFills({
      rawOrders,
      takerAddress: TAKER,
      outcome: "YES",
      intent: "SELL",
      sizeMicros: 6_000_000n,
      // Floor 0.45 → 0.4 bid skipped, 0.5 bid taken in full, plan ends partial.
      limitPriceMicros: 450_000n
    });
    expect(plan.length).toBe(1);
    expect(plan[0].order.maker).toBe(MAKER_B);
    expect(plan[0].fillSize).toBe(5_000_000n);
  });

  it("excludes the taker's own orders to avoid the contract's self-trade revert", () => {
    const rawOrders: RawOpenOrder[] = [
      // The taker has an open ask — even if it's the best price, it must be
      // skipped. fillOrder reverts with "self trade" otherwise.
      order({ maker: TAKER, side: 1, price: "100000", size: "5000000" }),
      order({ maker: MAKER_A, side: 1, price: "500000", size: "5000000" })
    ];
    const plan = planTakerFills({
      rawOrders,
      takerAddress: TAKER,
      outcome: "YES",
      intent: "BUY",
      sizeMicros: 1_000_000n,
      limitPriceMicros: 999_999n
    });
    expect(plan.length).toBe(1);
    expect(plan[0].order.maker).toBe(MAKER_A);
  });

  it("ignores expired and wrong-outcome orders", () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const rawOrders: RawOpenOrder[] = [
      // Expired — would revert at fillOrder.
      order({ maker: MAKER_A, side: 1, price: "100000", size: "5000000", expiry: past }),
      // Wrong outcome (NO instead of YES).
      order({ maker: MAKER_A, side: 1, price: "100000", size: "5000000", outcome: 0 }),
      order({ maker: MAKER_B, side: 1, price: "500000", size: "5000000" })
    ];
    const plan = planTakerFills({
      rawOrders,
      takerAddress: TAKER,
      outcome: "YES",
      intent: "BUY",
      sizeMicros: 1_000_000n,
      limitPriceMicros: 999_999n
    });
    expect(plan.length).toBe(1);
    expect(plan[0].order.maker).toBe(MAKER_B);
  });

  it("uses remaining = size - filled, not raw size", () => {
    const rawOrders: RawOpenOrder[] = [
      order({
        maker: MAKER_A,
        side: 1,
        price: "500000",
        size: "10000000",
        filled: "9000000",
        status: "partial"
      })
    ];
    const plan = planTakerFills({
      rawOrders,
      takerAddress: TAKER,
      outcome: "YES",
      intent: "BUY",
      sizeMicros: 5_000_000n,
      limitPriceMicros: 999_999n
    });
    // Maker has 1 share remaining; plan must cap there, not at 5.
    expect(plan.length).toBe(1);
    expect(plan[0].fillSize).toBe(1_000_000n);
  });
});
