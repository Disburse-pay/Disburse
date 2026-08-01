import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import { describe, expect, it } from "vitest";
import type { PaymentRequest } from "./payments.js";
import { buildQrPaymentAuthorizationTypedData } from "./qrAuthorization.js";

const payer = privateKeyToAccount(`0x${"11".repeat(32)}`);

const request: PaymentRequest = {
  id: "7e7b5b2f-9df1-4ea1-a0da-0889fb6bd4fd",
  recipient: "0x2222222222222222222222222222222222222222",
  token: "USDC",
  amount: "12.34",
  label: "Invoice 7421",
  createdAt: "2026-07-29T00:00:00.000Z",
  expiresAt: "2026-07-29T00:15:00.000Z",
  startBlock: "9001",
  status: "open"
};

describe("QR payment authorization", () => {
  it("binds the payer to the canonical invoice fields", async () => {
    const typedData = buildQrPaymentAuthorizationTypedData(request, payer.address);
    const signature = await payer.signTypedData(typedData);

    await expect(
      verifyTypedData({
        ...typedData,
        address: payer.address,
        signature
      })
    ).resolves.toBe(true);
  });

  it.each([
    ["request id", { ...request, id: "11223344-5566-7788-9900-aabbccddeeff" }],
    ["recipient", { ...request, recipient: "0x3333333333333333333333333333333333333333" as const }],
    ["amount", { ...request, amount: "12.35" }],
    ["start block", { ...request, startBlock: "9002" }],
    ["expiry", { ...request, expiresAt: "2026-07-29T00:16:00.000Z" }]
  ])("rejects a signature after tampering with %s", async (_field, tampered) => {
    const signature = await payer.signTypedData(
      buildQrPaymentAuthorizationTypedData(request, payer.address)
    );

    await expect(
      verifyTypedData({
        ...buildQrPaymentAuthorizationTypedData(tampered, payer.address),
        address: payer.address,
        signature
      })
    ).resolves.toBe(false);
  });
});
