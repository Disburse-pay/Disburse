import { assertMethod, readQueryString, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { listAllPositions, listLiquidatable } from "../server/lending/repo.js";

/**
 * GET /api/lending-positions          — every cached position, HF ascending
 * GET /api/lending-positions?liquidatable=1 — only those with is_liquidatable=true
 *
 * The keeper bot queries the `liquidatable=1` form to find candidates.
 * Front-end (admin view) can use the unfiltered form for a debt dashboard.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    const onlyLiquidatable = readQueryString(request, "liquidatable") === "1";
    const rows = onlyLiquidatable ? await listLiquidatable() : await listAllPositions();
    sendJson(response, 200, {
      positions: rows.map((r) => ({
        userAddress: r.user_address,
        collateralAmount: String(r.collateral_amount),
        scaledBorrow: String(r.scaled_borrow),
        cachedDebtUsdc: String(r.cached_debt_usdc),
        cachedCollateralUsdc: String(r.cached_collateral_usdc),
        cachedHealthFactor: r.cached_health_factor ? String(r.cached_health_factor) : null,
        isLiquidatable: "is_liquidatable" in r ? r.is_liquidatable : true,
        lastUpdatedAt: "last_updated_at" in r ? r.last_updated_at : null,
      })),
    });
  } catch (error) {
    sendError(response, error);
  }
}
