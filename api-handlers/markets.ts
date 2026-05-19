import { assertMethod, readQueryString, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { listMarkets } from "../server/markets/repo.js";
import type { MarketStatus } from "../src/lib/markets/types.js";

/**
 * GET /api/markets[?status=open|closed|resolved]
 *
 * Lists markets. Defaults to all statuses; pass `?status=open` to filter to
 * the trading set. Public — anyone can read the markets registry.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    const statusRaw = readQueryString(request, "status");
    const status =
      statusRaw === "open" || statusRaw === "closed" || statusRaw === "resolved"
        ? (statusRaw as MarketStatus)
        : undefined;

    const markets = await listMarkets({ status });
    sendJson(response, 200, { markets });
  } catch (error) {
    sendError(response, error);
  }
}
