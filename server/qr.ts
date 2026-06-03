import { randomUUID } from "node:crypto";
import type { Hash, Log, TransactionReceipt } from "viem";
import { ARC_CHAIN_ID, publicClient, TOKENS } from "../src/lib/arc.js";
import {
  ARC_DESTINATION_CHAIN_ID,
  isPaymentSourceChainId,
  isRemotePaymentSourceChainId
} from "../src/lib/crosschain.js";
import {
  createExpiry,
  formatTokenAmount,
  isCrossChainPaymentRequest,
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
import {
  readCreateCrossChainInput,
  relayCrossChainSettlement,
  resolveCrossChainSourcePayment,
  type CrossChainSourcePayment
} from "./crosschain.js";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabase.js";
import { tryIssuePsp } from "./psp/hook.js";

export type CreateQrRequestInput = {
  recipient: string;
  token: PaymentToken;
  amount: string;
  label: string;
  note?: string;
  invoiceDate: string;
};

export type ConfirmationResolution =
  | { status: "paid"; receipt: Receipt; message: string }
  | { status: "failed"; message: string };

type SubmittedReceipt = {
  logs: Log[];
  status: "success" | "reverted";
};

export async function createStoredQrRequest(input: Record<string, unknown>): Promise<QrStatusPayload> {
  const request = await buildServerArcSettlementQrRequest(readCreateQrRequestInput(input));
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("payment_requests").insert(paymentRequestToRow(request));

  if (error) {
    throw new HttpError(500, error.message);
  }

  return { request };
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
  submittedAtInput?: string,
  sourceChainIdInput?: unknown
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
    status: "open",
    settlement: isCrossChainPaymentRequest(request)
      ? {
          destinationChainId: ARC_DESTINATION_CHAIN_ID,
          sourceChainId: isPaymentSourceChainId(sourceChainIdInput) ? sourceChainIdInput : undefined,
          sourceTxHash: txHash,
          stage: "submitted"
        }
      : request.settlement
  };

  if (!isPaymentPayable(submittedRequest)) {
    throw new HttpError(409, "This QR payment request is no longer payable.");
  }

  await updatePaymentRequest(submittedRequest);
  await insertQrEvent({
    request_id: submittedRequest.id,
    event_type: "submitted",
    status: submittedRequest.status,
    message: isCrossChainPaymentRequest(submittedRequest) && submittedRequest.settlement?.sourceChainId !== ARC_CHAIN_ID
      ? "Source-chain payment submitted. Waiting for Polymer proof."
      : "Payment submitted. Waiting for on-chain confirmation.",
    tx_hash: txHash,
    submitted_at: submittedAt,
    settlement: submittedRequest.settlement
  });

  return {
    request: submittedRequest,
    event: {
      request_id: submittedRequest.id,
      event_type: "submitted",
      status: submittedRequest.status,
      message: isCrossChainPaymentRequest(submittedRequest) && submittedRequest.settlement?.sourceChainId !== ARC_CHAIN_ID
        ? "Source-chain payment submitted. Waiting for Polymer proof."
        : "Payment submitted. Waiting for on-chain confirmation.",
      tx_hash: txHash,
      submitted_at: submittedAt,
      settlement: submittedRequest.settlement
    }
  };
}

export async function confirmStoredQrPayment(requestId: string, txHash: Hash, sourceChainIdInput?: unknown) {
  const existingRequest = await readPaymentRequest(requestId);
  const request: PaymentRequest = {
    ...existingRequest,
    txHash,
    submittedAt: existingRequest.submittedAt ?? new Date().toISOString()
  };

  const sourceChainId = isPaymentSourceChainId(sourceChainIdInput)
    ? sourceChainIdInput
    : request.settlement?.sourceChainId;
  if (isCrossChainPaymentRequest(request) && isRemotePaymentSourceChainId(sourceChainId)) {
    return confirmStoredCrossChainQrPayment(request, txHash, sourceChainIdInput);
  }

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
    const settlement: PaymentRequest["settlement"] = isCrossChainPaymentRequest(request)
      ? {
          ...request.settlement,
          destinationChainId: ARC_DESTINATION_CHAIN_ID,
          sourceChainId: ARC_DESTINATION_CHAIN_ID,
          sourceTxHash: resolution.receipt.txHash,
          destinationTxHash: resolution.receipt.txHash,
          destinationBlockNumber: resolution.receipt.blockNumber,
          stage: "settled" as const
        }
      : request.settlement;
    const paidRequest: PaymentRequest = {
      ...request,
      status: "paid",
      txHash: resolution.receipt.txHash,
      settlement
    };
    const receipt: Receipt = isCrossChainPaymentRequest(request)
      ? {
          ...resolution.receipt,
          chainId: ARC_CHAIN_ID,
          sourceChainId: ARC_DESTINATION_CHAIN_ID,
          sourceTxHash: resolution.receipt.txHash
        }
      : resolution.receipt;
    await updatePaymentRequest(paidRequest);
    await upsertPaymentReceipt(receipt);
    await insertQrEvent({
      request_id: paidRequest.id,
      event_type: "paid",
      status: "paid",
      message: resolution.message,
      tx_hash: paidRequest.txHash,
      submitted_at: paidRequest.submittedAt,
      receipt,
      settlement
    });
    const pspUid = await tryIssuePsp(paidRequest, receipt);
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
    status: "failed",
    settlement: isCrossChainPaymentRequest(request)
      ? {
          ...request.settlement,
          destinationChainId: ARC_DESTINATION_CHAIN_ID,
          sourceChainId: ARC_DESTINATION_CHAIN_ID,
          sourceTxHash: txHash,
          stage: "failed",
          failureReason: resolution.message
        }
      : request.settlement
  };
  await updatePaymentRequest(failedRequest, resolution.message);
  await insertQrEvent({
    request_id: failedRequest.id,
    event_type: "failed",
    status: "failed",
    message: resolution.message,
    tx_hash: failedRequest.txHash,
    submitted_at: failedRequest.submittedAt,
    settlement: failedRequest.settlement
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
  const crossChainInput = readCreateCrossChainInput({});

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
    status: "open",
    destinationChainId: crossChainInput.destinationChainId,
    allowedSourceChainIds: crossChainInput.allowedSourceChainIds,
    settlement: {
      destinationChainId: crossChainInput.destinationChainId
    }
  };
}

async function confirmStoredCrossChainQrPayment(
  request: PaymentRequest & { destinationChainId: typeof ARC_DESTINATION_CHAIN_ID },
  txHash: Hash,
  sourceChainIdInput?: unknown
) {
  if (request.status === "paid" || request.status === "failed") {
    const receipt = await readPaymentReceipt(request.id);
    return {
      status: request.status,
      request,
      ...(receipt ? { receipt } : {}),
      message: request.status === "paid" ? "Payment already settled on Arc." : "Arc settlement already failed."
    };
  }

  let sourcePayment: CrossChainSourcePayment;
  try {
    sourcePayment = await resolveCrossChainSourcePayment(
      request,
      txHash,
      sourceChainIdInput ?? request.settlement?.sourceChainId
    );
  } catch (error) {
    if (isRecoverableCrossChainSourceError(error)) {
      return keepCrossChainRequestOpen(request, txHash, errorToFailureMessage(error), {
        retainHash: shouldRetainRecoverableSourceHash(error),
        sourceChainIdInput
      });
    }
    return failCrossChainRequest(request, txHash, errorToFailureMessage(error));
  }

  const provedRequest: PaymentRequest = {
    ...request,
    txHash: sourcePayment.sourceTxHash,
    settlement: {
      destinationChainId: ARC_DESTINATION_CHAIN_ID,
      sourceChainId: sourcePayment.sourceChainId,
      sourceTxHash: sourcePayment.sourceTxHash,
      sourceBlockNumber: sourcePayment.sourceBlockNumber,
      sourceLogIndex: sourcePayment.sourceLogIndex,
      stage: "proving"
    }
  };
  await updatePaymentRequest(provedRequest);
  await insertQrEvent({
    request_id: provedRequest.id,
    event_type: "proving",
    status: "open",
    message: "Source payment confirmed. Requesting Polymer proof.",
    tx_hash: sourcePayment.sourceTxHash,
    submitted_at: provedRequest.submittedAt,
    settlement: provedRequest.settlement
  });

  try {
    const provingRequest: PaymentRequest = {
      ...provedRequest,
      settlement: {
        destinationChainId: ARC_DESTINATION_CHAIN_ID,
        sourceChainId: sourcePayment.sourceChainId,
        sourceTxHash: sourcePayment.sourceTxHash,
        sourceBlockNumber: sourcePayment.sourceBlockNumber,
        sourceLogIndex: sourcePayment.sourceLogIndex,
        stage: "settling"
      }
    };
    await updatePaymentRequest(provingRequest);
    await insertQrEvent({
      request_id: provingRequest.id,
      event_type: "settling",
      status: "open",
      message: "Polymer proof requested. Relaying settlement transaction.",
      tx_hash: sourcePayment.sourceTxHash,
      submitted_at: provingRequest.submittedAt,
      settlement: provingRequest.settlement
    });

    const result = await relayCrossChainSettlement(provingRequest, sourcePayment);
    const paidRequest: PaymentRequest = {
      ...provingRequest,
      status: "paid",
      txHash: result.receipt.txHash,
      settlement: result.settlement
    };
    await updatePaymentRequest(paidRequest);
    await upsertPaymentReceipt(result.receipt);
    await insertQrEvent({
      request_id: paidRequest.id,
      event_type: "paid",
      status: "paid",
      message: "Payment settled on Arc. Invoice is ready.",
      tx_hash: result.receipt.txHash,
      submitted_at: paidRequest.submittedAt,
      receipt: result.receipt,
      settlement: result.settlement
    });
    const pspUid = await tryIssuePsp(paidRequest, result.receipt);
    return {
      status: "paid" as const,
      request: paidRequest,
      receipt: result.receipt,
      message: "Payment settled on Arc. Invoice is ready.",
      psp_uid: pspUid
    };
  } catch (error) {
    return keepCrossChainSettlementPending(provedRequest, sourcePayment, errorToFailureMessage(error));
  }
}

async function failCrossChainRequest(request: PaymentRequest, txHash: Hash, message: string) {
  const failedRequest: PaymentRequest = {
    ...request,
    status: "failed",
    txHash,
    settlement: request.destinationChainId
      ? {
          ...request.settlement,
          destinationChainId: ARC_DESTINATION_CHAIN_ID,
          sourceTxHash: request.settlement?.sourceTxHash ?? txHash,
          stage: "failed",
          failureReason: message
        }
      : request.settlement
  };
  await updatePaymentRequest(failedRequest, message);
  await insertQrEvent({
    request_id: failedRequest.id,
    event_type: "failed",
    status: "failed",
    message,
    tx_hash: txHash,
    submitted_at: failedRequest.submittedAt,
    settlement: failedRequest.settlement
  });

  return {
    status: "failed" as const,
    request: failedRequest,
    message
  };
}

async function keepCrossChainRequestOpen(
  request: PaymentRequest,
  txHash: Hash,
  message: string,
  options: {
    retainHash: boolean;
    sourceChainIdInput?: unknown;
  }
) {
  const openRequest = buildRecoverableCrossChainOpenRequest(request, txHash, options);
  await updatePaymentRequest(openRequest);
  await insertQrEvent({
    request_id: openRequest.id,
    event_type: "submitted",
    status: "open",
    message,
    tx_hash: options.retainHash ? txHash : null,
    submitted_at: openRequest.submittedAt,
    settlement: openRequest.settlement
  });

  return {
    status: "open" as const,
    request: openRequest,
    message
  };
}

export function buildRecoverableCrossChainOpenRequest(
  request: PaymentRequest,
  txHash: Hash,
  options: {
    retainHash: boolean;
    sourceChainIdInput?: unknown;
  }
): PaymentRequest {
  return {
    ...request,
    status: "open",
    txHash: options.retainHash ? txHash : undefined,
    settlement: request.destinationChainId
      ? {
          ...request.settlement,
          destinationChainId: ARC_DESTINATION_CHAIN_ID,
          sourceChainId: isPaymentSourceChainId(options.sourceChainIdInput)
            ? options.sourceChainIdInput
            : request.settlement?.sourceChainId,
          sourceTxHash: options.retainHash ? txHash : undefined,
          stage: options.retainHash ? "submitted" : undefined,
          failureReason: undefined
        }
      : request.settlement
  };
}

async function keepCrossChainSettlementPending(
  request: PaymentRequest,
  sourcePayment: CrossChainSourcePayment,
  message: string
) {
  const pendingRequest: PaymentRequest = {
    ...request,
    status: "open",
    txHash: sourcePayment.sourceTxHash,
    settlement: {
      destinationChainId: ARC_DESTINATION_CHAIN_ID,
      sourceChainId: sourcePayment.sourceChainId,
      sourceTxHash: sourcePayment.sourceTxHash,
      sourceBlockNumber: sourcePayment.sourceBlockNumber,
      sourceLogIndex: sourcePayment.sourceLogIndex,
      stage: "settling",
      failureReason: message
    }
  };
  await updatePaymentRequest(pendingRequest, message);
  await insertQrEvent({
    request_id: pendingRequest.id,
    event_type: "settling",
    status: "open",
    message,
    tx_hash: sourcePayment.sourceTxHash,
    submitted_at: pendingRequest.submittedAt,
    settlement: pendingRequest.settlement
  });

  return {
    status: "open" as const,
    request: pendingRequest,
    message
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
    invoiceDate: readRequiredString(input, "invoiceDate")
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

function errorToFailureMessage(error: unknown): string {
  if (error instanceof HttpError || error instanceof Error) {
    return error.message;
  }
  return "Arc settlement failed.";
}

function isRecoverableCrossChainSourceError(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.statusCode !== 409) {
    return false;
  }

  return (
    error.message.includes("receipt is not available") ||
    error.message.includes("did not emit the expected cross-chain payment event") ||
    error.message.includes("not the QR pay transaction") ||
    error.message.includes("not sent to the configured QR payment contract") ||
    error.message.includes("missing its global log index")
  );
}

function shouldRetainRecoverableSourceHash(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }

  return error.message.includes("receipt is not available") || error.message.includes("missing its global log index");
}
