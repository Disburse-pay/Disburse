import { sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { HttpError } from "../server/http.js";
import { getPoolSnapshotHistory } from "../server/lending/repo.js";
import { toIntString } from "../server/lending/wire.js";

/**
 * GET /api/lending-tvl-history?window=1d|7d|30d|all
 *
 * Returns timestamped TVL points for the requested window. TVL is computed
 * as `cash_usdc + total_borrows_usdc` from each pool snapshot (USDC at 6
 * decimals, returned as plain integer strings so the client can read with
 * BigInt).
 *
 * Points are downsampled server-side to keep the wire light — the chart
 * doesn't need 5-minute granularity over 30 days.
 */
const WINDOWS: Record<string, number> = {
  "1d": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
  all: 24 * 365 * 5,
};

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const windowParam = (request.query?.window as string | undefined) ?? "7d";
    const windowHours = WINDOWS[windowParam];
    if (!windowHours) {
      throw new HttpError(400, `Unknown window: ${windowParam}. Use 1d, 7d, 30d, or all.`);
    }
    const rows = await getPoolSnapshotHistory({ windowHours });
    const points = rows.map((r) => {
      const cash = BigInt(toIntString(r.cash_usdc));
      const borrows = BigInt(toIntString(r.total_borrows_usdc));
      return { t: r.observed_at, tvl: (cash + borrows).toString() };
    });
    sendJson(response, 200, { window: windowParam, points });
  } catch (error) {
    sendError(response, error);
  }
}
