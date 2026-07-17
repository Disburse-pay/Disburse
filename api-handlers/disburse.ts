import { createHash } from "node:crypto";
import { assertMethod, HttpError, readJsonBody, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { issuePsp } from "../server/psp/issue.js";
import { getSupabaseAdmin } from "../server/supabase.js";
import {
  publicClient,
  TOKENS
} from "../src/lib/arc.js";
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
import { paymentRequestToRow, receiptToRow } from "../src/lib/realtime.js";
import { DISBURSE_TYPED_DOMAIN } from "../src/lib/ids.js";
import { verifyMessage, verifyTypedData, type Address, type Hash, type Hex } from "viem";

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

    if (!isPaymentToken(tokenInput)) {
      sendJson(response, 400, { error: 'token must be "USDC" or "EURC".' });
      return;
    }

    // Required for disambiguation and payer authorization.
    const hintRecipient = (body.recipient as string | undefined)?.trim();
    const hintAmount = (body.amount as string | undefined)?.trim();
    const signature = (body.signature as string | undefined)?.trim() as Hex | undefined;
    if (!hintRecipient || !hintAmount || !signature) {
      sendJson(response, 400, { error: "recipient, amount, and signature are required." });
      return;
    }
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      sendJson(response, 400, { error: "signature must be a valid 65-byte hex signature." });
      return;
    }

    // Fetch and decode on-chain
    const txReceipt = await publicClient.getTransactionReceipt({ hash: txHash as Hash });

    const token = TOKENS[tokenInput];
    const tokenAddrLower = token.address.toLowerCase();

    const decodedTransfers: DecodedTransfer[] = txReceipt.logs
      .filter((log) => log.address.toLowerCase() === tokenAddrLower)
      .map((log) => decodeTransferLog(log as unknown as TransferLog))
      .filter((d): d is DecodedTransfer => Boolean(d));

    if (decodedTransfers.length === 0) {
      sendJson(response, 400, {
        error: `No ${tokenInput} Transfer log found in transaction ${txHash}.`
      });
      return;
    }

    const hintTo = readClientValue(() => validateRecipient(hintRecipient));
    const hintValue = readClientValue(() => parseTokenAmount(hintAmount, tokenInput));
    const chosen = decodedTransfers.find(
      (t) =>
        t.to.toLowerCase() === hintTo.toLowerCase() &&
        t.value === hintValue
    );

    if (!chosen) {
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
      token: tokenInput,
      recipient: chosen.to,
      amount: amountStr,
      label,
      note
    };
    let isAuthorized = await verifyTypedData({
      ...buildDisburseRegistrationTypedData(authInput),
      address: chosen.from,
      signature
    }).catch(() => false);
    if (!isAuthorized) {
      // Deprecated: plaintext scheme signed by @disburse/cli <= 0.2.0. It has
      // no domain or chain binding; new clients must sign the typed data.
      isAuthorized = await verifyMessage({
        address: chosen.from,
        message: buildDisburseAuthorizationMessage(authInput),
        signature
      }).catch(() => false);
    }
    if (!isAuthorized) {
      sendJson(response, 401, { error: "signature must be produced by the transfer payer." });
      return;
    }

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
      directSettlementLogIndex: chosen.logIndex
    };

    await upsertDirectPayment(directRequest, directReceipt);

    // Issue (or return existing) PSP via the canonical path.
    // This will:
    // - Use readDirectSettlementLog (direct Arc Transfer case)
    // - Sign with DISBURSE_PSP_SIGNING_KEY (must be configured + ENABLE_PSP not strictly required here)
    // - Persist under request_id for /api/psp?request_id=... and uid lookup
    const { psp } = await issuePsp({ kind: "payment", request: directRequest, receipt: directReceipt });

    sendJson(response, 200, {
      psp,
      requestId,
      txHash,
      explorer: `${"https://testnet.arcscan.app"}/tx/${txHash}`
    });
  } catch (error) {
    sendError(response, error);
  }
}

function readClientValue<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid disbursement input.");
  }
}

export function directRequestIdFromTxHash(txHash: Hash): string {
  const bytes = createHash("sha256").update(`disburse:direct:${txHash.toLowerCase()}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type DisburseRegistrationInput = {
  txHash: Hash;
  token: PaymentToken;
  recipient: Address;
  amount: string;
  label: string;
  note?: string;
};

export const DIRECT_REGISTRATION_TYPES = {
  DirectPspRegistration: [
    { name: "txHash", type: "bytes32" },
    { name: "token", type: "string" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "string" },
    { name: "label", type: "string" },
    { name: "note", type: "string" }
  ]
} as const;

/**
 * EIP-712 payload authorizing PSP registration of a direct transfer. Bound to
 * the Disburse domain (app name + Arc chain id) so the signature verifies
 * nowhere else. No expiry: the message is bound to a specific txHash and
 * registration is idempotent, so replay gains nothing.
 */
export function buildDisburseRegistrationTypedData(input: DisburseRegistrationInput) {
  return {
    domain: DISBURSE_TYPED_DOMAIN,
    types: DIRECT_REGISTRATION_TYPES,
    primaryType: "DirectPspRegistration",
    message: {
      txHash: input.txHash.toLowerCase() as Hash,
      token: input.token,
      // Lowercase so viem's strict checksum validation accepts any input
      // casing; EIP-712 hashes the address value, so casing never changes
      // the signature.
      recipient: input.recipient.toLowerCase() as Address,
      amount: input.amount,
      label: input.label,
      note: input.note ?? ""
    }
  } as const;
}

/** @deprecated Legacy plaintext scheme kept only to verify signatures from @disburse/cli <= 0.2.0. */
export function buildDisburseAuthorizationMessage(input: DisburseRegistrationInput): string {
  return [
    "Disburse direct PSP registration",
    `txHash: ${input.txHash.toLowerCase()}`,
    `token: ${input.token}`,
    `recipient: ${input.recipient.toLowerCase()}`,
    `amount: ${input.amount}`,
    `label: ${input.label}`,
    `note: ${input.note ?? ""}`
  ].join("\n");
}

async function upsertDirectPayment(request: PaymentRequest, receipt: Receipt) {
  const supabase = getSupabaseAdmin();
  const { data: existingRequest, error: readError } = await supabase
    .from("payment_requests")
    .select("recipient, token, amount, label, note, invoice_date, tx_hash")
    .eq("id", request.id)
    .maybeSingle();

  if (readError) {
    throw new HttpError(500, `Failed to read direct request: ${readError.message}`);
  }

  if (existingRequest) {
    const existing = existingRequest as {
      recipient: string;
      token: string;
      amount: string;
      label: string;
      note: string | null;
      invoice_date: string | null;
      tx_hash: string | null;
    };

    const matchesExisting =
      existing.recipient.toLowerCase() === request.recipient.toLowerCase() &&
      existing.token === request.token &&
      existing.amount === request.amount &&
      existing.label === request.label &&
      (existing.note ?? undefined) === request.note &&
      (existing.invoice_date ?? undefined) === request.invoiceDate &&
      existing.tx_hash?.toLowerCase() === request.txHash?.toLowerCase();

    if (!matchesExisting) {
      throw new HttpError(409, "This transaction is already registered with different invoice metadata.");
    }
  }

  if (!existingRequest) {
    const { error: requestError } = await supabase
      .from("payment_requests")
      .insert(paymentRequestToRow(request));

    if (requestError) {
      throw new HttpError(500, `Failed to persist direct request: ${requestError.message}`);
    }
  }

  const { error: receiptError } = await supabase
    .from("payment_receipts")
    .upsert(receiptToRow(receipt), { onConflict: "request_id" });

  if (receiptError) {
    throw new HttpError(500, `Failed to persist direct receipt: ${receiptError.message}`);
  }
}
