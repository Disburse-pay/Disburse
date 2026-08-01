import {
  assertMethod,
  readJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../server/http.js";
import {
  authorizePaymentRequestCreation
} from "../server/notifications.js";
import { createStoredQrRequest } from "../server/qr.js";
import { enforceRedisRateLimit } from "../server/rate-limit.js";

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");
    const body = readJsonBody(request);
    const creationAuth = await authorizePaymentRequestCreation(body);
    await enforceRedisRateLimit("qr_create", creationAuth.wallet);
    sendJson(response, 201, await createStoredQrRequest(body, creationAuth));
  } catch (error) {
    sendError(response, error);
  }
}
