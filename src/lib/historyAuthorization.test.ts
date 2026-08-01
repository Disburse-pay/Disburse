import { describe, expect, it } from "vitest";
import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildHistoryAccessTypedData } from "./historyAuthorization";

describe("history access authorization", () => {
  it("binds the wallet, result limit, Arc domain, and expiry", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const typedData = buildHistoryAccessTypedData({
      wallet: account.address,
      limit: 200,
      expiresAt: 1_800_000_000n
    });
    const signature = await account.signTypedData(typedData);

    await expect(verifyTypedData({ ...typedData, address: account.address, signature })).resolves.toBe(true);
    await expect(verifyTypedData({
      ...typedData,
      message: { ...typedData.message, limit: 500n },
      address: account.address,
      signature
    })).resolves.toBe(false);
  });
});
