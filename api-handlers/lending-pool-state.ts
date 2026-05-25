import { sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { HttpError } from "../server/http.js";
import { getLatestPoolSnapshot } from "../server/lending/repo.js";
import { toIntString, toIntStringOrNull } from "../server/lending/wire.js";

/**
 * GET /api/lending-pool-state
 *
 * Returns the most recent indexer-written snapshot of pool-wide state:
 * cash, total borrows, total reserves, utilization, APRs, latest BTC price.
 * All values are returned as plain integer strings (USDC at 6 decimals,
 * indexes / APRs / util / BTC price at 1e18). Used by the lending UI's
 * "Pool stats" panel.
 *
 * `toIntString` defends against Supabase returning NUMERIC columns as JS
 * Numbers (which `String()` then serializes in scientific notation, breaking
 * `BigInt()` on the client). See server/lending/wire.ts.
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
        blockNumber: toIntString(snap.block_number),
        observedAt: snap.observed_at,
        cashUsdc: toIntString(snap.cash_usdc),
        totalBorrowsUsdc: toIntString(snap.total_borrows_usdc),
        totalReservesUsdc: toIntString(snap.total_reserves_usdc),
        supplyIndex: toIntString(snap.supply_index),
        borrowIndex: toIntString(snap.borrow_index),
        utilizationWad: toIntString(snap.utilization_wad),
        borrowAprWad: toIntString(snap.borrow_apr_wad),
        supplyAprWad: toIntString(snap.supply_apr_wad),
        btcPriceWad: toIntStringOrNull(snap.btc_price_wad),
      },
    });
  } catch (error) {
    sendError(response, error);
  }
}
