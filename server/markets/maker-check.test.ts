/**
 * Tests for maker-check.ts. We stub the RPC reader so the assertions run
 * without an actual chain — the goal is to pin the BUY/SELL branching, the
 * required-USDC math, and the failure-mode error messages.
 *
 * If you change the inventory math in maker-check.ts, change the
 * "required = price * size / 1e6" expectations here too.
 */

import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  assertMakerInventory,
  tokenIdFor,
  type InventoryReader,
} from "./maker-check.js";
import { PRICE_SCALE, type OrderTypedData } from "./orders.js";

const MAKER: Address = "0x1234567890123456789012345678901234567890";
const MARKET: Address = "0x2222222222222222222222222222222222222222";
const EXCHANGE: Address = "0xACC7D7441d869080EFf853E4edF6A836C49172Fb";
const USDC: Address = "0x3600000000000000000000000000000000000000";
const OUTCOME_TOKEN: Address = "0x9c48BD5eCee82AB078534EfAa0c11F00b3f7e204";

function futureExpiry(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 3600);
}

function buyOrder(overrides: Partial<OrderTypedData> = {}): OrderTypedData {
  return {
    maker: MAKER,
    market: MARKET,
    outcome: 1,
    side: 0, // BUY
    price: 500_000n, // 0.50 USDC/share
    size: 10_000_000n, // 10 shares
    expiry: futureExpiry(),
    salt: 1n,
    ...overrides,
  };
}

function sellOrder(overrides: Partial<OrderTypedData> = {}): OrderTypedData {
  return {
    maker: MAKER,
    market: MARKET,
    outcome: 1,
    side: 1, // SELL
    price: 500_000n,
    size: 10_000_000n,
    expiry: futureExpiry(),
    salt: 2n,
    ...overrides,
  };
}

/**
 * Build a stub InventoryReader from a flat dictionary of
 * `${address}:${functionName}` → response. Helpful for asserting on the exact
 * functions/args without standing up a full mock framework.
 */
function makeReader(
  responses: Partial<Record<string, unknown>>
): InventoryReader {
  return {
    async readContract({ address, functionName }) {
      const key = `${address.toLowerCase()}:${functionName}`;
      if (!(key in responses)) {
        throw new Error(`unexpected RPC call: ${key}`);
      }
      return responses[key];
    },
  };
}

describe("tokenIdFor", () => {
  it("is deterministic and differs across outcomes", () => {
    const yes = tokenIdFor(MARKET, 1);
    const no = tokenIdFor(MARKET, 0);
    expect(yes).not.toBe(no);
    expect(tokenIdFor(MARKET, 1)).toBe(yes);
  });
});

describe("assertMakerInventory: BUY orders", () => {
  it("accepts when balance and allowance cover price * size / 1e6", async () => {
    const order = buyOrder();
    const required = (order.price * order.size) / PRICE_SCALE;
    expect(required).toBe(5_000_000n); // $5 for 10 shares @ 0.50
    const client = makeReader({
      [`${USDC.toLowerCase()}:balanceOf`]: required,
      [`${USDC.toLowerCase()}:allowance`]: required,
    });
    await expect(
      assertMakerInventory(order, EXCHANGE, {
        client,
        collateral: USDC,
        outcomeToken: OUTCOME_TOKEN,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects on insufficient balance", async () => {
    const order = buyOrder();
    const required = (order.price * order.size) / PRICE_SCALE;
    const client = makeReader({
      [`${USDC.toLowerCase()}:balanceOf`]: required - 1n,
      [`${USDC.toLowerCase()}:allowance`]: required,
    });
    await expect(
      assertMakerInventory(order, EXCHANGE, {
        client,
        collateral: USDC,
        outcomeToken: OUTCOME_TOKEN,
      })
    ).rejects.toThrow(/USDC balance/);
  });

  it("rejects on insufficient allowance", async () => {
    const order = buyOrder();
    const required = (order.price * order.size) / PRICE_SCALE;
    const client = makeReader({
      [`${USDC.toLowerCase()}:balanceOf`]: required,
      [`${USDC.toLowerCase()}:allowance`]: required - 1n,
    });
    await expect(
      assertMakerInventory(order, EXCHANGE, {
        client,
        collateral: USDC,
        outcomeToken: OUTCOME_TOKEN,
      })
    ).rejects.toThrow(/approve Exchange/);
  });
});

describe("assertMakerInventory: SELL orders", () => {
  it("accepts when shares >= size and isApprovedForAll", async () => {
    const order = sellOrder();
    const client = makeReader({
      [`${OUTCOME_TOKEN.toLowerCase()}:balanceOf`]: order.size,
      [`${OUTCOME_TOKEN.toLowerCase()}:isApprovedForAll`]: true,
    });
    await expect(
      assertMakerInventory(order, EXCHANGE, {
        client,
        collateral: USDC,
        outcomeToken: OUTCOME_TOKEN,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects on insufficient shares", async () => {
    const order = sellOrder();
    const client = makeReader({
      [`${OUTCOME_TOKEN.toLowerCase()}:balanceOf`]: order.size - 1n,
      [`${OUTCOME_TOKEN.toLowerCase()}:isApprovedForAll`]: true,
    });
    await expect(
      assertMakerInventory(order, EXCHANGE, {
        client,
        collateral: USDC,
        outcomeToken: OUTCOME_TOKEN,
      })
    ).rejects.toThrow(/YES shares/);
  });

  it("rejects when isApprovedForAll is false", async () => {
    const order = sellOrder();
    const client = makeReader({
      [`${OUTCOME_TOKEN.toLowerCase()}:balanceOf`]: order.size,
      [`${OUTCOME_TOKEN.toLowerCase()}:isApprovedForAll`]: false,
    });
    await expect(
      assertMakerInventory(order, EXCHANGE, {
        client,
        collateral: USDC,
        outcomeToken: OUTCOME_TOKEN,
      })
    ).rejects.toThrow(/setApprovalForAll/);
  });

  it("uses the NO label in the error when outcome=0", async () => {
    const order = sellOrder({ outcome: 0 });
    const client = makeReader({
      [`${OUTCOME_TOKEN.toLowerCase()}:balanceOf`]: 0n,
      [`${OUTCOME_TOKEN.toLowerCase()}:isApprovedForAll`]: true,
    });
    await expect(
      assertMakerInventory(order, EXCHANGE, {
        client,
        collateral: USDC,
        outcomeToken: OUTCOME_TOKEN,
      })
    ).rejects.toThrow(/NO shares/);
  });
});
