import {
  assertMethod,
  readJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import { HttpError } from "../server/http.js";
import { getRelayerAddress, resolveMarket } from "../server/markets/admin.js";
import { getMarketById, setMarketResolved } from "../server/markets/repo.js";
import type { Outcome } from "../src/lib/markets/types.js";

/**
 * POST /api/admin-markets-resolve
 *
 * Admin-only. Resolves a market on-chain via MarketFactory.resolveMarket
 * (which proxies to AdminResolver → Market.resolve) and updates the row.
 *
 * Request body: { marketId: <uuid>, winningOutcome: "YES" | "NO" }
 * Response:     { market, txHash, blockNumber, resolvedAt }
 */
export default async function handler(
  request: ApiRequest & { headers?: Record<string, string | string[] | undefined> },
  response: ApiResponse
) {
  try {
    assertMethod(request, "POST");
    assertAdminKey(request);

    const body = readJsonBody(request);
    const marketId = body.marketId;
    const winning = body.winningOutcome;
    if (typeof marketId !== "string" || !marketId) {
      throw new HttpError(400, "marketId is required");
    }
    if (winning !== "YES" && winning !== "NO") {
      throw new HttpError(400, "winningOutcome must be 'YES' or 'NO'");
    }

    const market = await getMarketById(marketId);
    if (!market) {
      throw new HttpError(404, `Market ${marketId} not found`);
    }
    if (market.status === "resolved") {
      throw new HttpError(409, `Market ${marketId} is already resolved`);
    }
    if (new Date(market.closesAt).getTime() > Date.now()) {
      throw new HttpError(
        409,
        `Market ${marketId} closes at ${market.closesAt}; not yet eligible for resolution`
      );
    }

    const result = await resolveMarket({
      marketId,
      marketAddress: market.onchainAddress,
      winningOutcome: winning as Outcome,
    });

    // resolved_by is the EOA that triggered the resolve, not the on-chain
    // resolver contract (which is fixed and uninteresting in audit logs).
    const updated = await setMarketResolved(
      marketId,
      result.winningOutcome,
      getRelayerAddress(),
      result.txHash,
      result.resolvedAt
    );

    sendJson(response, 200, {
      market: updated,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      resolvedAt: result.resolvedAt,
    });
  } catch (error) {
    sendError(response, error);
  }
}

function assertAdminKey(request: ApiRequest & { headers?: Record<string, string | string[] | undefined> }) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    throw new HttpError(503, "ADMIN_API_KEY is not configured");
  }
  const headerVal = request.headers?.["x-admin-key"] ?? request.headers?.["X-Admin-Key"];
  const provided = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (provided !== expected) {
    throw new HttpError(401, "Invalid admin key");
  }
}
