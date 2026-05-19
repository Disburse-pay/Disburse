import { assertMethod, readJsonBody, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { verify } from "../src/lib/psp/verify.js";

/**
 * POST /api/psp/verify
 *
 * Stateless PSP verification endpoint for agents and external systems.
 * Accepts a PSP document in the request body and returns the verification result.
 *
 * No authentication required — verification is a pure function.
 *
 * Request body: a PSP JSON document (the full PspV1 object)
 * Optional query: ?issuer=0x... to additionally check expected issuer
 *
 * Response:
 *   200 { ok: true, fields: { requestId, payer, recipient, ... } }
 *   200 { ok: false, reason: "..." }
 *   400 { error: "..." } for malformed requests
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");

    const body = readJsonBody(request);
    if (!body || typeof body !== "object" || !("version" in body)) {
      response.status(400).json({
        error: "Request body must be a PSP document (JSON object with version field)."
      });
      return;
    }

    // Optional issuer check from query string
    const issuerParam = request.query?.issuer;
    const expectedIssuer = typeof issuerParam === "string" && /^0x[0-9a-fA-F]{40}$/.test(issuerParam)
      ? issuerParam as `0x${string}`
      : undefined;

    const result = await verify(body, expectedIssuer ? { expectedIssuer } : undefined);

    // Always 200 — ok: true/false indicates verification status
    sendJson(response, 200, result);
  } catch (error) {
    sendError(response, error);
  }
}
