import { afterEach, describe, expect, it, vi } from "vitest";

const standardRedisMocks = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  eval: vi.fn(),
  on: vi.fn()
}));

vi.mock("@redis/client", () => ({
  createClient: vi.fn(() => standardRedisMocks)
}));

import { enforceRedisRateLimit } from "./rate-limit";

const previousStandardUrl = process.env.REDIS_URL;
const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
  standardRedisMocks.eval.mockReset();
  if (previousStandardUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previousStandardUrl;
  if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
  if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
});

describe("optional Redis rate limiting", () => {
  it("is dormant when Redis is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(enforceRedisRateLimit("history", "0x1111")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only a hashed identifier and rejects counters over the route limit", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "server-secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 31 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      enforceRedisRateLimit("history", "0x1111111111111111111111111111111111111111")
    ).rejects.toMatchObject({ statusCode: 429 });

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(init.body)).not.toContain("0x1111111111111111111111111111111111111111");
    expect(init.headers).toMatchObject({ authorization: "Bearer server-secret" });
  });

  it("fails open on a network timeout but fails closed on partial configuration", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "server-secret";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(enforceRedisRateLimit("qr_create", "wallet")).resolves.toBeUndefined();

    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    await expect(enforceRedisRateLimit("qr_create", "wallet")).rejects.toMatchObject({
      statusCode: 503
    });
  });

  it("uses a standard Redis URL without sending the unhashed identifier", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.REDIS_URL = "redis://default:server-secret@example.redis.cloud:6379";
    standardRedisMocks.eval.mockResolvedValue(1);

    await expect(
      enforceRedisRateLimit("history", "0x1111111111111111111111111111111111111111")
    ).resolves.toBeUndefined();

    const [, options] = standardRedisMocks.eval.mock.calls[0] as [string, { keys: string[]; arguments: string[] }];
    expect(options.keys[0]).toMatch(/^disburse:ratelimit:history:[a-f0-9]{64}$/);
    expect(options.keys[0]).not.toContain("0x1111111111111111111111111111111111111111");
    expect(options.arguments).toEqual(["60"]);
  });

  it("rejects ambiguous or unauthenticated standard Redis configuration", async () => {
    process.env.REDIS_URL = "redis://example.redis.cloud:6379";
    await expect(enforceRedisRateLimit("history", "wallet")).rejects.toMatchObject({ statusCode: 503 });

    process.env.REDIS_URL = "redis://default:secret@example.redis.cloud:6379";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "server-secret";
    await expect(enforceRedisRateLimit("history", "wallet")).rejects.toMatchObject({ statusCode: 503 });
  });
});
