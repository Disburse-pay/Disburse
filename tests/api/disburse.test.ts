import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildDisburseAuthorizationMessage,
  directRequestIdFromTxHash
} from "../../api-handlers/disburse.js";

const txHash = `0x${"a".repeat(64)}` as const;

describe("/api/disburse helpers", () => {
  it("derives stable UUID request ids from direct tx hashes", () => {
    const first = directRequestIdFromTxHash(txHash);
    const second = directRequestIdFromTxHash(txHash.toUpperCase() as `0x${string}`);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("builds the exact payer authorization payload signed by the CLI", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const message = buildDisburseAuthorizationMessage({
      txHash,
      token: "USDC",
      recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA4c",
      amount: "25",
      label: "Invoice 1",
      note: "Subscription"
    });
    const signature = await account.signMessage({ message });

    expect(message).toBe([
      "Disburse direct PSP registration",
      `txHash: ${txHash}`,
      "token: USDC",
      "recipient: 0x742d35cc6634c0532925a3b844bc9e7595f8fa4c",
      "amount: 25",
      "label: Invoice 1",
      "note: Subscription"
    ].join("\n"));
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
