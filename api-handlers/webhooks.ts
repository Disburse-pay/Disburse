import {
  assertMethod,
  readJsonBody,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../server/http.js";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks
} from "../server/webhooks.js";

/**
 * Webhook Management API
 *
 * GET    /api/webhooks          — list active webhooks (secrets are masked)
 * POST   /api/webhooks          — create { url, secret, recipient?, events? }
 * DELETE  /api/webhooks?id=uuid  — deactivate a webhook
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method === "GET") {
      const webhooks = await listWebhooks();

      // Mask secrets in response — show only last 4 characters
      const masked = webhooks.map((wh) => ({
        ...wh,
        secret: wh.secret.length > 4
          ? "****" + wh.secret.slice(-4)
          : "****"
      }));

      sendJson(response, 200, { webhooks: masked });
      return;
    }

    if (request.method === "DELETE") {
      const id = readQueryString(request, "id");
      if (!id) {
        sendJson(response, 400, { error: "Query parameter 'id' is required." });
        return;
      }
      await deleteWebhook(id);
      sendJson(response, 200, { ok: true });
      return;
    }

    // POST — create a new webhook
    assertMethod(request, "POST");
    const body = readJsonBody(request);

    const url = body.url as string;
    const secret = body.secret as string;
    const recipient = body.recipient as string | undefined;
    const events = body.events as string[] | undefined;

    if (!url || !secret) {
      sendJson(response, 400, { error: "url and secret are required." });
      return;
    }

    const webhook = await createWebhook(url, secret, recipient, events);

    sendJson(response, 201, webhook);
  } catch (error) {
    sendError(response, error);
  }
}
