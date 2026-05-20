import { assertMethod, readQueryString, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";

/**
 * GET /api/markets-whitelist-validate?code=XYZ
 * 
 * Validates a whitelist code against the WHITELIST_CODES env var.
 * The env var should be a comma-separated list of valid codes.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    const code = readQueryString(request, "code");
    
    if (!code) {
      sendJson(response, 400, { error: "Code is required" });
      return;
    }

    const validCodesString = process.env.WHITELIST_CODES || "";
    const validCodes = validCodesString.split(",").map(c => c.trim().toLowerCase()).filter(c => c.length > 0);
    
    // If no whitelist codes are configured, everything is valid (fail-open for dev, or we can fail-closed). 
    // Let's fail-closed for security.
    if (validCodes.length === 0) {
      sendJson(response, 403, { valid: false, error: "Whitelist not configured" });
      return;
    }

    const isValid = validCodes.includes(code.trim().toLowerCase());
    
    sendJson(response, 200, { valid: isValid });
  } catch (error) {
    sendError(response, error);
  }
}
