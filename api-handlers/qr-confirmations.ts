import {
  assertMethod,
  readHeaderString,
  readJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../server/http.js";
import {
  confirmStoredQrPayment,
  readHash,
  readPaymentAuthorization,
  readRequestId,
  readRequestToken
} from "../server/qr.js";

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");
    const body = readJsonBody(request);
    sendJson(
      response,
      200,
      await confirmStoredQrPayment(
        readRequestId(body.id),
        readHash(body.txHash),
        readRequestToken(readHeaderString(request, "x-disburse-request-token")),
        readPaymentAuthorization(body.authorization)
      )
    );
  } catch (error) {
    sendError(response, error);
  }
}
