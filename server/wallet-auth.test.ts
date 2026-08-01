import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient } from "../src/lib/arc.js";
import { buildInboxAccessTypedData } from "../src/lib/ids.js";
import {
  MAX_WALLET_SIGNATURE_BYTES,
  MIN_WALLET_SIGNATURE_BYTES,
  readWalletSignature,
  verifyWalletTypedData
} from "./wallet-auth.js";

describe("wallet authorization helpers", () => {
  it("accepts bounded opaque smart-account signatures", () => {
    expect(readWalletSignature(`0x${"ab".repeat(MIN_WALLET_SIGNATURE_BYTES)}`)).toHaveLength(
      2 + MIN_WALLET_SIGNATURE_BYTES * 2
    );
    expect(readWalletSignature(`0x${"cd".repeat(MAX_WALLET_SIGNATURE_BYTES)}`)).toHaveLength(
      2 + MAX_WALLET_SIGNATURE_BYTES * 2
    );
  });

  it("rejects truncated, oversized, odd-length, and non-hex signatures", () => {
    for (const value of [
      `0x${"ab".repeat(MIN_WALLET_SIGNATURE_BYTES - 1)}`,
      `0x${"ab".repeat(MAX_WALLET_SIGNATURE_BYTES + 1)}`,
      `0x${"a".repeat(MIN_WALLET_SIGNATURE_BYTES * 2 + 1)}`,
      `0x${"zz".repeat(MIN_WALLET_SIGNATURE_BYTES)}`
    ]) {
      expect(() => readWalletSignature(value)).toThrow();
    }
  });

  it("verifies ordinary EOA typed signatures without changing the payload", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const typedData = buildInboxAccessTypedData({
      wallet: account.address,
      expiresAt: 1_900_000_000n
    });
    const signature = await account.signTypedData(typedData);

    await expect(
      verifyWalletTypedData({
        ...typedData,
        address: account.address,
        signature
      })
    ).resolves.toBe(true);
  });

  it("falls back to the on-chain verifier for an opaque smart-account signature", async () => {
    const account = privateKeyToAccount(`0x${"2".repeat(64)}`);
    const typedData = buildInboxAccessTypedData({
      wallet: account.address,
      expiresAt: 1_900_000_000n
    });
    const onchain = vi.spyOn(publicClient, "verifyTypedData").mockResolvedValueOnce(true);

    await expect(
      verifyWalletTypedData({
        ...typedData,
        address: account.address,
        signature: `0x${"ab".repeat(96)}`
      })
    ).resolves.toBe(true);
    expect(onchain).toHaveBeenCalledOnce();
  });
});
