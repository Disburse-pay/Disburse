import { assertMethod, readJsonBody, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "../server/supabase.js";

/**
 * POST /api/markets-whitelist-redeem
 * 
 * Body: { code: string, address: string }
 * Redeems a single-use whitelist code for an EVM address.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");
    const body = readJsonBody(request);
    const code = typeof body.code === "string" ? body.code : undefined;
    const address = typeof body.address === "string" ? body.address : undefined;
    
    if (!code || !address || !isAddress(address)) {
      sendJson(response, 400, { error: "Code and valid EVM address are required" });
      return;
    }

    const supabase = getSupabaseAdmin();
    const cleanCode = code.trim().toLowerCase();
    const cleanAddress = address.toLowerCase();

    // First check if the address is already whitelisted (idempotent redeem)
    const { data: existingUser } = await supabase
      .from("market_whitelist_codes")
      .select("id")
      .eq("used_by_address", cleanAddress)
      .limit(1);

    if (existingUser && existingUser.length > 0) {
      sendJson(response, 200, { success: true, message: "Already whitelisted" });
      return;
    }

    // Attempt to redeem the code
    const { data: codeData, error: findError } = await supabase
      .from("market_whitelist_codes")
      .select("id, is_used")
      .eq("code", cleanCode)
      .limit(1)
      .single();

    if (findError || !codeData) {
      sendJson(response, 400, { success: false, error: "Invalid code" });
      return;
    }

    if (codeData.is_used) {
      sendJson(response, 400, { success: false, error: "This code has already been used" });
      return;
    }

    // Update row
    const { error: updateError } = await supabase
      .from("market_whitelist_codes")
      .update({
        is_used: true,
        used_by_address: cleanAddress,
        used_at: new Date().toISOString()
      })
      .eq("id", codeData.id)
      .eq("is_used", false); // concurrency protection

    if (updateError) {
      sendJson(response, 500, { success: false, error: "Failed to redeem code" });
      return;
    }

    sendJson(response, 200, { success: true });
  } catch (error) {
    sendError(response, error);
  }
}
