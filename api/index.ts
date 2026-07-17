import type { ApiRequest, ApiResponse } from "../server/http.js";
import { sendJson } from "../server/http.js";

import psp from "../api-handlers/psp.js";
import pspVerify from "../api-handlers/psp-verify.js";
import pspViewer from "../api-handlers/psp-viewer.js";
import disburse from "../api-handlers/disburse.js";
import ids from "../api-handlers/ids.js";
import notifications from "../api-handlers/notifications.js";
import qrConfirmations from "../api-handlers/qr-confirmations.js";
import qrRequests from "../api-handlers/qr-requests.js";
import qrStatus from "../api-handlers/qr-status.js";
import qrSubmissions from "../api-handlers/qr-submissions.js";
import statements from "../api-handlers/statements.js";
import webhooks from "../api-handlers/webhooks.js";

type Handler = (request: ApiRequest & { headers?: Record<string, string | string[] | undefined> }, response: ApiResponse) => unknown;

const handlers: Record<string, Handler> = {
  psp,
  "psp-verify": pspVerify,
  "psp-viewer": pspViewer,
  disburse,
  ids,
  notifications,
  "qr-confirmations": qrConfirmations,
  "qr-requests": qrRequests,
  "qr-status": qrStatus,
  "qr-submissions": qrSubmissions,
  statements,
  webhooks,
};

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const routeValue = request.query?.route;
  const route = Array.isArray(routeValue) ? routeValue.join("/") : routeValue ?? "";
  const routeHandler = handlers[route];
  if (!routeHandler) {
    sendJson(response, 404, { error: `Unknown API route: ${route || "/"}` });
    return;
  }

  await routeHandler(request as ApiRequest & { headers?: Record<string, string | string[] | undefined> }, response);
}
