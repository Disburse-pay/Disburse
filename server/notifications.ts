import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getAddress, hashTypedData, isAddress, type Address, type Hex } from "viem";
import {
  buildInboxAccessTypedData,
  INBOX_ACCESS_TTL_SECONDS,
  isValidHandle,
  normalizeHandle
} from "../src/lib/ids.js";
import {
  formatTokenAmount,
  normalizeInvoiceDate,
  normalizeLabel,
  normalizeNote,
  parseTokenAmount,
  type PaymentRequest,
  type Receipt
} from "../src/lib/payments.js";
import {
  buildPaymentRequestAuthorizationTypedData,
  PAYMENT_REQUEST_AUTH_TTL_SECONDS,
  type PaymentRequestCreationAuthorization
} from "../src/lib/paymentRequestNotificationAuthorization.js";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabase.js";
import { readWalletSignature, verifyWalletTypedData } from "./wallet-auth.js";

export const PAYMENT_REQUESTS_PER_SENDER_TARGET_HOUR = 5;
export const PAYMENT_REQUESTS_PER_TARGET_HOUR = 20;
export const PAYMENT_REQUESTS_PER_WALLET_HOUR = 20;

export type NotificationKind = "payment_request" | "payment_received";
export type NotificationStatus = "unread" | "read" | "ignored";

export type NotificationRow = {
  id: string;
  recipient_handle: string;
  kind: NotificationKind;
  request_id: string | null;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  created_at: string;
};

export type SealedRequestToken = {
  version: 1;
  algorithm: "A256GCM";
  iv: string;
  ciphertext: string;
  tag: string;
};

export type AuthorizedPaymentRequestCreation = PaymentRequestCreationAuthorization & {
  authorizationDigest: Hex;
};

/**
 * Authenticate every server-backed QR request. Inbox delivery is optional,
 * represented by an empty `notify` value in the signed message.
 */
export async function authorizePaymentRequestCreation(
  body: Record<string, unknown>
): Promise<AuthorizedPaymentRequestCreation> {
  const notifyInput = typeof body.notify === "string" ? body.notify : "";
  const notify = notifyInput.trim() ? normalizeHandle(notifyInput) : "";
  if (notify && !isValidHandle(notify)) {
    throw new HttpError(422, "Names are 3-16 characters: a-z, 0-9, underscore.");
  }

  const recipientInput = typeof body.recipient === "string" ? body.recipient.trim() : "";
  const walletInput = typeof body.wallet === "string" ? body.wallet.trim() : "";
  if (!isAddress(recipientInput) || !isAddress(walletInput)) {
    throw new HttpError(401, "A valid recipient-wallet authorization is required for QR creation.");
  }
  const recipient = getAddress(recipientInput);
  const wallet = getAddress(walletInput);
  if (wallet.toLowerCase() !== recipient.toLowerCase()) {
    throw new HttpError(403, "Only the payment recipient may create this payment request.");
  }

  if (body.token !== "USDC") {
    throw new HttpError(400, "QR payments currently support USDC only.");
  }

  const expiresAt = readShortLivedExpiry(body.expiresAt, PAYMENT_REQUEST_AUTH_TTL_SECONDS, "Payment request");
  const signature = readWalletSignature(
    body.signature,
    401,
    "A valid payment-request authorization signature is required."
  );

  const authorization: PaymentRequestCreationAuthorization = {
    wallet,
    notify,
    recipient,
    token: "USDC",
    amount: normalizeClientValue(() =>
      formatTokenAmount(parseTokenAmount(readRequiredBodyString(body, "amount"), "USDC"), "USDC")
    ),
    label: normalizeClientValue(() => normalizeLabel(readRequiredBodyString(body, "label"))),
    note: normalizeClientValue(() => (typeof body.note === "string" ? normalizeNote(body.note) : undefined)),
    invoiceDate: normalizeClientValue(() =>
      normalizeInvoiceDate(readRequiredBodyString(body, "invoiceDate"))
    ),
    expiresAt
  };

  const verified = await verifyWalletTypedData({
    ...buildPaymentRequestAuthorizationTypedData(authorization),
    address: wallet,
    signature
  });
  if (!verified) {
    throw new HttpError(401, "Payment-request authorization signature does not match the request.");
  }

  return {
    ...authorization,
    authorizationDigest: hashTypedData(buildPaymentRequestAuthorizationTypedData(authorization))
  };
}

/**
 * Resolve a handle to its Disburse ID row, throwing a 404 the requester can
 * show verbatim when the name does not exist.
 */
export async function requireDisburseId(handleInput: string): Promise<{ handle: string; address: Address }> {
  const handle = normalizeHandle(handleInput);
  if (!isValidHandle(handle)) {
    throw new HttpError(422, "Names are 3-16 characters: a-z, 0-9, underscore.");
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("disburse_ids")
    .select("handle, address")
    .eq("handle", handle)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, "Failed to resolve the Disburse ID.");
  }
  if (!data) {
    throw new HttpError(404, `No Disburse ID named "${handle}".`);
  }
  const row = data as { handle: string; address: string };
  return { handle: row.handle, address: getAddress(row.address) };
}

/**
 * Notify @handle that a payment request is addressed to them. The payload
 * carries the non-secret request fields plus an authenticated-encryption
 * envelope for the bearer capability. Authenticated inbox reads unwrap it
 * just in time so the pay flow can open without storing plaintext at rest.
 */
export async function notifyPaymentRequest(
  targetHandle: string,
  request: PaymentRequest,
  fromHandle?: string
): Promise<void> {
  if (!request.requestToken) {
    throw new HttpError(500, "Payment request capability is unavailable for notification delivery.");
  }
  const { requestToken, ...requestWithoutToken } = request;
  const requestTokenEnvelope = sealNotificationRequestToken(
    requestToken,
    `${normalizeHandle(targetHandle)}:${request.id}`
  );
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("notifications").upsert(
    {
      recipient_handle: normalizeHandle(targetHandle),
      kind: "payment_request",
      request_id: request.id,
      payload: {
        request: requestWithoutToken,
        requestTokenEnvelope,
        ...(fromHandle ? { fromHandle } : {})
      }
    },
    { onConflict: "recipient_handle,kind,request_id", ignoreDuplicates: true }
  );
  if (error) {
    throw new HttpError(500, "Failed to create the notification.");
  }
}

/**
 * Best-effort payment_received notification back to the requester. Never
 * throws: a notification must not fail or delay payment confirmation.
 */
export async function tryNotifyPaymentReceived(request: PaymentRequest, receipt: Receipt): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("disburse_ids")
      .select("handle")
      .eq("address", request.recipient.toLowerCase())
      .maybeSingle();
    const handle = (data as { handle: string } | null)?.handle;
    if (!handle) {
      return;
    }
    await supabase.from("notifications").upsert(
      {
        recipient_handle: handle,
        kind: "payment_received",
        request_id: request.id,
        payload: {
          requestId: request.id,
          amount: request.amount,
          token: request.token,
          label: request.label,
          payer: receipt.from,
          txHash: receipt.txHash
        }
      },
      { onConflict: "recipient_handle,kind,request_id", ignoreDuplicates: true }
    );
  } catch {
    // Confirmation must succeed even when the inbox write does not.
  }
}

/**
 * Verify an EIP-712 inbox-access signature and return the wallet it grants.
 * The signature is a short-lived bearer credential scoped to inbox reads
 * and status updates for that wallet only.
 */
export async function readInboxAuth(body: Record<string, unknown>): Promise<Address> {
  const addressInput = typeof body.wallet === "string" ? body.wallet.trim() : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(addressInput)) {
    throw new HttpError(400, "wallet must be a valid 0x address.");
  }
  const wallet = getAddress(addressInput);

  const expiresAtRaw = body.expiresAt;
  const expiresAt =
    typeof expiresAtRaw === "number" && Number.isSafeInteger(expiresAtRaw) && expiresAtRaw > 0
      ? BigInt(expiresAtRaw)
      : typeof expiresAtRaw === "string" && /^\d+$/.test(expiresAtRaw)
        ? BigInt(expiresAtRaw)
        : undefined;
  if (expiresAt === undefined) {
    throw new HttpError(400, "expiresAt must be a unix timestamp in seconds.");
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (expiresAt <= nowSeconds) {
    throw new HttpError(401, "Inbox access expired. Sign in to your inbox again.");
  }
  if (expiresAt > nowSeconds + BigInt(INBOX_ACCESS_TTL_SECONDS)) {
    throw new HttpError(400, `expiresAt may be at most ${INBOX_ACCESS_TTL_SECONDS} seconds in the future.`);
  }

  const signature = readWalletSignature(
    body.signature,
    400,
    "signature must be a valid bounded hex wallet signature."
  );

  const verified = await verifyWalletTypedData({
    ...buildInboxAccessTypedData({ wallet, expiresAt }),
    address: wallet,
    signature
  });
  if (!verified) {
    throw new HttpError(401, "Signature does not match the wallet.");
  }

  return wallet;
}

export async function findHandleForWallet(wallet: Address): Promise<string | undefined> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("disburse_ids")
    .select("handle")
    .eq("address", wallet.toLowerCase())
    .maybeSingle();
  if (error) {
    throw new HttpError(500, "Failed to resolve the Disburse ID.");
  }
  return (data as { handle: string } | null)?.handle;
}

export async function listNotifications(handle: string, limit = 50): Promise<NotificationRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, recipient_handle, kind, request_id, payload, status, created_at")
    .eq("recipient_handle", handle)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new HttpError(500, "Failed to read notifications.");
  }
  return ((data as NotificationRow[] | null) ?? []).map(hydrateNotificationCapability);
}

export function sealNotificationRequestToken(
  requestToken: string,
  associatedData: string
): SealedRequestToken {
  const key = readNotificationEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(requestToken, "utf8"),
    cipher.final()
  ]);
  return {
    version: 1,
    algorithm: "A256GCM",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url")
  };
}

export function openNotificationRequestToken(
  envelope: SealedRequestToken,
  associatedData: string
): string {
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== "A256GCM" ||
    !envelope.iv ||
    !envelope.ciphertext ||
    !envelope.tag
  ) {
    throw new Error("Notification capability envelope is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    readNotificationEncryptionKey(),
    Buffer.from(envelope.iv, "base64url")
  );
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

/** Domain-separate an owner ledger envelope from an inbox notification row. */
export function paymentRequestCapabilityAssociatedData(
  ownerWallet: Address,
  requestId: string
): string {
  return `ledger:${ownerWallet.toLowerCase()}:${requestId}`;
}

function hydrateNotificationCapability(row: NotificationRow): NotificationRow {
  if (row.kind !== "payment_request") {
    return row;
  }
  const request = row.payload.request;
  const envelope = row.payload.requestTokenEnvelope;
  const { requestToken: _topLevelToken, requestTokenEnvelope: _storedEnvelope, ...payloadWithoutSecrets } =
    row.payload;
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return {
      ...row,
      payload: {
        ...payloadWithoutSecrets,
        capabilityUnavailable: true
      }
    };
  }
  const { requestToken: _legacyToken, ...requestWithoutToken } =
    request as Record<string, unknown>;
  const sanitizedPayload = {
    ...payloadWithoutSecrets,
    request: requestWithoutToken
  };
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    return {
      ...row,
      payload: {
        ...sanitizedPayload,
        capabilityUnavailable: true
      }
    };
  }

  try {
    const requestToken = openNotificationRequestToken(
      envelope as SealedRequestToken,
      `${row.recipient_handle}:${row.request_id}`
    );
    if (!/^[0-9a-fA-F]{64}$/.test(requestToken)) {
      throw new Error("Notification capability is invalid.");
    }
    return {
      ...row,
      payload: {
        ...sanitizedPayload,
        request: { ...requestWithoutToken, requestToken: requestToken.toLowerCase() }
      }
    };
  } catch {
    return {
      ...row,
      payload: {
        ...sanitizedPayload,
        capabilityUnavailable: true
      }
    };
  }
}

function readNotificationEncryptionKey(): Buffer {
  const value = (
    process.env.DISBURSE_CAPABILITY_ENCRYPTION_KEY
    ?? process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY
  )?.trim();
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new HttpError(
      503,
      "Notification capability encryption is not configured."
    );
  }
  return Buffer.from(value, "hex");
}

/** Mark every unread notification read (called when the inbox is opened). */
export async function markAllNotificationsRead(handle: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("notifications")
    .update({ status: "read" })
    .eq("recipient_handle", handle)
    .eq("status", "unread");
  if (error) {
    throw new HttpError(500, "Failed to update notifications.");
  }
}

/** Ignore one notification (the inbox's Ignore action). */
export async function ignoreNotification(handle: string, id: string): Promise<void> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    throw new HttpError(400, "id must be a notification id.");
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("notifications")
    .update({ status: "ignored" })
    .eq("recipient_handle", handle)
    .eq("id", id);
  if (error) {
    throw new HttpError(500, "Failed to update the notification.");
  }
}

function readShortLivedExpiry(value: unknown, ttlSeconds: number, label: string): bigint {
  const expiresAt =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? BigInt(value)
      : typeof value === "string" && /^\d{1,20}$/.test(value)
        ? BigInt(value)
        : undefined;
  if (expiresAt === undefined) {
    throw new HttpError(401, `${label} authorization expiry is invalid.`);
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (expiresAt <= now) {
    throw new HttpError(401, `${label} authorization has expired.`);
  }
  if (expiresAt > now + BigInt(ttlSeconds)) {
    throw new HttpError(401, `${label} authorization may be valid for at most ${ttlSeconds} seconds.`);
  }
  return expiresAt;
}

function readRequiredBodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `Missing ${key}.`);
  }
  return value;
}

function normalizeClientValue<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid payment request.");
  }
}
