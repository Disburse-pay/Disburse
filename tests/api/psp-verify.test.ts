import { beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import handler from "../../api-handlers/psp-verify.js";
import type { ApiResponse } from "../../server/http.js";
import { buildSignedPsp } from "../../src/lib/psp/sign.js";
import type { PspV1 } from "../../src/lib/psp/types.js";

describe("POST /api/psp/verify", () => {
  let psp: PspV1;
  let trustedIssuer: `0x${string}`;

  beforeAll(async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    trustedIssuer = account.address;
    psp = await buildSignedPsp(
      {
        version: 1,
        networkMode: "testnet",
        issuer: {
          name: "Test issuer",
          url: "https://issuer.example",
          publicKey: account.address,
        },
        invoice: {
          requestId: "request-1",
          label: "Invoice",
          payer: "0x1111111111111111111111111111111111111111",
          recipient: "0x2222222222222222222222222222222222222222",
          token: "USDC",
          amount: "10.00",
        },
        settlement: {
          chainId: 5_042_002,
          txHash: `0x${"a".repeat(64)}`,
          blockNumber: "123",
          settledAt: "2026-07-29T00:00:00.000Z",
          settlementEvent: {
            contract: "0x3333333333333333333333333333333333333333",
            settlementId: `0x${"b".repeat(64)}`,
            eventTopic: `0x${"c".repeat(64)}`,
            logIndex: 0,
          },
        },
      },
      privateKey
    );
  });

  it("requires one independently supplied issuer", async () => {
    const response = createResponse();

    await handler({ method: "POST", body: psp }, response.api);

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: expect.stringContaining("issuer"),
    });
  });

  it("rejects repeated issuer query values", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        query: { issuer: [trustedIssuer, trustedIssuer] },
        body: psp,
      },
      response.api
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: expect.stringContaining("exactly once"),
    });
  });

  it("rejects a malformed or zero issuer", async () => {
    for (const issuer of [
      "not-an-address",
      "0x0000000000000000000000000000000000000000",
    ]) {
      const response = createResponse();
      await handler(
        { method: "POST", query: { issuer }, body: psp },
        response.api
      );
      expect(response.statusCode).toBe(400);
    }
  });

  it("returns valid only for the supplied trusted issuer", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        query: { issuer: trustedIssuer },
        body: psp,
      },
      response.api
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      trust: "trusted_issuer",
      settlementStatus: "not_checked",
    });
  });

  it("does not accept a self-signed PSP for a different trust root", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        query: {
          issuer: "0x9999999999999999999999999999999999999999",
        },
        body: psp,
      },
      response.api
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      ok: false,
      trust: "not_established",
      reason: expect.stringContaining("Issuer mismatch"),
    });
  });
});

function createResponse() {
  const state: {
    statusCode?: number;
    body?: Record<string, unknown>;
    headers: Record<string, string>;
    api: ApiResponse;
  } = {
    headers: {},
    api: undefined as unknown as ApiResponse,
  };

  state.api = {
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return state.api;
    }),
    json: vi.fn((body: unknown) => {
      state.body = body as Record<string, unknown>;
    }),
    setHeader: vi.fn((name: string, value: string) => {
      state.headers[name.toLowerCase()] = value;
    }),
  };

  return state;
}
