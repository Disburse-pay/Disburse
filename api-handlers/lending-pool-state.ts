import { sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { HttpError } from "../server/http.js";
import { getLatestPoolSnapshot } from "../server/lending/repo.js";

/**
 * GET /api/lending-pool-state
 *
 * Returns the most recent indexer-written snapshot of pool-wide state:
 * cash, total borrows, total reserves, utilization, APRs, latest BTC price.
 * All values are returned as decimal strings (USDC at 6 decimals, indexes /
 * APRs / util at 1e18). Used by the lending UI's "Pool stats" panel.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const snap = await getLatestPoolSnapshot();
    if (!snap) {
      sendJson(response, 200, { snapshot: null });
      return;
    }
    sendJson(response, 200, {
      snapshot: {
        blockNumber: String(snap.block_number),
        observedAt: snap.observed_at,
        cashUsdc: String(snap.cash_usdc),
        totalBorrowsUsdc: String(snap.total_borrows_usdc),
        totalReservesUsdc: String(snap.total_reserves_usdc),
        supplyIndex: String(snap.supply_index),
        borrowIndex: String(snap.borrow_index),
        utilizationWad: String(snap.utilization_wad),
        borrowAprWad: String(snap.borrow_apr_wad),
        supplyAprWad: String(snap.supply_apr_wad),
        btcPriceWad: snap.btc_price_wad ? String(snap.btc_price_wad) : null,
      },
    });
  } catch (error) {
    sendError(response, error);
  }
}
