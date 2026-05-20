import { assertMethod, readQueryString, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "../server/supabase.js";

/**
 * GET /api/markets-whitelist-status?address=0x...
 * 
 * Returns whether the given wallet address has redeemed a whitelist code.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    const address = readQueryString(request, "address");
    
    if (!address || !isAddress(address)) {
      sendJson(response, 400, { error: "Valid EVM address is required" });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("market_whitelist_codes")
      .select("id")
      .eq("used_by_address", address.toLowerCase())
      .limit(1);

    if (error) {
      throw new Error(error.message);
    }

    const whitelisted = data && data.length > 0;
    sendJson(response, 200, { whitelisted });
  } catch (error) {
    sendError(response, error);
  }
}
