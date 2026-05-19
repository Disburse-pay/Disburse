import {
  assertMethod,
  readJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import { HttpError } from "../server/http.js";
import { getAddress } from "viem";
import {
  assertOrderBounds,
  hashOrder,
  parseWireOrder,
  verifyOrderSignature,
} from "../server/markets/orders.js";
import { getMarketByAddress, insertOrder } from "../server/markets/repo.js";

/**
 * POST /api/markets-orders
 *
 * Submit a maker-signed EIP-712 Order to the off-chain orderbook. The handler:
 *   1. Parses the wire-format body into typed fields (bigint conversion).
 *   2. Validates bounds (price range, expiry, addresses).
 *   3. Verifies the maker's EIP-712 signature against the Exchange domain.
 *   4. Looks up the market by Order.market (Address) so we can store
 *      `market_id` (uuid) on the row.
 *   5. Persists the order row keyed by EIP-712 hash. Idempotent.
 *
 * Request body shape (`WireOrder`): all bigint fields as decimal strings.
 *   {
 *     maker: "0x...", market: "0x...", outcome: 0|1, side: 0|1,
 *     price: "500000", size: "1000000", expiry: "1735689600", salt: "1",
 *     signature: "0x..."
 *   }
 *
 * Response: { hash, status }
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");
    const body = readJsonBody(request);

    const exchange = process.env.MARKETS_EXCHANGE;
    if (!exchange) {
      throw new HttpError(503, "MARKETS_EXCHANGE is not configured.");
    }
    const exchangeAddress = getAddress(exchange);

    const order = parseWireOrder(body);
    assertOrderBounds(order);

    const validSig = await verifyOrderSignature(order, exchangeAddress);
    if (!validSig) {
      throw new HttpError(401, "Order signature did not recover to maker");
    }

    const market = await getMarketByAddress(order.market);
    if (!market) {
      throw new HttpError(404, `Unknown market contract ${order.market}`);
    }

    const hash = hashOrder(order, exchangeAddress);

    await insertOrder({
      hash,
      marketId: market.id,
      maker: order.maker,
      outcome: order.outcome,
      side: order.side,
      price: order.price,
      size: order.size,
      expiry: order.expiry,
      salt: order.salt,
      signature: order.signature,
    });

    sendJson(response, 200, { hash, status: "open" });
  } catch (error) {
    sendError(response, error);
  }
}
