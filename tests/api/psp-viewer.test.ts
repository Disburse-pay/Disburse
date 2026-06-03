import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResponse } from "../../server/http";
import handler from "../../api-handlers/psp-viewer.js";

const pspStore = vi.hoisted(() => ({
  readPspByUid: vi.fn()
}));

vi.mock("../../server/psp/issue.js", () => ({
  readPspByUid: pspStore.readPspByUid
}));

const uid = "psp:abcdef1234567890";
const psp = {
  version: 1,
  networkMode: "testnet",
  issuer: {
    name: "Disburse",
    url: "https://disburse.app",
    publicKey: "0x1111111111111111111111111111111111111111"
  },
  invoice: {
    requestId: "7e7b5b2f-9df1-4ea1-a0da-0889fb6bd4fd",
    label: "Invoice 7421",
    payer: "0x2222222222222222222222222222222222222222",
    recipient: "0x3333333333333333333333333333333333333333",
    token: "USDC",
    amount: "12.34"
  },
  settlement: {
    chainId: 5_042_002,
    txHash: `0x${"a".repeat(64)}`,
    blockNumber: "12345",
    settledAt: "2026-05-17T00:00:00.000Z",
    settlementEvent: {
      contract: "0x4444444444444444444444444444444444444444",
      settlementId: `0x${"b".repeat(64)}`,
      eventTopic: `0x${"c".repeat(64)}`,
      logIndex: 1
    }
  },
  digest: `0x${"d".repeat(64)}`,
  signature: {
    alg: "secp256k1-keccak256",
    value: `0x${"e".repeat(130)}`
  },
  uid,
  createdAt: "2026-05-17T00:00:01.000Z"
};

describe("/api/psp-viewer", () => {
  beforeEach(() => {
    pspStore.readPspByUid.mockReset();
  });

  it("serves the proof viewer as raw HTML", async () => {
    pspStore.readPspByUid.mockResolvedValue(psp);
    const response = createResponse();

    await handler({ method: "GET", query: { uid } }, response.api);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.body).toContain("<!DOCTYPE html>");
    expect(response.body).toContain("npx @disburse/psp-verify");
  });

  it("uses the canonical public origin and never leaks the Vercel deploy URL", async () => {
    pspStore.readPspByUid.mockResolvedValue(psp);
    const previous = process.env.VERCEL_URL;
    process.env.VERCEL_URL = "disburse-owu67xj9c-firdans-projects.vercel.app";
    try {
      const response = createResponse();

      await handler({ method: "GET", query: { uid } }, response.api);

      expect(response.body).toContain(`https://app.disburse.online/api/psp?uid=${uid}`);
      expect(response.body).not.toContain("vercel.app");
    } finally {
      if (previous === undefined) {
        delete process.env.VERCEL_URL;
      } else {
        process.env.VERCEL_URL = previous;
      }
    }
  });
});

function createResponse() {
  const state: {
    statusCode?: number;
    body?: string;
    headers: Record<string, string>;
    api: ApiResponse;
  } = {
    headers: {},
    api: undefined as unknown as ApiResponse
  };

  state.api = {
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return state.api;
    }),
    json: vi.fn((body: unknown) => {
      state.body = JSON.stringify(body);
    }),
    send: vi.fn((body: unknown) => {
      state.body = String(body);
    }),
    setHeader: vi.fn((name: string, value: string) => {
      state.headers[name.toLowerCase()] = value;
    })
  };

  return state;
}
