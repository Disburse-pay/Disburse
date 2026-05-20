import type { ApiRequest, ApiResponse } from "../server/http.js";
import { sendJson } from "../server/http.js";

import adminMarketsCreate from "../api-handlers/admin-markets-create.js";
import adminMarketsResolve from "../api-handlers/admin-markets-resolve.js";
import markets from "../api-handlers/markets.js";
import marketsClaims from "../api-handlers/markets-claims.js";
import marketsDetail from "../api-handlers/markets-detail.js";
import marketsExpireOrders from "../api-handlers/markets-expire-orders.js";
import marketsFills from "../api-handlers/markets-fills.js";
import marketsMyFills from "../api-handlers/markets-my-fills.js";
import marketsOrderbook from "../api-handlers/markets-orderbook.js";
import marketsOrders from "../api-handlers/markets-orders.js";
import marketsOperatorCron from "../api-handlers/markets-operator-cron.js";
import marketsPositions from "../api-handlers/markets-positions.js";
import marketsWhitelistValidate from "../api-handlers/markets-whitelist-validate.js";
import marketsWhitelistRequest from "../api-handlers/markets-whitelist-request.js";
import milestones from "../api-handlers/milestones.js";
import psp from "../api-handlers/psp.js";
import pspVerify from "../api-handlers/psp-verify.js";
import pspViewer from "../api-handlers/psp-viewer.js";
import qrConfirmations from "../api-handlers/qr-confirmations.js";
import qrRequests from "../api-handlers/qr-requests.js";
import qrStatus from "../api-handlers/qr-status.js";
import qrSubmissions from "../api-handlers/qr-submissions.js";
import statements from "../api-handlers/statements.js";
import webhooks from "../api-handlers/webhooks.js";

type Handler = (request: ApiRequest & { headers?: Record<string, string | string[] | undefined> }, response: ApiResponse) => unknown;

const handlers: Record<string, Handler> = {
  "admin-markets-create": adminMarketsCreate,
  "admin-markets-resolve": adminMarketsResolve,
  markets,
  "markets-claims": marketsClaims,
  "markets-detail": marketsDetail,
  "markets-expire-orders": marketsExpireOrders,
  "markets-fills": marketsFills,
  "markets-my-fills": marketsMyFills,
  "markets-orderbook": marketsOrderbook,
  "markets-orders": marketsOrders,
  "markets-operator-cron": marketsOperatorCron,
  "markets-positions": marketsPositions,
  "markets-whitelist-validate": marketsWhitelistValidate,
  "markets-whitelist-request": marketsWhitelistRequest,
  milestones,
  psp,
  "psp-verify": pspVerify,
  "psp-viewer": pspViewer,
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
