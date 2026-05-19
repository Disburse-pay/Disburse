import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResponse } from "../../server/http";
import handler from "../../api-handlers/markets-expire-orders.js";

const repo = vi.hoisted(() => ({
  expireOpenOrders: vi.fn(),
}));

vi.mock("../../server/markets/repo.js", () => ({
  expireOpenOrders: repo.expireOpenOrders,
}));

describe("/api/markets-expire-orders", () => {
  beforeEach(() => {
    repo.expireOpenOrders.mockReset();
    repo.expireOpenOrders.mockResolvedValue(3);
    process.env.CRON_SECRET = "cron-secret";
    process.env.ADMIN_API_KEY = "admin-secret";
  });

  it("expires orders when called with cron bearer credentials", async () => {
    const response = createResponse();

    await handler(
      {
        method: "GET",
        query: {},
        headers: { authorization: "Bearer cron-secret" },
      },
      response.api
    );

    expect(repo.expireOpenOrders).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ expiredCount: 3 });
  });

  it("accepts the admin key for manual runs", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        query: {},
        headers: { "x-admin-key": "admin-secret" },
      },
      response.api
    );

    expect(response.statusCode).toBe(200);
  });

  it("rejects missing credentials", async () => {
    const response = createResponse();

    await handler({ method: "GET", query: {}, headers: {} }, response.api);

    expect(response.statusCode).toBe(401);
    expect(repo.expireOpenOrders).not.toHaveBeenCalled();
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
    api: undefined as unknown as ApiResponse,
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
    }),
  };

  return state;
}
