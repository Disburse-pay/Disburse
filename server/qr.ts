import { randomUUID } from "node:crypto";
import type { Hash, Log, TransactionReceipt } from "viem";
import { publicClient, TOKENS } from "../src/lib/arc.js";
import {
  createExpiry,
  formatTokenAmount,
  isPaymentPayable,
  makeReceipt,
  normalizeDateTime,
  normalizeInvoiceDate,
  normalizeLabel,
  normalizeNote,
  parseTokenAmount,
  refreshDerivedStatus,
  transferMatchesRequest,
  validateRecipient,
  decodeTransferLog,
  type DecodedTransfer,
  type PaymentRequest,
  type PaymentToken,
  type Receipt,
  type TransferLog
} from "../src/lib/payments.js";
import {
  paymentRequestToRow,
  receiptToRow,
  rowToPaymentRequest,
  rowToReceipt,
  type PaymentReceiptRow,
  type PaymentRequestRow,
  type QrRealtimeEvent,
  type QrStatusPayload
} from "../src/lib/realtime.js";
import { HttpError } from "./http.js";
import { notifyPaymentRequest, requireDisburseId, tryNotifyPaymentReceived } from "./notifications.js";
import { getSupabaseAdmin } from "./supabase.js";
import { tryIssuePsp } from "./psp/hook.js";

export type CreateQrRequestInput = {
  recipient: string;
  token: PaymentToken;
  amount: string;
  label: string;
  note?: string;
  invoiceDate: string;
  /** Disburse ID to notify in-app: "request payment from @name". */
  notify?: string;
};

export type ConfirmationResolution =
  | { status: "paid"; receipt: Receipt; message: string }
  | { status: "failed"; message: string };

type SubmittedReceipt = {
  logs: Log[];
  status: "success" | "reverted";
};

export async function createStoredQrRequest(input: Record<string, unknown>): Promise<QrStatusPayload> {
  const createInput = readCreateQrRequestInput(input);

  // Resolve the notification target before persisting anything so an unknown
  // name fails the whole creation with a message the requester can act on.
  const notifyTarget = createInput.notify ? await requireDisburseId(createInput.notify) : undefined;

  const request = await buildServerArcSettlementQrRequest(createInput);
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("payment_requests").insert(paymentRequestToRow(request));

  if (error) {
    throw new HttpError(500, error.message);
  }

  let notifiedHandle: string | undefined;
  if (notifyTarget) {
    const { data } = await supabase
      .from("disburse_ids")
      .select("handle")
      .eq("address", request.recipient.toLowerCase())
      .maybeSingle();
    await notifyPaymentRequest(notifyTarget.handle, request, (data as { handle: string } | null)?.handle);
    notifiedHandle = notifyTarget.handle;
  }

  return { request, ...(notifiedHandle ? { notified: notifiedHandle } : {}) };
}

export async function readStoredQrStatus(requestId: string): Promise<QrStatusPayload> {
  const request = await readPaymentRequest(requestId);
  const refreshedRequest = await refreshStoredExpiry(request);
  const receipt = await readPaymentReceipt(requestId);
  return {
    request: refreshedRequest,
    ...(receipt ? { receipt } : {})
  };
}

export async function recordStoredQrSubmission(
  requestId: string,
  txHash: Hash,
  submittedAtInput?: string
): Promise<QrStatusPayload> {
  const request = await readPaymentRequest(requestId);
  if (request.status === "paid" || request.status === "failed") {
    throw new HttpError(409, "This QR payment request is already closed.");
  }
  const submittedAt = submittedAtInput
    ? normalizeDateTime(submittedAtInput, "submission time")
    : new Date().toISOString();
  const submittedRequest: PaymentRequest = {
    ...request,
    submittedAt,
    txHash,
    status: "open"
  };

  if (!isPaymentPayable(submittedRequest)) {
    throw new HttpError(409, "This QR payment request is no longer payable.");
  }

  await updatePaymentRequest(submittedRequest);
  await insertQrEvent({
    request_id: submittedRequest.id,
    event_type: "submitted",
    status: submittedRequest.status,
    message: "Payment submitted. Waiting for on-chain confirmation.",
    tx_hash: txHash,
    submitted_at: submittedAt
  });

  return {
    request: submittedRequest,
    event: {
      request_id: submittedRequest.id,
      event_type: "submitted",
      status: submittedRequest.status,
      message: "Payment submitted. Waiting for on-chain confirmation.",
      tx_hash: txHash,
      submitted_at: submittedAt
    }
  };
}

export async function confirmStoredQrPayment(requestId: string, txHash: Hash) {
  const existingRequest = await readPaymentRequest(requestId);
  const request: PaymentRequest = {
    ...existingRequest,
    txHash,
    submittedAt: existingRequest.submittedAt ?? new Date().toISOString()
  };

  if (request.status === "paid" || request.status === "failed") {
    const receipt = await readPaymentReceipt(request.id);
    return {
      status: request.status,
      request,
      ...(receipt ? { receipt } : {}),
      message: request.status === "paid" ? "Payment already confirmed." : "Payment already failed."
    };
  }

  let transactionReceipt: TransactionReceipt;
  try {
    transactionReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    throw new HttpError(409, "Transaction receipt is not available yet.");
  }

  const resolution = resolveSubmittedReceiptConfirmation(request, transactionReceipt);

  if (resolution.status === "paid") {
    const paidRequest: PaymentRequest = {
      ...request,
      status: "paid",
      txHash: resolution.receipt.txHash
    };
    const receipt: Receipt = resolution.receipt;
    await updatePaymentRequest(paidRequest);
    await upsertPaymentReceipt(receipt);
    await insertQrEvent({
      request_id: paidRequest.id,
      event_type: "paid",
      status: "paid",
      message: resolution.message,
      tx_hash: paidRequest.txHash,
      submitted_at: paidRequest.submittedAt,
      receipt
    });
    const pspUid = await tryIssuePsp(paidRequest, receipt);
    await tryNotifyPaymentReceived(paidRequest, receipt);
    return {
      status: "paid" as const,
      request: paidRequest,
      receipt,
      message: resolution.message,
      psp_uid: pspUid
    };
  }

  const failedRequest: PaymentRequest = {
    ...request,
    status: "failed"
  };
  await updatePaymentRequest(failedRequest, resolution.message);
  await insertQrEvent({
    request_id: failedRequest.id,
    event_type: "failed",
    status: "failed",
    message: resolution.message,
    tx_hash: failedRequest.txHash,
    submitted_at: failedRequest.submittedAt
  });

  return {
    status: "failed" as const,
    request: failedRequest,
    message: resolution.message
  };
}

export function resolveSubmittedReceiptConfirmation(
  request: PaymentRequest,
  receipt: SubmittedReceipt
): ConfirmationResolution {
  if (receipt.status === "reverted") {
    return {
      status: "failed",
      message: "The submitted transaction reverted on Arc Testnet."
    };
  }

  const transfers = receipt.logs
    .filter((log) => log.address.toLowerCase() === TOKENS[request.token].address.toLowerCase())
    .map((log) => decodeTransferLog(log as unknown as TransferLog))
    .filter((transfer): transfer is DecodedTransfer => Boolean(transfer));

  const exact = transfers.find((transfer) => transferMatchesRequest(request, transfer));
  if (exact) {
    return {
      status: "paid",
      receipt: makeReceipt(request, exact),
      message: "Payment confirmed. Invoice is ready."
    };
  }

  const recipientTransfer = transfers.find((transfer) => transfer.to.toLowerCase() === request.recipient.toLowerCase());
  if (recipientTransfer) {
    return {
      status: "failed",
      message: "A transfer reached the requester, but the amount does not match this QR request."
    };
  }

  return {
    status: "failed",
    message: "The submitted transaction does not pay this QR request."
  };
}

export function readHash(value: unknown): Hash {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new HttpError(400, "Enter a valid transaction hash.");
  }
  return value as Hash;
}

export function readRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F-]{36}$/.test(value)) {
    throw new HttpError(400, "Enter a valid request id.");
  }
  return value;
}

async function buildServerArcSettlementQrRequest(input: CreateQrRequestInput): Promise<PaymentRequest> {
  if (input.token !== "USDC") {
    throw new HttpError(400, "QR payments currently support USDC only.");
  }
  const createdAt = new Date().toISOString();

  return {
    id: randomUUID(),
    recipient: validateRecipient(input.recipient),
    token: "USDC",
    amount: formatTokenAmount(parseTokenAmount(input.amount, "USDC"), "USDC"),
    label: normalizeLabel(input.label),
    note: input.note ? normalizeNote(input.note) : undefined,
    invoiceDate: normalizeInvoiceDate(input.invoiceDate),
    expiresAt: createExpiry(createdAt),
    createdAt,
    startBlock: "0",
    status: "open"
  };
}

export function readCreateQrRequestInput(input: Record<string, unknown>): CreateQrRequestInput {
  const token = input.token;
  if (token !== "USDC") {
    throw new HttpError(400, "QR payments currently support USDC only.");
  }
  return {
    recipient: readRequiredString(input, "recipient"),
    token,
    amount: readRequiredString(input, "amount"),
    label: readRequiredString(input, "label"),
    note: typeof input.note === "string" ? input.note : undefined,
    invoiceDate: readRequiredString(input, "invoiceDate"),
    notify: typeof input.notify === "string" && input.notify.trim() ? input.notify.trim() : undefined
  };
}

async function readPaymentRequest(requestId: string): Promise<PaymentRequest> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("payment_requests").select("*").eq("id", readRequestId(requestId)).maybeSingle();

  if (error) {
    throw new HttpError(500, error.message);
  }
  if (!data) {
    throw new HttpError(404, "Payment request was not found.");
  }

  return rowToPaymentRequest(data as PaymentRequestRow);
}

async function readPaymentReceipt(requestId: string): Promise<Receipt | undefined> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("payment_receipts").select("*").eq("request_id", readRequestId(requestId)).maybeSingle();

  if (error) {
    throw new HttpError(500, error.message);
  }

  return data ? rowToReceipt(data as PaymentReceiptRow) : undefined;
}

async function refreshStoredExpiry(request: PaymentRequest): Promise<PaymentRequest> {
  const refreshed = refreshDerivedStatus(request);
  if (refreshed.status !== "expired" || request.status === "expired") {
    return refreshed;
  }

  await updatePaymentRequest(refreshed);
  await insertQrEvent({
    request_id: refreshed.id,
    event_type: "expired",
    status: "expired",
    message: "This QR request expired before a valid payment was confirmed.",
    tx_hash: refreshed.txHash,
    submitted_at: refreshed.submittedAt
  });
  return refreshed;
}

async function updatePaymentRequest(request: PaymentRequest, failureReason?: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("payment_requests")
    .update({
      ...paymentRequestToRow(request, failureReason),
      updated_at: new Date().toISOString()
    })
    .eq("id", request.id);

  if (error) {
    throw new HttpError(500, error.message);
  }
}

async function upsertPaymentReceipt(receipt: Receipt) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("payment_receipts").upsert(receiptToRow(receipt), { onConflict: "request_id" });

  if (error) {
    throw new HttpError(500, error.message);
  }
}

async function insertQrEvent(event: Omit<QrRealtimeEvent, "id" | "created_at">) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("payment_request_events").insert({
    request_id: event.request_id,
    event_type: event.event_type,
    status: event.status,
    message: event.message,
    tx_hash: event.tx_hash ?? null,
    submitted_at: event.submitted_at ?? null,
    receipt: event.receipt ?? null,
    settlement: event.settlement ?? null
  });

  if (error) {
    throw new HttpError(500, error.message);
  }
}

function readRequiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `Missing ${key}.`);
  }
  return value;
}
