import { assertMethod, readQueryString, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { readPspByUid } from "../server/psp/issue.js";

/**
 * GET /api/psp?uid=psp:abc123...
 *
 * Returns the full PSP document as JSON. Public endpoint — anyone with the
 * UID can verify.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");

    const uid = readQueryString(request, "uid");
    if (!uid || !/^psp:[0-9a-f]{16}$/.test(uid)) {
      response.setHeader?.("cache-control", "no-store");
      response.status(400).json({ error: "Provide a valid PSP uid (e.g. psp:abc123def456abcd)." });
      return;
    }

    const psp = await readPspByUid(uid);
    if (!psp) {
      response.setHeader?.("cache-control", "no-store");
      response.status(404).json({ error: "PSP not found." });
      return;
    }

    // PSPs are immutable — can be cached aggressively
    response.setHeader?.("cache-control", "public, max-age=31536000, immutable");
    sendJson(response, 200, psp);
  } catch (error) {
    sendError(response, error);
  }
}
