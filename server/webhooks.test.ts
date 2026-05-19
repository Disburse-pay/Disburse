import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildPspWebhookPayload,
  matchesWebhookRecipient,
  readPspRecipient,
  signWebhookPayload
} from "./webhooks";

const recipient = "0x1111111111111111111111111111111111111111";
const payer = "0x2222222222222222222222222222222222222222";

const psp = {
  uid: "psp:abcdef1234567890",
  networkMode: "testnet",
  invoice: {
    requestId: "7e7b5b2f-9df1-4ea1-a0da-0889fb6bd4fd",
    payer,
    recipient,
    token: "USDC",
    amount: "12.34"
  },
  digest: `0x${"a".repeat(64)}`
};

describe("PSP webhooks", () => {
  it("wraps the full PSP in a psp.issued delivery payload", () => {
    const payload = buildPspWebhookPayload(psp, new Date("2026-05-17T00:00:00.000Z"));

    expect(payload).toMatchObject({
      event: "psp.issued",
      uid: psp.uid,
      requestId: psp.invoice.requestId,
      networkMode: "testnet",
      createdAt: "2026-05-17T00:00:00.000Z",
      psp
    });
  });

  it("filters recipient-specific webhooks against the PSP invoice recipient", () => {
    expect(readPspRecipient(psp)).toBe(recipient);
    expect(matchesWebhookRecipient({ recipient }, psp)).toBe(true);
    expect(matchesWebhookRecipient({ recipient: payer }, psp)).toBe(false);
    expect(matchesWebhookRecipient({}, psp)).toBe(true);
  });

  it("signs the exact JSON payload with HMAC-SHA256", () => {
    const payload = JSON.stringify(buildPspWebhookPayload(psp, new Date("2026-05-17T00:00:00.000Z")));
    const secret = "test-secret";

    expect(signWebhookPayload(payload, secret)).toBe(
      createHmac("sha256", secret).update(payload).digest("hex")
    );
  });
});
