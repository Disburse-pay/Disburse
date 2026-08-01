import {
  assertMethod,
  HttpError,
  readHeaderString,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../server/http.js";
import { readPspByRequestId, readPspByUid } from "../server/psp/issue.js";
import { readRequestToken, readStoredQrStatus } from "../server/qr.js";

/**
 * GET /api/psp?uid=psp:abc123...
 * GET /api/psp?request_id=<payment-request-uuid>
 *
 * UID lookup is a bearer-style public lookup. Request-id lookup additionally
 * requires the QR request capability so a UUID cannot bypass QR privacy.
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
      : await readPspForAuthorizedRequest(request, requestId as string);
    if (!psp) {
      sendJson(response, 404, { error: "PSP not found." });
      return;
    }

    // PSPs contain payment-party and invoice metadata. Even UID lookups are
    // bearer-style access and must not enter shared caches.
    sendJson(response, 200, psp);
  } catch (error) {
    sendError(response, error);
  }
}

async function readPspForAuthorizedRequest(request: ApiRequest, requestId: string) {
  const requestToken = readHeaderString(request, "x-disburse-request-token");
  if (!requestToken) {
    throw new HttpError(401, "QR request capability is required for request_id lookup.");
  }
  await readStoredQrStatus(requestId, readRequestToken(requestToken));
  return readPspByRequestId(requestId);
}
