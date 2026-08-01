import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient } from "../src/lib/arc.js";
import {
  assertSafeWebhookUrl,
  authorizeWebhookAction,
  buildWebhookAuthorizationTypedData,
  buildPspWebhookPayload,
  isPublicIpAddress,
  matchesWebhookRecipient,
  readPspRecipient,
  signWebhookPayload
} from "./webhooks";

vi.spyOn(publicClient, "verifyTypedData").mockResolvedValue(false);

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
    expect(matchesWebhookRecipient({}, psp)).toBe(false);
  });

  it("signs the exact JSON payload with HMAC-SHA256", () => {
    const payload = JSON.stringify(buildPspWebhookPayload(psp, new Date("2026-05-17T00:00:00.000Z")));
    const secret = "test-secret";

    expect(signWebhookPayload(payload, secret)).toBe(
      createHmac("sha256", secret).update(payload).digest("hex")
    );
  });

  it("binds webhook creation authorization to the owner and exact payload", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 120);
    const secret = "s".repeat(32);
    const url = "https://hooks.example.test/";
    const typedData = buildWebhookAuthorizationTypedData({
      wallet: account.address,
      action: "create",
      expiresAt,
      url,
      recipient: account.address,
      events: ["psp.issued"],
      secret
    });
    const signature = await account.signTypedData(typedData);

    await expect(
      authorizeWebhookAction(
        { wallet: account.address, expiresAt: expiresAt.toString(), signature },
        "create",
        { url, recipient: account.address, events: ["psp.issued"], secret }
      )
    ).resolves.toMatchObject({
      wallet: account.address,
      url,
      recipient: account.address,
      authorizationDigest: hashTypedData(typedData)
    });

    await expect(
      authorizeWebhookAction(
        { wallet: account.address, expiresAt: expiresAt.toString(), signature },
        "create",
        { url: "https://attacker.example/", recipient: account.address, events: ["psp.issued"], secret }
      )
    ).rejects.toThrow("does not match");
  });

  it("rejects private literal and private DNS webhook destinations", async () => {
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("198.51.100.12")).toBe(false);
    expect(isPublicIpAddress("203.0.113.4")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("64:ff9b::7f00:1")).toBe(false);
    expect(isPublicIpAddress("0:0:0:0:0:ffff:7f00:1")).toBe(false);
    expect(isPublicIpAddress("fec0::1")).toBe(false);
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);

    await expect(assertSafeWebhookUrl("https://127.0.0.1/hook")).rejects.toThrow("private");
    await expect(assertSafeWebhookUrl("https://[64:ff9b::7f00:1]/hook")).rejects.toThrow("private");
    await expect(
      assertSafeWebhookUrl("https://hooks.example.test/", async () => [{ address: "10.0.0.8", family: 4 }])
    ).rejects.toThrow("public internet");
    await expect(
      assertSafeWebhookUrl("https://hooks.example.test/", async () => [
        { address: "93.184.216.34", family: 4 }
      ])
    ).resolves.toBe("https://hooks.example.test/");
  });
});
