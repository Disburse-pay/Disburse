import { describe, expect, it } from "vitest";
import {
  buildBridgeRecoverySearch,
  buildBridgeLocationSearch,
  assertBridgeRecoveryMessage,
  isBridgeTransactionId,
  parseBridgeRecovery,
  recoveryMatchesIntent,
  type BridgeRecovery
} from "./recovery";

const recovery: BridgeRecovery = {
  amount: "10",
  burnTxId: `0x${"ab".repeat(32)}`,
  route: { source: "Ethereum_Sepolia", destination: "Arc_Testnet" }
};

describe("bridge burn recovery", () => {
  it("round-trips only bounded testnet recovery data through the URL", () => {
    expect(parseBridgeRecovery(buildBridgeRecoverySearch(recovery))).toEqual(recovery);
  });

  it("preserves only the local bridge routing flag when adding or clearing recovery", () => {
    expect(buildBridgeLocationSearch("?bridge=1&utm_source=unsafe", recovery)).toBe(
      `?bridge=1&tx=${encodeURIComponent(recovery.burnTxId)}&amount=10&from=Ethereum_Sepolia&to=Arc_Testnet`
    );
    expect(buildBridgeLocationSearch("?bridge=1&tx=old", undefined)).toBe("?bridge=1");
    expect(buildBridgeLocationSearch("?utm_source=unsafe", undefined)).toBe("");
  });

  it.each([
    "?tx=0x1234&amount=10&from=Ethereum_Sepolia&to=Arc_Testnet",
    `?tx=${recovery.burnTxId}&amount=0&from=Ethereum_Sepolia&to=Arc_Testnet`,
    `?tx=${recovery.burnTxId}&amount=10&from=Ethereum_Sepolia&to=Ethereum_Sepolia`,
    `?tx=${recovery.burnTxId}&amount=10&from=Ethereum&to=Arc_Testnet`,
    `?tx=${recovery.burnTxId}&amount=10&from=Sui_Testnet&to=Arc_Testnet`
  ])("rejects invalid recovery state %s", (search) => {
    expect(parseBridgeRecovery(search)).toBeUndefined();
  });

  it("validates transaction identifiers against the source chain family", () => {
    const solanaSignature = "3".repeat(88);
    expect(isBridgeTransactionId("Solana_Devnet", solanaSignature)).toBe(true);
    expect(isBridgeTransactionId("Solana_Devnet", recovery.burnTxId)).toBe(false);
    expect(isBridgeTransactionId("Ethereum_Sepolia", recovery.burnTxId)).toBe(true);
    expect(isBridgeTransactionId("Ethereum_Sepolia", solanaSignature)).toBe(false);
  });

  it("round-trips Solana recovery without changing the case-sensitive signature", () => {
    const solanaRecovery: BridgeRecovery = {
      amount: "1.25",
      burnTxId: "4Nd1mV6P9sc3qMgbSKoJbKFeQmuYwS9kB8uYQZ1u7BqJkF6mT8z2nR5cV9pL3dH7aX4sW8eC2gF6jK9mN1qP3rT5",
      route: { source: "Solana_Devnet", destination: "Arc_Testnet" }
    };
    expect(parseBridgeRecovery(buildBridgeRecoverySearch(solanaRecovery))).toEqual(solanaRecovery);
  });

  it("binds recovery to the exact amount and route", () => {
    expect(recoveryMatchesIntent(recovery, recovery.route, "10")).toBe(true);
    expect(recoveryMatchesIntent(recovery, recovery.route, "9")).toBe(false);
    expect(
      recoveryMatchesIntent(
        recovery,
        { source: "Base_Sepolia", destination: "Arc_Testnet" },
        "10"
      )
    ).toBe(false);
  });

  it("accepts only a decoded Standard CCTP V2 burn to the connected Arc recipient", () => {
    const recipient = "0x1111111111111111111111111111111111111111";
    const payload = {
      sourceTxHash: recovery.burnTxId.toUpperCase().replace("0X", "0x"),
      messages: [
        {
          cctpVersion: 2,
          decodedMessage: {
            sourceDomain: "0",
            destinationDomain: "26",
            destinationCaller: `0x${"0".repeat(64)}`,
            minFinalityThreshold: "2000",
            decodedMessageBody: {
              mintRecipient: recipient,
              amount: "10000000"
            }
          }
        }
      ]
    };
    expect(() => assertBridgeRecoveryMessage(recovery, recipient, payload)).not.toThrow();
  });

  it.each([
    ["destination domain", { destinationDomain: "0" }],
    ["recipient", { decodedMessageBody: { mintRecipient: "0x2222222222222222222222222222222222222222", amount: "10000000" } }],
    ["amount", { decodedMessageBody: { mintRecipient: "0x1111111111111111111111111111111111111111", amount: "9999999" } }],
    ["finality", { minFinalityThreshold: "1000" }]
  ])("rejects a recovery with a mismatched %s", (_name, override) => {
    const decodedMessage = {
      sourceDomain: "0",
      destinationDomain: "26",
      destinationCaller: `0x${"0".repeat(64)}`,
      minFinalityThreshold: "2000",
      decodedMessageBody: {
        mintRecipient: "0x1111111111111111111111111111111111111111",
        amount: "10000000"
      },
      ...override
    };
    expect(() =>
      assertBridgeRecoveryMessage(recovery, "0x1111111111111111111111111111111111111111", {
        sourceTxHash: recovery.burnTxId,
        messages: [{ cctpVersion: 2, decodedMessage }]
      })
    ).toThrow("Recovery safety check");
  });
});
