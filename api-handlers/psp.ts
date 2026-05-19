import { assertMethod, readQueryString, sendError, type ApiRequest, type ApiResponse } from "../server/http.js";
import { readPspByRequestId, readPspByUid } from "../server/psp/issue.js";

/**
 * GET /api/psp?uid=psp:abc123...
 * GET /api/psp?request_id=<payment-request-uuid>
 *
 * Returns the full PSP document as JSON. Public endpoint — anyone with the
 * UID, or the originating request id, can verify.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");

    const uid = readQueryString(request, "uid");
    const requestId = readQueryString(request, "request_id");
    if (uid && requestId) {
      response.setHeader?.("cache-control", "no-store");
      response.status(400).json({ error: "Provide either uid or request_id, not both." });
      return;
    }

    if (!uid && !requestId) {
      response.setHeader?.("cache-control", "no-store");
      response.status(400).json({ error: "Provide a valid PSP uid or payment request_id." });
      return;
    }

    if (uid && !/^psp:[0-9a-f]{16}$/.test(uid)) {
      response.setHeader?.("cache-control", "no-store");
      response.status(400).json({ error: "Provide a valid PSP uid (e.g. psp:abc123def456abcd)." });
      return;
    }

    if (requestId && !/^[0-9a-fA-F-]{36}$/.test(requestId)) {
      response.setHeader?.("cache-control", "no-store");
      response.status(400).json({ error: "Provide a valid payment request_id." });
      return;
    }

    const psp = uid
      ? await readPspByUid(uid)
      : await readPspByRequestId(requestId as string);
    if (!psp) {
      response.setHeader?.("cache-control", "no-store");
      response.status(404).json({ error: "PSP not found." });
      return;
    }

    // PSPs are immutable — can be cached aggressively
    // Request-id lookups stay uncached because they may be queried before issuance.
    response.setHeader?.(
      "cache-control",
      uid ? "public, max-age=31536000, immutable" : "no-store"
    );
    response.status(200).json(psp);
  } catch (error) {
    sendError(response, error);
  }
}
