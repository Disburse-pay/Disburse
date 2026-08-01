import { describe, expect, it } from "vitest";
import {
  INITIAL_BRIDGE_ROUTE,
  TESTNET_BRIDGE_CONFIG,
  isSupportedBridgeRoute,
  normalizeBridgeAmount,
  reverseBridgeRoute
} from "./config";

describe("bridge safety configuration", () => {
  it("allows only the Ethereum Sepolia and Arc Testnet route", () => {
    expect(isSupportedBridgeRoute(INITIAL_BRIDGE_ROUTE)).toBe(true);
    expect(isSupportedBridgeRoute(reverseBridgeRoute(INITIAL_BRIDGE_ROUTE))).toBe(true);
    expect(isSupportedBridgeRoute({ source: "Arc_Testnet", destination: "Arc_Testnet" })).toBe(false);
  });

  it("uses Standard CCTP with a zero testnet fee cap", () => {
    expect(TESTNET_BRIDGE_CONFIG).toMatchObject({ transferSpeed: "SLOW", maxFee: "0" });
    expect(TESTNET_BRIDGE_CONFIG).not.toHaveProperty("customFee");
  });

  it.each(["", "0", "-1", "+1", "1e3", "1,2", " 1", "1 ", ".1", "1.0000001"])(
    "rejects unsafe amount %j",
    (value) => expect(() => normalizeBridgeAmount(value)).toThrow()
  );

  it.each([["1", "1"], ["001", null], ["0.1", "0.1"], ["10.000001", "10.000001"]])(
    "normalizes valid amount %j",
    (value, expected) => {
      if (expected === null) {
        expect(() => normalizeBridgeAmount(value)).toThrow();
      } else {
        expect(normalizeBridgeAmount(value)).toBe(expected);
      }
    }
  );
});
