import { getAddress, verifyTypedData, type Address, type Hex } from "viem";
import {
  buildInboxAccessTypedData,
  INBOX_ACCESS_TTL_SECONDS,
  isValidHandle,
  normalizeHandle
} from "../src/lib/ids.js";
import type { PaymentRequest, Receipt } from "../src/lib/payments.js";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabase.js";

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
    throw new HttpError(500, `Failed to resolve Disburse ID: ${error.message}`);
  }
  if (!data) {
    throw new HttpError(404, `No Disburse ID named "${handle}".`);
  }
  const row = data as { handle: string; address: string };
  return { handle: row.handle, address: getAddress(row.address) };
}

/**
 * Notify @handle that a payment request is addressed to them. The payload
 * carries the full request so the inbox can open the locked pay flow
 * directly (Pay now) without another lookup.
 */
export async function notifyPaymentRequest(
  targetHandle: string,
  request: PaymentRequest,
  fromHandle?: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("notifications").upsert(
    {
      recipient_handle: normalizeHandle(targetHandle),
      kind: "payment_request",
      request_id: request.id,
      payload: {
        request,
        ...(fromHandle ? { fromHandle } : {})
      }
    },
    { onConflict: "recipient_handle,kind,request_id", ignoreDuplicates: true }
  );
  if (error) {
    throw new HttpError(500, `Failed to create the notification: ${error.message}`);
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

  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new HttpError(400, "signature must be a valid 65-byte hex signature.");
  }

  const verified = await verifyTypedData({
    ...buildInboxAccessTypedData({ wallet, expiresAt }),
    address: wallet,
    signature: signature as Hex
  }).catch(() => false);
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
    throw new HttpError(500, `Failed to resolve Disburse ID: ${error.message}`);
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
    throw new HttpError(500, `Failed to read notifications: ${error.message}`);
  }
  return (data as NotificationRow[] | null) ?? [];
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
    throw new HttpError(500, `Failed to update notifications: ${error.message}`);
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
    throw new HttpError(500, `Failed to update the notification: ${error.message}`);
  }
}
