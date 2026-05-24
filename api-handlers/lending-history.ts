import { assertMethod, readQueryString, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { HttpError } from "../server/http.js";
import { listRecentEvents } from "../server/lending/repo.js";

/**
 * GET /api/lending-history?limit=50
 * GET /api/lending-history?address=0x...&limit=50
 *
 * Returns the most recent indexed events, newest first. When `address` is
 * provided, filters to events where the user is the primary actor OR the
 * related actor (e.g. liquidator on a Liquidated event, payer on a Repaid).
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    const address = readQueryString(request, "address");
    if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new HttpError(400, "Invalid address");
    }
    const limitRaw = readQueryString(request, "limit");
    const limit = limitRaw ? Math.max(1, Math.min(200, Number(limitRaw))) : 50;
    const rows = await listRecentEvents({ user: address ?? undefined, limit });
    sendJson(response, 200, {
      events: rows.map((r) => ({
        txHash: r.tx_hash,
        logIndex: r.log_index,
        blockNumber: String(r.block_number),
        blockTime: r.block_time,
        eventType: r.event_type,
        userAddress: r.user_address,
        relatedAddress: r.related_address,
        amountA: r.amount_a ? String(r.amount_a) : null,
        amountB: r.amount_b ? String(r.amount_b) : null,
        amountC: r.amount_c ? String(r.amount_c) : null,
      })),
    });
  } catch (error) {
    sendError(response, error);
  }
}
