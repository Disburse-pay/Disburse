import type { Hash } from "viem";
import type { PaymentRequest, PaymentStatus, PaymentToken, Receipt } from "./payments.js";
import {
  ARC_DESTINATION_CHAIN_ID,
  isPaymentSourceChainId,
  type PaymentSourceChainId,
  type CrossChainPaymentStage,
  type CrossChainPaymentState
} from "./crosschain.js";

export type QrRealtimeEventType =
  | "submitted"
  | "proving"
  | "settling"
  | "paid"
  | "failed"
  | "expired"
  | "psp_issue";

export type PaymentRequestRow = {
  id: string;
  mode?: string | null;
  recipient: string;
  token: PaymentToken;
  amount: string;
  label: string;
  note: string | null;
  invoice_date: string | null;
  expires_at: string | null;
  due_at: string | null;
  created_at: string;
  submitted_at: string | null;
  start_block: string;
  status: PaymentStatus;
  tx_hash: string | null;
  failure_reason: string | null;
  destination_chain_id?: number | null;
  allowed_source_chain_ids?: number[] | null;
  source_chain_id?: number | null;
  settlement_stage?: CrossChainPaymentStage | null;
  source_tx_hash?: string | null;
  source_block_number?: string | null;
  source_log_index?: number | null;
  proof_job_id?: string | null;
  destination_tx_hash?: string | null;
  destination_block_number?: string | null;
  updated_at?: string;
};

export type PaymentReceiptRow = {
  request_id: string;
  tx_hash: string;
  payer: string;
  recipient: string;
  token: PaymentToken;
  amount: string;
  block_number: string;
  confirmed_at: string;
  explorer_url: string;
  chain_id?: number | null;
  source_chain_id?: number | null;
  source_tx_hash?: string | null;
};

export type QrRealtimeEvent = {
  id?: number;
  request_id: string;
  event_type: QrRealtimeEventType;
  status: PaymentStatus;
  message: string;
  tx_hash?: string | null;
  submitted_at?: string | null;
  receipt?: Receipt | null;
  settlement?: CrossChainPaymentState | null;
  created_at?: string;
};

export type QrStatusPayload = {
  request: PaymentRequest;
  receipt?: Receipt;
  event?: QrRealtimeEvent;
  message?: string;
  psp_uid?: string;
};

export type AppliedQrEvent = {
  request: PaymentRequest;
  receipt?: Receipt;
  message: string;
};

export function paymentRequestToRow(request: PaymentRequest, failureReason?: string): PaymentRequestRow {
  return {
    id: request.id,
    recipient: request.recipient,
    token: request.token,
    amount: request.amount,
    label: request.label,
    note: request.note ?? null,
    invoice_date: request.invoiceDate ?? null,
    expires_at: request.expiresAt ?? null,
    due_at: request.dueAt ?? null,
    created_at: request.createdAt,
    submitted_at: request.submittedAt ?? null,
    start_block: request.startBlock,
    status: request.status,
    tx_hash: request.txHash ?? null,
    failure_reason: failureReason ?? null,
    mode: request.destinationChainId === ARC_DESTINATION_CHAIN_ID ? "arc_settlement" : "arc",
    destination_chain_id: request.destinationChainId ?? null,
    allowed_source_chain_ids: request.allowedSourceChainIds ?? null,
    source_chain_id: request.settlement?.sourceChainId ?? null,
    settlement_stage: request.settlement?.stage ?? null,
    source_tx_hash: request.settlement?.sourceTxHash ?? null,
    source_block_number: request.settlement?.sourceBlockNumber ?? null,
    source_log_index: request.settlement?.sourceLogIndex ?? null,
    proof_job_id: request.settlement?.proofJobId ?? null,
    destination_tx_hash: request.settlement?.destinationTxHash ?? null,
    destination_block_number: request.settlement?.destinationBlockNumber ?? null
  };
}

export function rowToPaymentRequest(row: PaymentRequestRow): PaymentRequest {
  const destinationChainId = row.destination_chain_id === ARC_DESTINATION_CHAIN_ID ? ARC_DESTINATION_CHAIN_ID : undefined;
  return {
    id: row.id,
    recipient: row.recipient as `0x${string}`,
    token: row.token,
    amount: row.amount,
    label: row.label,
    note: row.note ?? undefined,
    invoiceDate: row.invoice_date ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    dueAt: row.due_at ?? undefined,
    createdAt: row.created_at,
    submittedAt: row.submitted_at ?? undefined,
    startBlock: row.start_block,
    status: row.status,
    txHash: normalizeHash(row.tx_hash),
    destinationChainId,
    allowedSourceChainIds: normalizeCrossChainIdArray(row.allowed_source_chain_ids),
    settlement: destinationChainId
      ? {
          destinationChainId,
          sourceChainId: normalizeCrossChainId(row.source_chain_id),
          sourceTxHash: normalizeHash(row.source_tx_hash),
          sourceBlockNumber: row.source_block_number ?? undefined,
          sourceLogIndex: row.source_log_index ?? undefined,
          proofJobId: row.proof_job_id ?? undefined,
          destinationTxHash: normalizeHash(row.destination_tx_hash),
          destinationBlockNumber: row.destination_block_number ?? undefined,
          stage: normalizeSettlementStage(row.settlement_stage),
          failureReason: row.failure_reason ?? undefined
        }
      : undefined
  };
}

export function receiptToRow(receipt: Receipt): PaymentReceiptRow {
  return {
    request_id: receipt.requestId,
    tx_hash: receipt.txHash,
    payer: receipt.from,
    recipient: receipt.to,
    token: receipt.token,
    amount: receipt.amount,
    block_number: receipt.blockNumber,
    confirmed_at: receipt.confirmedAt,
    explorer_url: receipt.explorerUrl,
    chain_id: receipt.chainId ?? null,
    source_chain_id: receipt.sourceChainId ?? null,
    source_tx_hash: receipt.sourceTxHash ?? null
  };
}

export function rowToReceipt(row: PaymentReceiptRow): Receipt {
  return {
    requestId: row.request_id,
    txHash: row.tx_hash as Hash,
    from: row.payer as `0x${string}`,
    to: row.recipient as `0x${string}`,
    token: row.token,
    amount: row.amount,
    blockNumber: row.block_number,
    confirmedAt: row.confirmed_at,
    explorerUrl: row.explorer_url,
    chainId: row.chain_id ?? undefined,
    sourceChainId: normalizeCrossChainId(row.source_chain_id),
    sourceTxHash: normalizeHash(row.source_tx_hash)
  };
}

export function applyQrRealtimeEvent(request: PaymentRequest, event: QrRealtimeEvent): AppliedQrEvent {
  const receipt = normalizeReceipt(event.receipt);
  const clearsSubmittedHash = clearsRecoverableCrossChainHash(event);
  return {
    request: {
      ...request,
      status: event.status,
      txHash: normalizeHash(event.tx_hash) ?? receipt?.txHash ?? (clearsSubmittedHash ? undefined : request.txHash),
      submittedAt: event.submitted_at ?? request.submittedAt,
      settlement: event.settlement ?? request.settlement
    },
    receipt,
    message: event.message
  };
}

function clearsRecoverableCrossChainHash(event: QrRealtimeEvent): boolean {
  return (
    event.event_type === "submitted" &&
    event.status === "open" &&
    Boolean(event.settlement) &&
    !event.settlement?.sourceTxHash &&
    !event.settlement?.stage
  );
}

export function shouldHideQrForStatus(status: PaymentStatus): boolean {
  return status === "paid" || status === "failed" || status === "expired";
}

export function isFinalQrStatus(status: PaymentStatus): boolean {
  return shouldHideQrForStatus(status);
}

function normalizeHash(value: string | null | undefined): Hash | undefined {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    return undefined;
  }
  return value as Hash;
}

function normalizeReceipt(value: Receipt | null | undefined): Receipt | undefined {
  return value ?? undefined;
}

function normalizeCrossChainId(value: number | null | undefined): PaymentSourceChainId | undefined {
  return isPaymentSourceChainId(value) ? value : undefined;
}

function normalizeCrossChainIdArray(value: number[] | null | undefined): PaymentSourceChainId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ids = value.filter(isPaymentSourceChainId);
  return ids.length ? ids : undefined;
}

function normalizeSettlementStage(value: CrossChainPaymentStage | null | undefined): CrossChainPaymentStage | undefined {
  return value === "submitted" || value === "proving" || value === "settling" || value === "settled" || value === "failed"
    ? value
    : undefined;
}
