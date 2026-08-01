import { getAddress, isAddress, zeroAddress } from "viem";
import {
  assertMethod,
  HttpError,
  readJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
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
 * Required query: ?issuer=0x... supplied from an independent trust source
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
      sendJson(response, 400, {
        error: "Request body must be a PSP document (JSON object with version field)."
      });
      return;
    }

    // Never silently accept a missing, malformed, or repeated trust root.
    const issuerParam = request.query?.issuer;
    if (Array.isArray(issuerParam)) {
      throw new HttpError(400, 'Query parameter "issuer" must be provided exactly once.');
    }
    if (
      typeof issuerParam !== "string" ||
      !isAddress(issuerParam) ||
      getAddress(issuerParam) === zeroAddress
    ) {
      throw new HttpError(
        400,
        'Provide one non-zero trusted issuer address in the "issuer" query parameter.'
      );
    }

    const result = await verify(body, {
      expectedIssuer: getAddress(issuerParam),
    });

    // Always 200 — ok: true/false indicates verification status
    sendJson(response, 200, result);
  } catch (error) {
    sendError(response, error);
  }
}
