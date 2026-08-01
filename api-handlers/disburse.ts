import { createHash } from "node:crypto";
import {
  assertMethod,
  HttpError,
  readJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../server/http.js";
import { issuePsp } from "../server/psp/issue.js";
import { getSupabaseAdmin } from "../server/supabase.js";
import { ARC_CHAIN_ID, publicClient, TOKENS } from "../src/lib/arc.js";
import {
  ARC_GATEWAY_DOMAIN,
  GATEWAY_MINTER_ADDRESS
} from "../src/lib/gateway/types.js";
import {
  decodeTransferLog,
  formatTokenAmount,
  isPaymentToken,
  makeReceipt,
  normalizeInvoiceDate,
  normalizeLabel,
  normalizeNote,
  parseTokenAmount,
  validateRecipient,
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
  type PaymentRequestRow
} from "../src/lib/realtime.js";
import { buildDisburseRegistrationTypedData } from "../src/lib/directRegistration.js";
import { readWalletSignature, verifyWalletTypedData } from "../server/wallet-auth.js";
import { enforceRedisRateLimit } from "../server/rate-limit.js";
import { decodeEventLog, getAddress, keccak256, toBytes, type Address, type Hash, type Hex } from "viem";

const GATEWAY_ATTESTATION_USED_EVENT = {
  type: "event" as const,
  name: "AttestationUsed" as const,
  inputs: [
    { name: "token", type: "address", indexed: true },
    { name: "recipient", type: "address", indexed: true },
    { name: "transferSpecHash", type: "bytes32", indexed: true },
    { name: "sourceDomain", type: "uint32", indexed: false },
    { name: "sourceDepositor", type: "bytes32", indexed: false },
    { name: "sourceSigner", type: "bytes32", indexed: false },
    { name: "value", type: "uint256", indexed: false }
  ]
} as const;
const GATEWAY_ATTESTATION_USED_SELECTOR = keccak256(
  toBytes("AttestationUsed(address,address,bytes32,uint32,bytes32,bytes32,uint256)")
);

export {
  buildDisburseRegistrationTypedData,
  DIRECT_REGISTRATION_TYPES,
  type DisburseRegistrationInput
} from "../src/lib/directRegistration.js";

/**
 * POST /api/disburse
 *
 * Register a direct (non-QR) USDC/EURC disbursement that has already been
 * executed on Arc Testnet and obtain a signed Portable Settlement Proof (PSP).
 *
 * This makes full Invoice + PSP artifacts available for direct wallet-to-wallet
 * payments (agent rails, CLI usage, accounting, etc.), not only QR flows.
 *
 * Request body:
 * {
 *   txHash: "0x...",           // required, the Arc tx containing the Transfer
 *   label: "Invoice 1",        // required, human label for the invoice/PSP
 *   note?: "Subscription",     // optional
 *   invoiceDate?: "2026-05-01",// optional YYYY-MM-DD
 *   token?: "USDC" | "EURC",   // optional, default USDC
 *   recipient: "0x...",         // required, transfer recipient
 *   amount: "25",               // required, human token amount
 *   signature: "0x..."          // required, signed by transfer payer
 * }
 *
 * The handler:
 * - Fetches the tx receipt on Arc.
 * - Locates the ERC-20 Transfer log for the token.
 * - Verifies amount > 0, valid addresses, and payer metadata authorization.
 * - Builds a deterministic UUID PaymentRequest from the tx hash for idempotency
 *   and Receipt using the provided label/note.
 * - Calls the existing issuePsp machinery (reuses readDirectSettlementLog,
 *   buildSignedPsp, DB persistence with the DISBURSE_PSP_SIGNING_KEY).
 *
 * Response: 200 { psp: PspV1, requestId, txHash, ... }
 * Errors: 400 for bad input / no matching transfer; 500 for issuance config issues.
 *
 * Public endpoint. The on-chain transfer is the source of truth, and the payer
 * must sign the label/note registration payload to prevent proof poisoning.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");

    const body = readJsonBody(request);

    const txHash = (body.txHash as string | undefined)?.trim();
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      sendJson(response, 400, { error: "txHash must be a valid 0x hex transaction hash." });
      return;
    }

    const labelInput = (body.label as string | undefined) ?? "";
    if (!labelInput.trim()) {
      sendJson(response, 400, { error: "label is required." });
      return;
    }

    const noteInput = (body.note as string | undefined) ?? undefined;
    const invoiceDateInput = (body.invoiceDate as string | undefined) ?? undefined;
    const tokenInput = ((body.token as string | undefined) ?? "USDC").toUpperCase() as PaymentToken;
    const railInput = body.rail === undefined ? "direct" : body.rail;

    if (!isPaymentToken(tokenInput)) {
      sendJson(response, 400, { error: 'token must be "USDC" or "EURC".' });
      return;
    }
    if (railInput !== "direct" && railInput !== "gateway") {
      sendJson(response, 400, { error: 'rail must be "direct" or "gateway".' });
      return;
    }
    const rail: "direct" | "gateway" = railInput;
    if (rail === "gateway" && tokenInput !== "USDC") {
      sendJson(response, 400, { error: "Circle Gateway registration currently supports USDC only." });
      return;
    }

    // Required for disambiguation and payer authorization.
    const hintRecipient = (body.recipient as string | undefined)?.trim();
    const hintAmount = (body.amount as string | undefined)?.trim();
    const signatureInput = (body.signature as string | undefined)?.trim();
    if (!hintRecipient || !hintAmount || !signatureInput) {
      sendJson(response, 400, { error: "recipient, amount, and signature are required." });
      return;
    }
    const signature = readWalletSignature(
      signatureInput,
      400,
      "signature must be a valid bounded hex wallet signature."
    );

    // Fetch and decode on-chain
    const txReceipt = await publicClient.getTransactionReceipt({ hash: txHash as Hash });
    if (txReceipt.status !== "success") {
      throw new HttpError(409, "The disbursement transaction reverted.");
    }
    if (txReceipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
      throw new HttpError(409, "The transaction receipt does not match the requested hash.");
    }

    const token = TOKENS[tokenInput];
    const tokenAddrLower = token.address.toLowerCase();

    const decodedTransfers: DecodedTransfer[] = rail === "gateway"
      ? txReceipt.logs
          .map((log) => decodeGatewayAttestationTransfer(log, txReceipt, token.address))
          .filter((transfer): transfer is DecodedTransfer => Boolean(transfer))
      : txReceipt.logs
          .filter(
            (log) =>
              log.address.toLowerCase() === tokenAddrLower
              && log.transactionHash?.toLowerCase() === txReceipt.transactionHash.toLowerCase()
              && log.blockNumber === txReceipt.blockNumber
              && log.blockHash?.toLowerCase() === txReceipt.blockHash.toLowerCase()
              && log.removed !== true
              && Number.isSafeInteger(log.logIndex)
              && (log.logIndex ?? -1) >= 0
          )
          .map((log) => decodeTransferLog(log as unknown as TransferLog))
          .filter(
            (transfer): transfer is DecodedTransfer =>
              Boolean(
                transfer
                && transfer.txHash.toLowerCase() === txHash.toLowerCase()
                && transfer.blockNumber === txReceipt.blockNumber
                && Number.isSafeInteger(transfer.logIndex)
                && (transfer.logIndex ?? -1) >= 0
              )
          );

    if (decodedTransfers.length === 0) {
      sendJson(response, 400, {
        error: rail === "gateway"
          ? `No exact Circle Gateway AttestationUsed event found in transaction ${txHash}.`
          : `No ${tokenInput} Transfer log found in transaction ${txHash}.`
      });
      return;
    }

    const hintTo = readClientValue(() => validateRecipient(hintRecipient));
    const hintValue = readClientValue(() => parseTokenAmount(hintAmount, tokenInput));
    const matchingTransfers = decodedTransfers.filter(
      (t) => t.to.toLowerCase() === hintTo.toLowerCase() && t.value === hintValue
    );
    if (matchingTransfers.length > 1) {
      sendJson(response, 409, {
        error: "The transaction contains multiple indistinguishable matching transfers."
      });
      return;
    }
    const chosen = matchingTransfers[0];

    if (!chosen || chosen.logIndex === undefined) {
      sendJson(response, 400, { error: "Could not select a matching transfer from the transaction." });
      return;
    }

    // Build normalized request / receipt (reusing existing helpers)
    const amountStr = formatTokenAmount(chosen.value, tokenInput);

    const label = readClientValue(() => normalizeLabel(labelInput));
    const note = noteInput ? readClientValue(() => normalizeNote(noteInput)) : undefined;
    let invoiceDate: string | undefined;
    if (invoiceDateInput) {
      invoiceDate = readClientValue(() => normalizeInvoiceDate(invoiceDateInput));
    }

    const authInput = {
      txHash: txHash as Hash,
      rail,
      token: tokenInput,
      recipient: chosen.to,
      amount: amountStr,
      label,
      note,
      invoiceDate
    };
    const isAuthorized = await verifyWalletTypedData({
      ...buildDisburseRegistrationTypedData(authInput),
      address: chosen.from,
      signature
    });
    if (!isAuthorized) {
      sendJson(response, 401, { error: "signature must be produced by the transfer payer." });
      return;
    }
    await enforceRedisRateLimit("direct_register", chosen.from);

    const nowIso = new Date().toISOString();
    const requestId = directRequestIdFromTxHash(txHash as Hash);

    const directRequest: PaymentRequest = {
      id: requestId,
      recipient: chosen.to,
      token: tokenInput,
      amount: amountStr,
      label,
      note,
      invoiceDate,
      createdAt: nowIso,
      startBlock: txReceipt.blockNumber.toString(),
      status: "paid",
      txHash: txHash as Hash
    };

    const directReceipt: Receipt = {
      ...makeReceipt(directRequest, chosen),
      directSettlementLogIndex: chosen.logIndex,
      blockHash: txReceipt.blockHash,
      confirmedAt: await readBlockTimestamp(txReceipt.blockHash, txReceipt.blockNumber)
    };

    const storedPayment = await upsertDirectPayment(directRequest, directReceipt);

    // Issue (or return existing) PSP via the canonical path.
    // This will:
    // - Use readDirectSettlementLog (direct Arc Transfer case)
    // - Sign with DISBURSE_PSP_SIGNING_KEY (must be configured + ENABLE_PSP not strictly required here)
    // - Persist under request_id for capability-authenticated lookup and UID lookup
    const { psp } = await issuePsp({
      kind: "payment",
      request: storedPayment.request,
      receipt: storedPayment.receipt
    });

    sendJson(response, 200, {
      psp,
      request: storedPayment.request,
      receipt: storedPayment.receipt,
      requestId,
      txHash,
      explorer: `${"https://testnet.arcscan.app"}/tx/${txHash}`
    });
  } catch (error) {
    sendError(response, error);
  }
}

function decodeGatewayAttestationTransfer(
  log: {
    address: Address;
    blockHash: Hash | null;
    blockNumber: bigint | null;
    data: Hex;
    logIndex: number | null;
    removed?: boolean;
    topics: [] | [Hex, ...Hex[]];
    transactionHash: Hash | null;
  },
  receipt: {
    blockHash: Hash;
    blockNumber: bigint;
    transactionHash: Hash;
  },
  token: Address
): DecodedTransfer | undefined {
  if (
    log.address.toLowerCase() !== GATEWAY_MINTER_ADDRESS.toLowerCase()
    || log.transactionHash?.toLowerCase() !== receipt.transactionHash.toLowerCase()
    || log.blockNumber !== receipt.blockNumber
    || log.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase()
    || log.removed === true
    || !Number.isSafeInteger(log.logIndex)
    || (log.logIndex ?? -1) < 0
    || log.topics[0]?.toLowerCase() !== GATEWAY_ATTESTATION_USED_SELECTOR.toLowerCase()
  ) {
    return undefined;
  }
  try {
    const decoded = decodeEventLog({
      abi: [GATEWAY_ATTESTATION_USED_EVENT],
      eventName: "AttestationUsed",
      data: log.data,
      topics: log.topics
    });
    const args = decoded.args;
    const depositor = addressFromGatewayBytes32(args.sourceDepositor);
    const signer = addressFromGatewayBytes32(args.sourceSigner);
    if (
      args.token.toLowerCase() !== token.toLowerCase()
      || args.sourceDomain !== ARC_GATEWAY_DOMAIN
      || depositor.toLowerCase() !== signer.toLowerCase()
    ) {
      return undefined;
    }
    return {
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      logIndex: log.logIndex ?? undefined,
      from: depositor,
      to: getAddress(args.recipient),
      value: args.value
    };
  } catch {
    return undefined;
  }
}

function addressFromGatewayBytes32(value: Hex): Address {
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("Gateway event contains a non-EVM account identifier.");
  }
  return getAddress(`0x${value.slice(-40)}`);
}

function readClientValue<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid disbursement input.");
  }
}

async function readBlockTimestamp(blockHash: Hash, blockNumber: bigint): Promise<string> {
  const block = await publicClient.getBlock({ blockHash });
  if (
    !block.hash
    || block.hash.toLowerCase() !== blockHash.toLowerCase()
    || block.number !== blockNumber
  ) {
    throw new HttpError(409, "The disbursement block evidence does not match its receipt.");
  }
  const timestamp = Number(block.timestamp) * 1_000;
  if (!Number.isFinite(timestamp)) {
    throw new HttpError(503, "The disbursement block timestamp is unavailable.");
  }
  return new Date(timestamp).toISOString();
}

export function directRequestIdFromTxHash(txHash: Hash): string {
  const bytes = createHash("sha256").update(`disburse:direct:${txHash.toLowerCase()}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function upsertDirectPayment(
  request: PaymentRequest,
  receipt: Receipt
): Promise<{ request: PaymentRequest; receipt: Receipt }> {
  if (
    !receipt.blockHash
    || receipt.directSettlementLogIndex === undefined
  ) {
    throw new HttpError(500, "Direct payment evidence is incomplete.");
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("record_direct_payment_atomic", {
    p_request_id: request.id,
    p_tx_hash: receipt.txHash,
    p_payer: receipt.from,
    p_recipient: receipt.to,
    p_token: receipt.token,
    p_amount: receipt.amount,
    p_label: request.label,
    p_note: request.note ?? null,
    p_invoice_date: request.invoiceDate ?? null,
    p_block_number: receipt.blockNumber,
    p_block_hash: receipt.blockHash,
    p_settlement_log_index: receipt.directSettlementLogIndex,
    p_confirmed_at: receipt.confirmedAt,
    p_explorer_url: receipt.explorerUrl,
    p_chain_id: ARC_CHAIN_ID
  });
  if (error) {
    throw new HttpError(500, "Failed to persist the direct payment atomically.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(500, "Direct payment persistence returned an invalid state.");
  }
  const result = data as {
    state?: string;
    request?: PaymentRequestRow;
    receipt?: PaymentReceiptRow;
  };
  if (result.state === "transaction_claimed") {
    throw new HttpError(409, "This transaction already confirms another invoice.");
  }
  if (result.state === "request_conflict") {
    throw new HttpError(409, "This transaction is already registered with different invoice metadata.");
  }
  if (
    (result.state !== "recorded" && result.state !== "already_recorded")
    || !result.request
    || !result.receipt
  ) {
    throw new HttpError(500, "Direct payment persistence returned an invalid state.");
  }
  return {
    request: rowToPaymentRequest(result.request),
    receipt: rowToReceipt(result.receipt)
  };
}
