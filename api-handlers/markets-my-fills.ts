import {
  assertMethod,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import { HttpError } from "../server/http.js";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "../server/supabase.js";

/**
 * GET /api/markets-my-fills?address=0x...
 *
 * Returns all fills where the given address participated as either taker or
 * maker. Used by the portfolio dashboard to compute total volume traded.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    const address = readQueryString(request, "address");
    if (!address || !isAddress(address)) {
      throw new HttpError(400, "Provide a valid EVM address via ?address=");
    }

    const supabase = getSupabaseAdmin();
    const addr = address.toLowerCase();
    const { data, error } = await supabase
      .from("market_fills")
      .select("market_id,outcome,side,price,size,total_usdc,filled_at")
      .or(`taker.eq.${addr},maker.eq.${addr}`)
      .order("filled_at", { ascending: false });
    if (error) throw new HttpError(500, error.message);

    sendJson(response, 200, {
      fills: (data ?? []).map((row: any) => ({
        marketId: row.market_id,
        outcome: row.outcome,
        side: row.side,
        price: String(row.price),
        size: String(row.size),
        totalUsdc: String(row.total_usdc),
        filledAt: row.filled_at,
      })),
    });
  } catch (error) {
    sendError(response, error);
  }
}
