import {
  assertMethod,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import {
  getMarketById,
  getOpenOrdersForMarket,
} from "../server/markets/repo.js";
import { HttpError } from "../server/http.js";

/**
 * GET /api/markets-detail?id=<uuid>
 *
 * Returns the market row plus a snapshot of the open orderbook
 * (orders with status open/partial). The frontend uses this for the
 * market-detail page; refreshes come via Supabase realtime channels.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    const id = readQueryString(request, "id");
    if (!id) {
      throw new HttpError(400, "Provide a market id via ?id=<uuid>");
    }

    const market = await getMarketById(id);
    if (!market) {
      throw new HttpError(404, `Market ${id} not found`);
    }

    const orders = await getOpenOrdersForMarket(id);

    // Serialize bigints as decimal strings for JSON safety.
    // Salt + signature are shipped to the client so any taker can rebuild the
    // Order tuple and call Exchange.fillOrder. EIP-712 signatures are public
    // by design — a maker posts them publicly to invite fills.
    const orderbook = orders.map((o) => ({
      hash: o.hash,
      maker: o.maker,
      outcome: o.outcome,
      side: o.side,
      price: o.price.toString(),
      size: o.size.toString(),
      filled: o.filled.toString(),
      expiry: o.expiry,
      salt: o.salt.toString(),
      signature: o.signature,
      status: o.status,
      createdAt: o.createdAt,
    }));

    sendJson(response, 200, { market, orderbook });
  } catch (error) {
    sendError(response, error);
  }
}
