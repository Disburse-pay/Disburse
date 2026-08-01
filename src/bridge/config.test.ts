import { BridgeKit } from "@circle-fin/bridge-kit";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_CHAINS,
  EXECUTABLE_BRIDGE_SOURCE_KEYS,
  INITIAL_BRIDGE_ROUTE,
  TESTNET_BRIDGE_CONFIG,
  UNAVAILABLE_BRIDGE_SOURCES,
  formatBridgeExplorerUrl,
  isBridgeSourceKey,
  isSupportedBridgeRoute,
  normalizeBridgeAmount
} from "./config";

describe("bridge safety configuration", () => {
  it("routes every executable CCTP V2 source only to Arc Testnet", () => {
    for (const source of EXECUTABLE_BRIDGE_SOURCE_KEYS) {
      expect(isSupportedBridgeRoute({ source, destination: "Arc_Testnet" })).toBe(true);
      expect(BRIDGE_CHAINS[source].domain).not.toBe(BRIDGE_CHAINS.Arc_Testnet.domain);
    }
    expect(isSupportedBridgeRoute(INITIAL_BRIDGE_ROUTE)).toBe(true);
    expect(isBridgeSourceKey("Arc_Testnet")).toBe(false);
    expect(isBridgeSourceKey("Sui_Testnet")).toBe(false);
  });

  it("matches Bridge Kit's executable testnet CCTP routes without falsely enabling gaps", () => {
    const sdkSources = new BridgeKit()
      .getSupportedChains({ isTestnet: true })
      .filter((chain) => chain.cctp && chain.chain !== "Arc_Testnet")
      .map((chain) => chain.chain)
      .sort();
    expect([...EXECUTABLE_BRIDGE_SOURCE_KEYS].sort()).toEqual(sdkSources);
    expect(EXECUTABLE_BRIDGE_SOURCE_KEYS).toHaveLength(22);
    expect(BRIDGE_CHAINS.Solana_Devnet.walletFamily).toBe("solana");
    expect(BRIDGE_CHAINS.Ethereum_Sepolia.walletFamily).toBe("evm");
    expect(UNAVAILABLE_BRIDGE_SOURCES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "Stellar_Testnet", detail: expect.stringContaining("CCTP V2") }),
        expect.objectContaining({ key: "Starknet_Sepolia", detail: expect.stringContaining("CCTP V2") }),
        expect.objectContaining({ key: "Cronos_Testnet", detail: expect.stringContaining("CCTP V2") }),
        expect.objectContaining({ key: "Sui_Testnet", detail: "CCTP V1 only" })
      ])
    );
  });

  it("uses Standard CCTP with a zero testnet fee cap", () => {
    expect(TESTNET_BRIDGE_CONFIG).toMatchObject({ transferSpeed: "SLOW", maxFee: "0" });
    expect(TESTNET_BRIDGE_CONFIG).not.toHaveProperty("customFee");
  });

  it("builds chain-specific explorer links from the SDK definition", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(formatBridgeExplorerUrl("Ethereum_Sepolia", hash)).toContain(`/tx/${hash}`);
    expect(formatBridgeExplorerUrl("Solana_Devnet", "solana-signature")).toContain(
      "solana-signature"
    );
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
