import { sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { HttpError } from "../server/http.js";
import { settleStoredCrossChainQrPayments } from "../server/qr.js";

/**
 * GET/POST /api/qr-settle-cron
 *
 * Protected keeper endpoint. Advances cross-chain QR payments that are waiting
 * on a Polymer proof: queries each proof and, once ready, submits settle() on
 * Arc and issues the PSP. Idempotent — safe to call on a short interval. Trigger
 * it from the VPS keeper (scripts/qr-settle-keeper.ts) or a Vercel cron (Pro).
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
    sendJson(response, 200, await settleStoredCrossChainQrPayments());
  } catch (error) {
    sendError(response, error);
  }
}

function assertCronAuth(request: ApiRequest & { headers?: Record<string, string | string[] | undefined> }) {
  const cronSecret = process.env.CRON_SECRET;
  const adminKey = process.env.ADMIN_API_KEY;
  if (!cronSecret && !adminKey) {
    throw new HttpError(503, "CRON_SECRET or ADMIN_API_KEY is not configured");
  }

  const auth = readHeader(request, "authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) return;

  const adminHeader = readHeader(request, "x-admin-key");
  if (adminKey && adminHeader === adminKey) return;

  throw new HttpError(401, "Invalid cron credentials");
}

function readHeader(
  request: ApiRequest & { headers?: Record<string, string | string[] | undefined> },
  name: string
): string | undefined {
  const headers = request.headers ?? {};
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName);
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : value;
}
