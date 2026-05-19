import {
  assertMethod,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import { HttpError } from "../server/http.js";
import { getOpenOrdersForMarket } from "../server/markets/repo.js";

/**
 * GET /api/markets-orderbook?marketId=<uuid>&outcome=0|1
 *
 * Returns aggregated bid/ask depth for one outcome on one market. Used by
 * the trade-panel chart and depth list. Aggregation is by price level —
 * sums remaining (`size - filled`) across all orders at the same price.
 *
 * Returned arrays:
 *   bids: BUY side — buyers want shares; sorted by price descending.
 *   asks: SELL side — sellers offering shares; sorted by price ascending.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    const marketId = readQueryString(request, "marketId");
    const outcomeRaw = readQueryString(request, "outcome");
    if (!marketId) {
      throw new HttpError(400, "Provide marketId");
    }
    if (outcomeRaw !== "0" && outcomeRaw !== "1") {
      throw new HttpError(400, "Provide outcome=0 (NO) or outcome=1 (YES)");
    }
    const outcome = (outcomeRaw === "1" ? 1 : 0) as 0 | 1;

    const open = await getOpenOrdersForMarket(marketId, outcome);

    // Aggregate by price level. side: 0 = BUY (bids), 1 = SELL (asks).
    const bidLevels = new Map<string, bigint>();
    const askLevels = new Map<string, bigint>();
    for (const o of open) {
      const remaining = o.size - o.filled;
      if (remaining <= 0n) continue;
      const map = o.side === 0 ? bidLevels : askLevels;
      const key = o.price.toString();
      map.set(key, (map.get(key) ?? 0n) + remaining);
    }

    const bids = Array.from(bidLevels.entries())
      .map(([price, size]) => ({ price, size: size.toString() }))
      .sort((a, b) => Number(BigInt(b.price) - BigInt(a.price)));
    const asks = Array.from(askLevels.entries())
      .map(([price, size]) => ({ price, size: size.toString() }))
      .sort((a, b) => Number(BigInt(a.price) - BigInt(b.price)));

    sendJson(response, 200, { marketId, outcome, bids, asks });
  } catch (error) {
    sendError(response, error);
  }
}
