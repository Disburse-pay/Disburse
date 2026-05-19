import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResponse } from "../../server/http";
import handler from "../../api-handlers/psp.js";

const pspStore = vi.hoisted(() => ({
  readPspByUid: vi.fn(),
  readPspByRequestId: vi.fn()
}));

vi.mock("../../server/psp/issue.js", () => ({
  readPspByUid: pspStore.readPspByUid,
  readPspByRequestId: pspStore.readPspByRequestId
}));

const uid = "psp:abcdef1234567890";
const requestId = "7e7b5b2f-9df1-4ea1-a0da-0889fb6bd4fd";
const psp = {
  uid,
  version: 1,
  networkMode: "testnet",
  invoice: { requestId },
  digest: `0x${"a".repeat(64)}`
};

describe("/api/psp", () => {
  beforeEach(() => {
    pspStore.readPspByUid.mockReset();
    pspStore.readPspByRequestId.mockReset();
  });

  it("returns a PSP by immutable uid", async () => {
    pspStore.readPspByUid.mockResolvedValue(psp);
    const response = createResponse();

    await handler({ method: "GET", query: { uid } }, response.api);

    expect(pspStore.readPspByUid).toHaveBeenCalledWith(uid);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.body).toBe(psp);
  });

  it("returns a PSP by request_id without caching", async () => {
    pspStore.readPspByRequestId.mockResolvedValue(psp);
    const response = createResponse();

    await handler({ method: "GET", query: { request_id: requestId } }, response.api);

    expect(pspStore.readPspByRequestId).toHaveBeenCalledWith(requestId);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe(psp);
  });

  it("rejects ambiguous lookup parameters", async () => {
    const response = createResponse();

    await handler({ method: "GET", query: { uid, request_id: requestId } }, response.api);

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ error: "Provide either uid or request_id, not both." });
  });
});

function createResponse() {
  const state: {
    statusCode?: number;
    body?: unknown;
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
      state.body = body;
    }),
    setHeader: vi.fn((name: string, value: string) => {
      state.headers[name.toLowerCase()] = value;
    })
  };

  return state;
}
