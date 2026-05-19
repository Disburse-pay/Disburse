import {
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import { HttpError } from "../server/http.js";
import { expireOpenOrders } from "../server/markets/repo.js";

/**
 * GET/POST /api/markets-expire-orders
 *
 * Cron/admin endpoint that marks stale open/partial orders as expired once
 * their EIP-712 expiry timestamp has passed. The Exchange rejects expired
 * orders on-chain; this keeps the off-chain orderbook from advertising them.
 */
export default async function handler(
  request: ApiRequest & { headers?: Record<string, string | string[] | undefined> },
  response: ApiResponse
) {
  try {
    if (request.method !== "GET" && request.method !== "POST") {
      throw new HttpError(405, "Method not allowed.");
    }
    assertCronAuth(request);

    const expiredCount = await expireOpenOrders();
    sendJson(response, 200, {
      expiredCount,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    sendError(response, error);
  }
}

function assertCronAuth(
  request: ApiRequest & { headers?: Record<string, string | string[] | undefined> }
) {
  const cronSecret = process.env.CRON_SECRET;
  const adminKey = process.env.ADMIN_API_KEY;
  if (!cronSecret && !adminKey) {
    throw new HttpError(503, "CRON_SECRET or ADMIN_API_KEY is not configured");
  }

  const auth = readHeader(request, "authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    return;
  }

  const adminHeader = readHeader(request, "x-admin-key");
  if (adminKey && adminHeader === adminKey) {
    return;
  }

  throw new HttpError(401, "Invalid cron credentials");
}

function readHeader(
  request: ApiRequest & { headers?: Record<string, string | string[] | undefined> },
  name: string
): string | undefined {
  const headers = request.headers ?? {};
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === lowerName
  );
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : value;
}

