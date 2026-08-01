import {
  assertMethod,
  readJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../server/http.js";
import { readWalletHistory } from "../server/history.js";

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");
    sendJson(response, 200, await readWalletHistory(readJsonBody(request)));
  } catch (error) {
    sendError(response, error);
  }
}
