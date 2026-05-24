import {
  assertMethod,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import { HttpError } from "../server/http.js";
import { getPosition } from "../server/lending/repo.js";

/**
 * GET /api/lending-position?address=0x...
 *
 * Returns the cached position for one user. The cache is updated by the
 * indexer after every state-changing event for that user, and on every
 * pool snapshot tick when the BTC price moves. Front-end uses this to
 * render the position card. May return `null` if the user has never
 * interacted with the pool.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    const address = readQueryString(request, "address");
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new HttpError(400, "Provide address=0x...");
    }
    const row = await getPosition(address);
    if (!row) {
      sendJson(response, 200, { position: null });
      return;
    }
    sendJson(response, 200, {
      position: {
        userAddress: row.user_address,
        collateralAmount: String(row.collateral_amount),
        scaledBorrow: String(row.scaled_borrow),
        cachedDebtUsdc: String(row.cached_debt_usdc),
        cachedCollateralUsdc: String(row.cached_collateral_usdc),
        cachedHealthFactor: row.cached_health_factor ? String(row.cached_health_factor) : null,
        isLiquidatable: row.is_liquidatable,
        lastUpdatedBlock: row.last_updated_block ? String(row.last_updated_block) : null,
        lastUpdatedAt: row.last_updated_at,
      },
    });
  } catch (error) {
    sendError(response, error);
  }
}
