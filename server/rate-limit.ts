import { createHash } from "node:crypto";
import { createClient } from "@redis/client";
import { HttpError } from "./http.js";

export type RedisRateLimitScope =
  | "direct_register"
  | "history"
  | "notifications"
  | "qr_create"
  | "statements"
  | "webhook_management";

const LIMITS: Record<RedisRateLimitScope, { requests: number; windowSeconds: number }> = {
  direct_register: { requests: 30, windowSeconds: 60 },
  history: { requests: 30, windowSeconds: 60 },
  notifications: { requests: 60, windowSeconds: 60 },
  qr_create: { requests: 12, windowSeconds: 60 },
  statements: { requests: 12, windowSeconds: 60 },
  webhook_management: { requests: 30, windowSeconds: 60 }
};

const FIXED_WINDOW_SCRIPT = [
  "local current = redis.call('INCR', KEYS[1])",
  "if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
  "return current"
].join("; ");

type StandardRedisClient = {
  connect: () => Promise<unknown>;
  eval: (
    script: string,
    options: { keys: string[]; arguments: string[] }
  ) => Promise<unknown>;
  on: (event: "error", listener: (error: unknown) => void) => unknown;
};

let standardRedisConnection:
  | { url: string; client: StandardRedisClient; ready: Promise<StandardRedisClient> }
  | undefined;

/**
 * Optional serverless Redis abuse control. Redis never stores payment data and
 * is never authoritative for payment/replay state; PostgreSQL constraints and
 * atomic RPCs remain the safety boundary. Network timeouts fail open so a
 * cache outage cannot strand a payment, while invalid configured credentials
 * fail loudly as an operator error.
 */
export async function enforceRedisRateLimit(
  scope: RedisRateLimitScope,
  identifier: string
): Promise<void> {
  const standardUrl = process.env.REDIS_URL?.trim();
  const restUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!standardUrl && !restUrl && !restToken) {
    return;
  }
  if (standardUrl && (restUrl || restToken)) {
    throw new HttpError(503, "Redis rate limiting is misconfigured.");
  }

  const limit = LIMITS[scope];
  const key = `disburse:ratelimit:${scope}:${hashIdentifier(identifier)}`;
  const count = standardUrl
    ? await incrementStandardRedisCounter(standardUrl, key, limit.windowSeconds)
    : await incrementUpstashCounter(restUrl, restToken, key, limit.windowSeconds);

  if (count !== undefined && count > limit.requests) {
    throw new HttpError(429, "Too many requests. Try again shortly.");
  }
}

async function incrementUpstashCounter(
  url: string | undefined,
  token: string | undefined,
  key: string,
  windowSeconds: number
): Promise<number | undefined> {
  if (!url || !token) {
    throw new HttpError(503, "Redis rate limiting is misconfigured.");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw new HttpError(503, "Redis rate limiting is misconfigured.");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new HttpError(503, "Redis rate limiting is misconfigured.");
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify([
        "EVAL",
        FIXED_WINDOW_SCRIPT,
        1,
        key,
        windowSeconds
      ]),
      signal: AbortSignal.timeout(750)
    });
  } catch {
    return;
  }

  if (!response.ok) {
    throw new HttpError(503, "Redis rate limiting is temporarily unavailable.");
  }
  const payload = await response.json().catch(() => undefined) as
    | { result?: unknown; error?: unknown }
    | undefined;
  if (!payload || typeof payload.result !== "number" || payload.error) {
    throw new HttpError(503, "Redis rate limiting returned an invalid response.");
  }
  return payload.result;
}

async function incrementStandardRedisCounter(
  rawUrl: string,
  key: string,
  windowSeconds: number
): Promise<number | undefined> {
  const url = validateStandardRedisUrl(rawUrl);
  try {
    const client = await getStandardRedisClient(url);
    const result = await client.eval(FIXED_WINDOW_SCRIPT, {
      keys: [key],
      arguments: [String(windowSeconds)]
    });
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 1) {
      throw new HttpError(503, "Redis rate limiting returned an invalid response.");
    }
    return result;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (isTransientRedisError(error)) {
      // Redis only limits abuse. PostgreSQL remains authoritative, so a brief
      // cache outage must not strand an otherwise valid payment.
      return undefined;
    }
    throw new HttpError(503, "Redis rate limiting is temporarily unavailable.");
  }
}

function validateStandardRedisUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(503, "Redis rate limiting is misconfigured.");
  }
  if (
    !["redis:", "rediss:"].includes(url.protocol)
    || !url.hostname
    || !url.password
    || url.search
    || url.hash
    || (url.pathname !== "" && url.pathname !== "/" && !/^\/\d+$/.test(url.pathname))
  ) {
    throw new HttpError(503, "Redis rate limiting is misconfigured.");
  }
  return url.toString();
}

async function getStandardRedisClient(url: string): Promise<StandardRedisClient> {
  if (standardRedisConnection && standardRedisConnection.url !== url) {
    throw new HttpError(503, "Redis rate limiting is misconfigured.");
  }
  if (!standardRedisConnection) {
    const client: StandardRedisClient = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 750,
        reconnectStrategy: false
      }
    });
    // The caller handles command/connect failures. Registering an error
    // listener prevents Node from treating a socket error as unhandled.
    client.on("error", () => undefined);
    const ready = client.connect().then(() => client);
    standardRedisConnection = { url, client, ready };
    ready.catch(() => {
      if (standardRedisConnection?.ready === ready) {
        standardRedisConnection = undefined;
      }
    });
  }
  const connection = standardRedisConnection;
  if (!connection) {
    throw new HttpError(503, "Redis rate limiting is temporarily unavailable.");
  }
  return connection.ready;
}

function isTransientRedisError(error: unknown): boolean {
  const record = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : undefined;
  const code = typeof record?.code === "string" ? record.code.toUpperCase() : "";
  const message = typeof record?.message === "string" ? record.message.toLowerCase() : "";
  return [
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "ETIMEDOUT"
  ].includes(code) || message.includes("socket closed") || message.includes("timeout");
}

function hashIdentifier(identifier: string): string {
  return createHash("sha256")
    .update(identifier.trim().toLowerCase(), "utf8")
    .digest("hex");
}
