import { assertMethod, readJsonBody, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { readHash, readRequestId, recordStoredQrSubmission } from "../server/qr.js";

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");
    const body = readJsonBody(request);
    sendJson(
      response,
      200,
      await recordStoredQrSubmission(
        readRequestId(body.id),
        readHash(body.txHash),
        typeof body.submittedAt === "string" ? body.submittedAt : undefined
      )
    );
  } catch (error) {
    sendError(response, error);
  }
}
