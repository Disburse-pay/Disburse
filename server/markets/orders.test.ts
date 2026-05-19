/**
 * Tests for the EIP-712 order helpers. These are the highest-risk piece of
 * the markets backend — any divergence from the on-chain `Exchange.hashOrder`
 * silently breaks signature verification on the chain. The tests below pin:
 *   - the typed-data shape matches what wallets will sign,
 *   - parseWireOrder rejects malformed input loudly,
 *   - assertOrderBounds mirrors the on-chain require's so we catch bad
 *     orders before wasting an RPC round-trip on signature verify.
 */

import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import {
  assertOrderBounds,
  getExchangeDomain,
  hashOrder,
  ORDER_EIP712_TYPES,
  parseWireOrder,
  PRICE_SCALE,
  verifyOrderSignature,
  type OrderTypedData,
} from "./orders.js";

const EXCHANGE: Address = "0xACC7D7441d869080EFf853E4edF6A836C49172Fb";

function futureExpiry(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 3600);
}

function makeOrder(maker: Address): OrderTypedData {
  return {
    maker,
    market: "0x1111111111111111111111111111111111111111" as Address,
    outcome: 1,
    side: 0,
    price: 500_000n, // 0.50 USDC/share
    size: 1_000_000n,
    expiry: futureExpiry(),
    salt: 42n,
  };
}

describe("orders.ts: typed-data shape", () => {
  it("ORDER_EIP712_TYPES matches the on-chain typehash field order", () => {
    // The struct field order MUST match Exchange.sol:
    //   "Order(address maker,address market,uint8 outcome,uint8 side,
    //    uint256 price,uint256 size,uint64 expiry,uint256 salt)"
    // Order matters: viem encodes by-position not by-name.
    expect(ORDER_EIP712_TYPES.Order.map((f) => f.name)).toEqual([
      "maker",
      "market",
      "outcome",
      "side",
      "price",
      "size",
      "expiry",
      "salt",
    ]);
  });

  it("domain matches Exchange constructor", () => {
    const d = getExchangeDomain(EXCHANGE);
    expect(d.name).toBe("Disburse Markets");
    expect(d.version).toBe("1");
    expect(d.chainId).toBe(5_042_002);
    expect(d.verifyingContract).toBe(EXCHANGE);
  });
});

describe("orders.ts: sign + verify roundtrip", () => {
  it("verifyOrderSignature accepts a signature from the maker", async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const order = makeOrder(account.address);

    const signature = await account.signTypedData({
      domain: getExchangeDomain(EXCHANGE),
      types: ORDER_EIP712_TYPES,
      primaryType: "Order",
      message: order,
    });

    const ok = await verifyOrderSignature({ ...order, signature }, EXCHANGE);
    expect(ok).toBe(true);
  });

  it("verifyOrderSignature rejects a signature from a different signer", async () => {
    const makerKey = generatePrivateKey();
    const otherKey = generatePrivateKey();
    const maker = privateKeyToAccount(makerKey);
    const other = privateKeyToAccount(otherKey);
    const order = makeOrder(maker.address);

    // The "other" wallet signs, but the order claims `maker` as maker.
    const signature = await other.signTypedData({
      domain: getExchangeDomain(EXCHANGE),
      types: ORDER_EIP712_TYPES,
      primaryType: "Order",
      message: order,
    });

    const ok = await verifyOrderSignature({ ...order, signature }, EXCHANGE);
    expect(ok).toBe(false);
  });

  it("hashOrder is deterministic for identical orders", () => {
    const order = makeOrder("0x1234567890123456789012345678901234567890" as Address);
    const h1 = hashOrder(order, EXCHANGE);
    const h2 = hashOrder(order, EXCHANGE);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("hashOrder changes if the salt changes", () => {
    const a = makeOrder("0x1234567890123456789012345678901234567890" as Address);
    const b = { ...a, salt: a.salt + 1n };
    expect(hashOrder(a, EXCHANGE)).not.toBe(hashOrder(b, EXCHANGE));
  });
});

describe("orders.ts: assertOrderBounds", () => {
  const maker = "0x1234567890123456789012345678901234567890" as Address;

  it("accepts a well-formed order", () => {
    expect(() => assertOrderBounds(makeOrder(maker))).not.toThrow();
  });

  it("rejects price = 0", () => {
    expect(() => assertOrderBounds({ ...makeOrder(maker), price: 0n })).toThrow(
      /price out of range/
    );
  });

  it("rejects price >= PRICE_SCALE (would imply probability >= 1)", () => {
    expect(() =>
      assertOrderBounds({ ...makeOrder(maker), price: PRICE_SCALE })
    ).toThrow(/price out of range/);
  });

  it("rejects size = 0", () => {
    expect(() => assertOrderBounds({ ...makeOrder(maker), size: 0n })).toThrow(
      /size must be positive/
    );
  });

  it("rejects already-expired orders", () => {
    const order = { ...makeOrder(maker), expiry: 1n };
    expect(() => assertOrderBounds(order)).toThrow(/expired/);
  });

  it("rejects invalid outcome (2)", () => {
    const order = { ...makeOrder(maker), outcome: 2 as unknown as 0 | 1 };
    expect(() => assertOrderBounds(order)).toThrow(/Invalid outcome/);
  });
});

describe("orders.ts: parseWireOrder", () => {
  const validWire = () => ({
    maker: "0x1234567890123456789012345678901234567890",
    market: "0x2345678901234567890123456789012345678901",
    outcome: 1,
    side: 0,
    price: "500000",
    size: "1000000",
    expiry: String(Math.floor(Date.now() / 1000) + 3600),
    salt: "42",
    signature:
      "0x" + "a".repeat(130),
  });

  it("parses a valid wire-format order", () => {
    const parsed = parseWireOrder(validWire());
    expect(parsed.price).toBe(500_000n);
    expect(parsed.size).toBe(1_000_000n);
    expect(parsed.outcome).toBe(1);
    expect(parsed.side).toBe(0);
  });

  it("rejects non-object input", () => {
    expect(() => parseWireOrder(null)).toThrow();
    expect(() => parseWireOrder("string")).toThrow();
  });

  it("rejects invalid maker address", () => {
    const w = { ...validWire(), maker: "not-an-address" };
    expect(() => parseWireOrder(w)).toThrow(/maker/);
  });

  it("rejects invalid outcome", () => {
    const w = { ...validWire(), outcome: 2 };
    expect(() => parseWireOrder(w)).toThrow(/outcome/);
  });

  it("rejects non-numeric price string", () => {
    const w = { ...validWire(), price: "0.5" };
    expect(() => parseWireOrder(w)).toThrow(/price/);
  });

  it("rejects malformed signature", () => {
    const w = { ...validWire(), signature: "0xshort" };
    expect(() => parseWireOrder(w)).toThrow(/signature/);
  });
});
