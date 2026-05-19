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
 * GET /api/markets-positions?address=0x...
 *
 * Returns the user's cached positions across all markets. Position cache is
 * maintained by the fills indexer; ground truth is the OutcomeToken balances
 * on-chain.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    const address = readQueryString(request, "address");
    if (!address || !isAddress(address)) {
      throw new HttpError(400, "Provide a valid EVM address via ?address=");
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("market_positions")
      .select("user_address,market_id,yes_shares,no_shares,cost_basis,realized_pnl,updated_at")
      .eq("user_address", address.toLowerCase())
      .order("updated_at", { ascending: false });
    if (error) throw new HttpError(500, error.message);

    sendJson(response, 200, {
      positions: (data ?? []).map((row: any) => ({
        userAddress: row.user_address,
        marketId: row.market_id,
        yesShares: String(row.yes_shares),
        noShares: String(row.no_shares),
        costBasis: String(row.cost_basis),
        realizedPnl: String(row.realized_pnl),
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    sendError(response, error);
  }
}
