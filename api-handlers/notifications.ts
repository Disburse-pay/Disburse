import { assertMethod, HttpError, readJsonBody, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import {
  findHandleForWallet,
  ignoreNotification,
  listNotifications,
  markAllNotificationsRead,
  readInboxAuth
} from "../server/notifications.js";
import { enforceRedisRateLimit } from "../server/rate-limit.js";

/**
 * POST /api/notifications — the in-app notification inbox.
 *
 * Every call carries inbox-access auth: { wallet, expiresAt, signature }
 * where signature is EIP-712 DisburseInboxAccess { wallet, expiresAt } under
 * the Disburse domain. The wallet's Disburse ID scopes all reads and writes.
 *
 * Actions (body.action):
 *   "list"   -> { handle, unreadCount, notifications: [...] }
 *   "read"   -> marks all unread notifications read, then returns the list
 *   "ignore" -> body.id required; marks that notification ignored, returns list
 *
 * A wallet without a claimed Disburse ID gets { handle: null,
 * notifications: [] } — notifications are addressed to names, not addresses.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");
    const body = readJsonBody(request);
    const wallet = await readInboxAuth(body);
    await enforceRedisRateLimit("notifications", wallet);

    const handle = await findHandleForWallet(wallet);
    if (!handle) {
      sendJson(response, 200, { handle: null, unreadCount: 0, notifications: [] });
      return;
    }

    const action = typeof body.action === "string" ? body.action : "list";
    if (action === "read") {
      await markAllNotificationsRead(handle);
    } else if (action === "ignore") {
      const id = typeof body.id === "string" ? body.id : "";
      await ignoreNotification(handle, id);
    } else if (action !== "list") {
      throw new HttpError(400, 'action must be "list", "read", or "ignore".');
    }

    const notifications = await listNotifications(handle);
    sendJson(response, 200, {
      handle,
      unreadCount: notifications.filter((n) => n.status === "unread").length,
      notifications: notifications.map((n) => ({
        id: n.id,
        kind: n.kind,
        requestId: n.request_id,
        payload: n.payload,
        status: n.status,
        createdAt: n.created_at
      }))
    });
  } catch (error) {
    sendError(response, error);
  }
}
