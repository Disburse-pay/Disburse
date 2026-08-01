import { describe, expect, it } from "vitest";
import { buildShareUrl, decodeRequestReference, validateRecipient, type PaymentRequest } from "./payments";
import { buildQrDataUrl } from "./qr";

const request: PaymentRequest = {
  id: "req_qr_001",
  requestToken: "capability_token_abcdefghijklmnopqrstuvwxyz_123456",
  recipient: validateRecipient("0x1111111111111111111111111111111111111111"),
  token: "USDC",
  amount: "10",
  label: "Invoice 2",
  note: "Food and Drink",
  invoiceDate: "2026-04-29",
  expiresAt: "2026-04-29T10:15:00.000Z",
  createdAt: "2026-04-29T10:00:00.000Z",
  startBlock: "700",
  status: "open"
};

describe("QR payment links", () => {
  it("generates a QR data URL for a fixed request payload", async () => {
    const shareUrl = buildShareUrl(request, "https://desk.example");
    const dataUrl = await buildQrDataUrl(shareUrl);

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);

    const encoded = new URL(shareUrl).searchParams.get("r");
    expect(encoded).toBeTruthy();
    expect(decodeRequestReference(encoded ?? "")).toEqual({
      version: 3,
      id: request.id,
      requestToken: request.requestToken
    });
  });
});
