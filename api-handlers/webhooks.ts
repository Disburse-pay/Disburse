import {
  assertMethod,
  HttpError,
  readJsonBody,
  readHeaderString,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../server/http.js";
import {
  authorizeWebhookAction,
  consumeWebhookMutationAuthorization,
  createWebhook,
  deleteWebhook,
  listWebhooks,
  type WebhookAuthorizationCredential
} from "../server/webhooks.js";
import { enforceRedisRateLimit } from "../server/rate-limit.js";

/**
 * Webhook Management API
 *
 * Every operation requires a short-lived EIP-712 owner authorization in the
 * x-disburse-wallet, x-disburse-expires-at, and x-disburse-signature headers.
 *
 * GET    /api/webhooks          — list the owner's active webhooks
 * POST   /api/webhooks          — create/rotate { url, secret, recipient?, events? }
 * DELETE /api/webhooks?id=uuid  — deactivate one owner-scoped webhook
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method === "GET") {
      const credential = readWebhookCredential(request);
      const auth = await authorizeWebhookAction(credential, "list");
      await enforceRedisRateLimit("webhook_management", auth.wallet);
      const webhooks = await listWebhooks(auth.wallet);

      sendJson(response, 200, { webhooks: webhooks.map(toPublicWebhook) });
      return;
    }

    if (request.method === "DELETE") {
      const id = readQueryString(request, "id");
      if (!id) {
        sendJson(response, 400, { error: "Query parameter 'id' is required." });
        return;
      }
      const credential = readWebhookCredential(request);
      const auth = await authorizeWebhookAction(credential, "delete", { webhookId: id });
      await enforceRedisRateLimit("webhook_management", auth.wallet);
      await consumeWebhookMutationAuthorization({
        wallet: auth.wallet,
        action: "delete",
        authorizationDigest: auth.authorizationDigest
      });
      await deleteWebhook(auth.wallet, id);
      sendJson(response, 200, { ok: true });
      return;
    }

    // POST — create a new webhook
    assertMethod(request, "POST");
    const body = readJsonBody(request);

    const credential = readWebhookCredential(request);
    const auth = await authorizeWebhookAction(credential, "create", {
      url: body.url,
      secret: body.secret,
      recipient: body.recipient,
      events: body.events
    });
    await enforceRedisRateLimit("webhook_management", auth.wallet);
    await consumeWebhookMutationAuthorization({
      wallet: auth.wallet,
      action: "create",
      authorizationDigest: auth.authorizationDigest
    });
    const webhook = await createWebhook(
      auth.wallet,
      auth.url as string,
      auth.secret as string,
      auth.recipient,
      auth.events
    );

    sendJson(response, 201, toPublicWebhook(webhook));
  } catch (error) {
    sendError(response, error);
  }
}

function readWebhookCredential(request: ApiRequest): WebhookAuthorizationCredential {
  const wallet = readHeaderString(request, "x-disburse-wallet")?.trim();
  const expiresAt = readHeaderString(request, "x-disburse-expires-at")?.trim();
  const signature = readHeaderString(request, "x-disburse-signature")?.trim();
  if (!wallet || !expiresAt || !signature) {
    throw new HttpError(401, "Webhook owner authorization headers are required.");
  }
  return { wallet, expiresAt, signature };
}

function toPublicWebhook(webhook: Awaited<ReturnType<typeof createWebhook>>) {
  return {
    id: webhook.id,
    ownerWallet: webhook.ownerWallet,
    url: redactUrl(webhook.url),
    secret: webhook.secret.length > 4 ? `****${webhook.secret.slice(-4)}` : "****",
    recipient: webhook.recipient,
    events: webhook.events,
    active: webhook.active,
    failureCount: webhook.failureCount,
    createdAt: webhook.createdAt,
    updatedAt: webhook.updatedAt
  };
}

function redactUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}
