import { describe, expect, it } from "vitest";
import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildDisburseRegistrationTypedData,
  directRequestIdFromTxHash
} from "../../api-handlers/disburse.js";

const txHash = `0x${"a".repeat(64)}` as const;
const recipient = "0x742d35cc6634c0532925a3b844bc9e7595f8fa4c" as const;

describe("/api/disburse helpers", () => {
  it("derives stable UUID request ids from direct tx hashes", () => {
    const first = directRequestIdFromTxHash(txHash);
    const second = directRequestIdFromTxHash(txHash.toUpperCase() as `0x${string}`);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("signs and verifies the EIP-712 registration payload, rejecting foreign domains", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const typedData = buildDisburseRegistrationTypedData({
      txHash,
      token: "USDC",
      recipient,
      amount: "25",
      label: "Invoice 1",
      note: "Subscription"
    });
    const signature = await account.signTypedData(typedData);

    await expect(verifyTypedData({ ...typedData, address: account.address, signature })).resolves.toBe(true);

    const foreignSignature = await account.signTypedData({
      ...typedData,
      domain: { ...typedData.domain, chainId: 1 }
    });
    await expect(
      verifyTypedData({ ...typedData, address: account.address, signature: foreignSignature })
    ).resolves.toBe(false);
  });

  it("binds invoiceDate into the EIP-712 registration authorization", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const typedData = buildDisburseRegistrationTypedData({
      txHash,
      token: "USDC",
      recipient,
      amount: "25",
      label: "Invoice 1",
      note: "Subscription",
      invoiceDate: "2026-07-29"
    });
    const signature = await account.signTypedData(typedData);

    await expect(verifyTypedData({ ...typedData, address: account.address, signature })).resolves.toBe(true);
    await expect(
      verifyTypedData({
        ...typedData,
        message: { ...typedData.message, invoiceDate: "2026-07-30" },
        address: account.address,
        signature
      })
    ).resolves.toBe(false);
  });

  it("binds the direct versus Gateway rail into the registration authorization", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const direct = buildDisburseRegistrationTypedData({
      txHash,
      rail: "direct",
      token: "USDC",
      recipient,
      amount: "25",
      label: "Invoice 1"
    });
    const signature = await account.signTypedData(direct);
    const gateway = buildDisburseRegistrationTypedData({
      ...direct.message,
      rail: "gateway"
    });

    await expect(
      verifyTypedData({ ...gateway, address: account.address, signature })
    ).resolves.toBe(false);
  });

  it("rejects the legacy registration schema that omitted invoiceDate", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const current = buildDisburseRegistrationTypedData({
      txHash,
      token: "USDC",
      recipient,
      amount: "25",
      label: "Invoice 1",
      note: "Subscription"
    });
    const legacySignature = await account.signTypedData({
      domain: current.domain,
      types: {
        DirectPspRegistration: [
          { name: "txHash", type: "bytes32" },
          { name: "token", type: "string" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "string" },
          { name: "label", type: "string" },
          { name: "note", type: "string" }
        ]
      },
      primaryType: "DirectPspRegistration",
      message: {
        txHash,
        token: "USDC",
        recipient,
        amount: "25",
        label: "Invoice 1",
        note: "Subscription"
      }
    });

    await expect(
      verifyTypedData({ ...current, address: account.address, signature: legacySignature })
    ).resolves.toBe(false);
  });
});
