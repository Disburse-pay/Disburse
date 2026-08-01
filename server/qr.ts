import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Hash, Hex, Log, TransactionReceipt } from "viem";
import { ARC_CHAIN_ID, publicClient, TOKENS } from "../src/lib/arc.js";
import { buildQrPaymentAuthorizationTypedData } from "../src/lib/qrAuthorization.js";
import {
  createExpiry,
  formatTokenAmount,
  makeReceipt,
  normalizeInvoiceDate,
  normalizeLabel,
  normalizeNote,
  parseTokenAmount,
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
  rowToPaymentRequest,
  rowToReceipt,
  type PaymentReceiptRow,
  type PaymentRequestRow,
  type QrStatusPayload
} from "../src/lib/realtime.js";
import { HttpError } from "./http.js";
import {
  PAYMENT_REQUESTS_PER_SENDER_TARGET_HOUR,
  PAYMENT_REQUESTS_PER_TARGET_HOUR,
  PAYMENT_REQUESTS_PER_WALLET_HOUR,
  notifyPaymentRequest,
  paymentRequestCapabilityAssociatedData,
  requireDisburseId,
  sealNotificationRequestToken,
  tryNotifyPaymentReceived,
  type AuthorizedPaymentRequestCreation
} from "./notifications.js";
import { getSupabaseAdmin } from "./supabase.js";
import { tryIssuePsp } from "./psp/hook.js";
import { verifyWalletTypedData } from "./wallet-auth.js";

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
  | { status: "rejected"; message: string };

type SubmittedReceipt = {
  logs: Log[];
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: Hash;
  blockTimestamp: bigint;
  transactionHash: Hash;
};

type StoredPaymentRequestRow = PaymentRequestRow & {
  request_token_hash?: string | null;
};

type AtomicMutationResult = {
  state?: string;
  request?: StoredPaymentRequestRow;
  receipt?: PaymentReceiptRow;
};

const REQUEST_TOKEN_BYTES = 32;

export async function createStoredQrRequest(
  input: Record<string, unknown>,
  creationAuth: AuthorizedPaymentRequestCreation
): Promise<QrStatusPayload & { requestToken: string }> {
  const createInput = readCreateQrRequestInput(input);

  // Resolve the notification target before persisting anything so an unknown
  // name fails the whole creation with a message the requester can act on.
  const notifyTarget = createInput.notify ? await requireDisburseId(createInput.notify) : undefined;

  const request = await buildServerArcSettlementQrRequest(createInput);
  const requestToken = randomBytes(REQUEST_TOKEN_BYTES).toString("hex");
  const requestTokenHash = hashRequestToken(requestToken);
  const capabilityEnvelope = sealNotificationRequestToken(
    requestToken,
    paymentRequestCapabilityAssociatedData(creationAuth.wallet, request.id)
  );
  const supabase = getSupabaseAdmin();
  const { data: createData, error } = await supabase.rpc("create_payment_request_atomic", {
    p_authorization_digest: creationAuth.authorizationDigest.toLowerCase(),
    p_sender_wallet: creationAuth.wallet.toLowerCase(),
    p_target_handle: creationAuth.notify || null,
    p_wallet_limit: PAYMENT_REQUESTS_PER_WALLET_HOUR,
    p_sender_target_limit: PAYMENT_REQUESTS_PER_SENDER_TARGET_HOUR,
    p_target_limit: PAYMENT_REQUESTS_PER_TARGET_HOUR,
    p_request_id: request.id,
    p_request_token_hash: requestTokenHash,
    p_capability_envelope: capabilityEnvelope,
    p_recipient: request.recipient,
    p_token: request.token,
    p_amount: request.amount,
    p_label: request.label,
    p_note: request.note ?? null,
    p_invoice_date: request.invoiceDate,
    p_start_block: request.startBlock
  });

  if (error) {
    throw new HttpError(503, "Payment request creation is temporarily unavailable.");
  }
  const createResult = readAtomicMutationResult(createData);
  if (createResult.state === "replay") {
    throw new HttpError(409, "This payment-request authorization was already used.");
  }
  if (createResult.state === "wallet_rate_limited") {
    throw new HttpError(429, "This wallet has created too many payment requests. Try again later.");
  }
  if (
    createResult.state === "target_rate_limited"
    || createResult.state === "sender_target_rate_limited"
  ) {
    throw new HttpError(429, "Too many payment requests were sent to this inbox. Try again later.");
  }
  if (createResult.state === "target_not_found") {
    throw new HttpError(404, "The requested Disburse ID no longer exists.");
  }
  if (createResult.state === "request_conflict") {
    throw new HttpError(409, "Payment request creation conflicted with an existing request.");
  }
  if (createResult.state !== "created" || !createResult.request) {
    throw new HttpError(500, "Payment request creation returned an invalid state.");
  }
  const storedRequest = rowToPaymentRequest(createResult.request);

  let notifiedHandle: string | undefined;
  if (notifyTarget) {
    try {
      const { data } = await supabase
        .from("disburse_ids")
        .select("handle")
        .eq("address", storedRequest.recipient.toLowerCase())
        .maybeSingle();
      await notifyPaymentRequest(
        notifyTarget.handle,
        { ...storedRequest, requestToken },
        (data as { handle: string } | null)?.handle
      );
      notifiedHandle = notifyTarget.handle;
    } catch {
      // Capability delivery is the irreversible part of creation. A
      // notification outage must never turn a successfully persisted request
      // into a 500 response that loses the only raw capability.
    }
  }

  return { request: storedRequest, requestToken, ...(notifiedHandle ? { notified: notifiedHandle } : {}) };
}

export async function readStoredQrStatus(requestId: string, requestToken: string): Promise<QrStatusPayload> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("get_qr_payment_status_atomic", {
    p_request_id: readRequestId(requestId),
    p_request_token_hash: hashRequestToken(readRequestToken(requestToken))
  });
  if (error) {
    throw new HttpError(503, "Payment request status is temporarily unavailable.");
  }
  const result = readAtomicMutationResult(data);
  if (result.state === "not_found") {
    throw new HttpError(404, "Payment request was not found.");
  }
  if (result.state === "forbidden" || result.state === "legacy_request") {
    throw new HttpError(403, "This QR request capability is invalid or no longer supported.");
  }
  if (result.state === "inconsistent") {
    throw new HttpError(409, "Payment state is inconsistent. Contact support before relying on this invoice.");
  }
  if (result.state !== "snapshot" || !result.request) {
    throw new HttpError(500, "Payment status returned an invalid state.");
  }
  const request = rowToPaymentRequest(result.request);
  const receipt = result.receipt ? rowToReceipt(result.receipt) : undefined;
  return {
    request,
    ...(receipt ? { receipt } : {})
  };
}

export async function recordStoredQrSubmission(
  requestId: string,
  txHash: Hash,
  requestToken: string,
  authorization: Hex,
  payerInput: string
): Promise<QrStatusPayload> {
  const request = await readPaymentRequest(requestId, requestToken);
  let payer: `0x${string}`;
  try {
    payer = validateRecipient(payerInput);
  } catch {
    throw new HttpError(400, "A valid payer address is required.");
  }
  const authorized = await verifyWalletTypedData({
    ...buildQrPaymentAuthorizationTypedData(request, payer),
    address: payer,
    signature: authorization
  });
  if (!authorized) {
    throw new HttpError(403, "The payer did not authorize this invoice.");
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("record_qr_submission_atomic", {
    p_request_id: requestId,
    p_request_token_hash: hashRequestToken(requestToken),
    p_tx_hash: txHash
  });
  if (error) {
    throw mapQrMutationError(error);
  }

  const result = readAtomicMutationResult(data);
  if (result.state === "not_found" || !result.request) {
    throw new HttpError(404, "Payment request was not found.");
  }
  if (result.state === "paid") {
    throw new HttpError(409, "This QR payment request is already paid.");
  }
  if (result.state === "expired") {
    throw new HttpError(409, "This QR payment request is no longer payable.");
  }
  if (result.state === "forbidden" || result.state === "legacy_request") {
    throw new HttpError(403, "This QR request capability is invalid or no longer supported.");
  }
  if (result.state === "submission_conflict") {
    throw new HttpError(409, "A different transaction was already submitted for this invoice.");
  }
  if (result.state !== "submitted" && result.state !== "already_submitted") {
    throw new HttpError(409, "Payment submission could not be recorded.");
  }

  const submittedRequest = rowToPaymentRequest(result.request);
  const submittedAt = submittedRequest.submittedAt;

  return {
    request: submittedRequest,
    event: {
      request_id: submittedRequest.id,
      event_type: "submitted",
      status: submittedRequest.status,
      message: "Payment submitted. Waiting for on-chain confirmation.",
      tx_hash: txHash,
      submitted_at: submittedAt ?? null
    }
  };
}

export async function confirmStoredQrPayment(
  requestId: string,
  txHash: Hash,
  requestToken: string,
  authorization: Hex
) {
  const request = await readPaymentRequest(requestId, requestToken);

  if (request.status === "paid") {
    const receipt = await readPaymentReceipt(request.id);
    if (!receipt) {
      throw new HttpError(409, "Payment state is incomplete. Contact support before relying on this invoice.");
    }
    if (receipt.txHash.toLowerCase() !== txHash.toLowerCase()) {
      throw new HttpError(409, "This invoice was confirmed by a different transaction.");
    }
    return {
      status: "paid" as const,
      request,
      receipt,
      message: "Payment already confirmed."
    };
  }

  let transactionReceipt: TransactionReceipt;
  try {
    transactionReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    throw new HttpError(409, "Transaction receipt is not available yet.");
  }
  if (transactionReceipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
    throw new HttpError(409, "Transaction receipt does not match the submitted transaction.");
  }

  let blockTimestamp: bigint;
  try {
    const block = await publicClient.getBlock({ blockHash: transactionReceipt.blockHash });
    if (
      !block.hash
      || block.hash.toLowerCase() !== transactionReceipt.blockHash.toLowerCase()
      || block.number !== transactionReceipt.blockNumber
    ) {
      throw new Error("Block evidence mismatch.");
    }
    blockTimestamp = block.timestamp;
  } catch {
    throw new HttpError(503, "The transaction block is temporarily unavailable. Try confirmation again.");
  }
  const resolution = resolveSubmittedReceiptConfirmation(request, {
    logs: transactionReceipt.logs,
    status: transactionReceipt.status,
    blockNumber: transactionReceipt.blockNumber,
    blockHash: transactionReceipt.blockHash,
    blockTimestamp,
    transactionHash: transactionReceipt.transactionHash
  });

  if (resolution.status === "rejected") {
    // A caller-supplied bad transaction is an invalid attempt, not an invoice
    // state transition. Keeping it non-terminal prevents QR-link sabotage.
    throw new HttpError(409, resolution.message);
  }

  const receipt = resolution.receipt;
  const authorized = await verifyWalletTypedData({
    ...buildQrPaymentAuthorizationTypedData(request, receipt.from),
    address: receipt.from,
    signature: authorization
  });
  if (!authorized) {
    throw new HttpError(403, "The payer did not authorize this transaction for this invoice.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("confirm_qr_payment_atomic", {
    p_request_id: request.id,
    p_request_token_hash: hashRequestToken(requestToken),
    p_tx_hash: receipt.txHash,
    p_payer: receipt.from,
    p_recipient: receipt.to,
    p_token: receipt.token,
    p_amount: receipt.amount,
    p_block_number: receipt.blockNumber,
    p_block_hash: receipt.blockHash,
    p_settlement_log_index: receipt.directSettlementLogIndex,
    p_confirmed_at: receipt.confirmedAt,
    p_explorer_url: receipt.explorerUrl,
    p_chain_id: ARC_CHAIN_ID
  });
  if (error) {
    throw mapQrMutationError(error);
  }

  const result = readAtomicMutationResult(data);
  if (result.state === "not_found") {
    throw new HttpError(404, "Payment request was not found.");
  }
  if (result.state === "forbidden" || result.state === "legacy_request") {
    throw new HttpError(403, "This QR request capability is invalid or no longer supported.");
  }
  if (result.state === "inconsistent") {
    throw new HttpError(409, "Payment state is inconsistent. Contact support before relying on this invoice.");
  }
  if (result.state === "transaction_claimed") {
    throw new HttpError(409, "This transaction already confirms another invoice.");
  }
  if (result.state === "request_conflict") {
    throw new HttpError(409, "This invoice was confirmed by a different transaction.");
  }
  if (result.state === "request_mismatch") {
    throw new HttpError(409, "The confirmed transfer does not match this invoice.");
  }
  if (result.state === "outside_payment_window") {
    throw new HttpError(409, "The transaction falls outside this invoice's payment window.");
  }
  if (
    (result.state !== "confirmed" && result.state !== "already_confirmed")
    || !result.request
    || !result.receipt
  ) {
    throw new HttpError(500, "Payment confirmation returned an invalid state.");
  }

  const paidRequest = rowToPaymentRequest(result.request);
  const storedReceipt = rowToReceipt(result.receipt);
  const pspUid = result.state === "confirmed" ? await tryIssuePsp(paidRequest, storedReceipt) : undefined;
  if (result.state === "confirmed") {
    await tryNotifyPaymentReceived(paidRequest, storedReceipt);
  }

  return {
    status: "paid" as const,
    request: paidRequest,
    receipt: storedReceipt,
    message: result.state === "confirmed" ? resolution.message : "Payment already confirmed.",
    ...(pspUid ? { psp_uid: pspUid } : {})
  };
}

export function resolveSubmittedReceiptConfirmation(
  request: PaymentRequest,
  receipt: SubmittedReceipt
): ConfirmationResolution {
  if (receipt.status === "reverted") {
    return {
      status: "rejected",
      message: "The submitted transaction reverted on Arc Testnet."
    };
  }

  const transfers = receipt.logs
    .filter(
      (log) =>
        log.address.toLowerCase() === TOKENS[request.token].address.toLowerCase()
        && log.transactionHash?.toLowerCase() === receipt.transactionHash.toLowerCase()
        && log.blockNumber === receipt.blockNumber
        && log.blockHash?.toLowerCase() === receipt.blockHash.toLowerCase()
        && log.removed !== true
        && Number.isSafeInteger(log.logIndex)
        && (log.logIndex ?? -1) >= 0
    )
    .map((log) => decodeTransferLog(log as unknown as TransferLog))
    .filter(
      (transfer): transfer is DecodedTransfer =>
        Boolean(
          transfer
          && transfer.txHash.toLowerCase() === receipt.transactionHash.toLowerCase()
          && transfer.blockNumber === receipt.blockNumber
          && Number.isSafeInteger(transfer.logIndex)
          && (transfer.logIndex ?? -1) >= 0
        )
    );

  const exactTransfers = transfers.filter((transfer) => transferMatchesRequest(request, transfer));
  if (exactTransfers.length > 1) {
    return {
      status: "rejected",
      message: "The transaction contains multiple indistinguishable payment transfers."
    };
  }
  const exact = exactTransfers[0];
  if (exact && exact.logIndex !== undefined) {
    if (exact.blockNumber < BigInt(request.startBlock)) {
      return {
        status: "rejected",
        message: "The transaction predates this QR request."
      };
    }

    const confirmedAt = new Date(Number(receipt.blockTimestamp) * 1_000);
    const expiresAt = request.expiresAt ?? request.dueAt;
    if (
      !Number.isFinite(confirmedAt.getTime())
      || (expiresAt && confirmedAt.getTime() > new Date(expiresAt).getTime())
    ) {
      return {
        status: "rejected",
        message: "The transaction falls outside this QR request's payment window."
      };
    }

    return {
      status: "paid",
      receipt: {
        ...makeReceipt(request, exact),
        blockHash: receipt.blockHash,
        directSettlementLogIndex: exact.logIndex,
        confirmedAt: confirmedAt.toISOString()
      },
      message: "Payment confirmed. Invoice is ready."
    };
  }

  const recipientTransfer = transfers.find((transfer) => transfer.to.toLowerCase() === request.recipient.toLowerCase());
  if (recipientTransfer) {
    return {
      status: "rejected",
      message: "A transfer reached the requester, but the amount does not match this QR request."
    };
  }

  return {
    status: "rejected",
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

export function readRequestToken(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new HttpError(401, "A valid QR request capability is required.");
  }
  return value.toLowerCase();
}

export function readPaymentAuthorization(value: unknown): Hex {
  const byteLength =
    typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value)
      ? (value.length - 2) / 2
      : 0;
  if (typeof value !== "string" || byteLength < 64 || byteLength > 2_048) {
    throw new HttpError(400, "A valid payer authorization signature is required.");
  }
  return value as Hex;
}

async function buildServerArcSettlementQrRequest(input: CreateQrRequestInput): Promise<PaymentRequest> {
  if (input.token !== "USDC") {
    throw new HttpError(400, "QR payments currently support USDC only.");
  }
  const createdAt = new Date().toISOString();
  let latestBlock: bigint;
  try {
    latestBlock = await publicClient.getBlockNumber();
  } catch {
    throw new HttpError(503, "Arc block height is unavailable. Try creating the request again.");
  }

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
    // The latest block was already sealed before this request existed. Starting
    // at the next block prevents any historical or same-height replay.
    startBlock: (latestBlock + 1n).toString(),
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

async function readPaymentRequest(requestId: string, requestToken: string): Promise<PaymentRequest> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("payment_requests").select("*").eq("id", readRequestId(requestId)).maybeSingle();

  if (error) {
    throw new HttpError(500, "Payment request could not be loaded.");
  }
  if (!data) {
    throw new HttpError(404, "Payment request was not found.");
  }

  const row = data as StoredPaymentRequestRow;
  assertRequestToken(row.request_token_hash, requestToken);
  return rowToPaymentRequest(row);
}

async function readPaymentReceipt(requestId: string): Promise<Receipt | undefined> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("payment_receipts").select("*").eq("request_id", readRequestId(requestId)).maybeSingle();

  if (error) {
    throw new HttpError(500, "Payment receipt could not be loaded.");
  }

  return data ? rowToReceipt(data as PaymentReceiptRow) : undefined;
}

function readRequiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `Missing ${key}.`);
  }
  return value;
}

function hashRequestToken(requestToken: string): string {
  return createHash("sha256").update(requestToken, "utf8").digest("hex");
}

function assertRequestToken(expectedHash: string | null | undefined, requestTokenInput: string) {
  const requestToken = readRequestToken(requestTokenInput);
  if (!expectedHash || !/^[0-9a-f]{64}$/.test(expectedHash)) {
    throw new HttpError(410, "This legacy QR request must be recreated before it can be accessed.");
  }

  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(hashRequestToken(requestToken), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(403, "QR request capability is invalid.");
  }
}

function readAtomicMutationResult(value: unknown): AtomicMutationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(500, "QR payment mutation returned an invalid response.");
  }
  return value as AtomicMutationResult;
}

function mapQrMutationError(error: { code?: string; message?: string }): HttpError {
  if (error.code === "23505") {
    return new HttpError(409, "This transaction already confirms another invoice.");
  }
  if (error.code === "22023") {
    return new HttpError(400, "QR payment mutation input is invalid.");
  }
  return new HttpError(500, "QR payment mutation failed.");
}
