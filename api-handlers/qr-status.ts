import {
  assertMethod,
  readHeaderString,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../server/http.js";
import { readRequestId, readRequestToken, readStoredQrStatus } from "../server/qr.js";

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");
    sendJson(
      response,
      200,
      await readStoredQrStatus(
        readRequestId(readQueryString(request, "id")),
        readRequestToken(readHeaderString(request, "x-disburse-request-token"))
      )
    );
  } catch (error) {
    sendError(response, error);
  }
}
