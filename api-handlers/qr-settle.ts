import { assertMethod, readJsonBody, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { readRequestId, settleSingleCrossChainQrPayment } from "../server/qr.js";

/**
 * POST /api/qr-settle
 *
 * Client-driven settlement: advances a single cross-chain payment by
 * querying the Polymer proof once and settling if the proof is ready.
 * No auth required — the payment UUID is already known to the payer,
 * the operation is idempotent, and no funds are at risk.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");
    const body = readJsonBody(request);
    const id = readRequestId(body.id);
    sendJson(response, 200, await settleSingleCrossChainQrPayment(id));
  } catch (error) {
    sendError(response, error);
  }
}
