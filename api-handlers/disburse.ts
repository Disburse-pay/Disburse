import { assertMethod, readJsonBody, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { issuePsp } from "../server/psp/issue.js";
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
import type { Hash } from "viem";

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
 *   token?: "USDC" | "EURC"    // optional, default USDC
 * }
 *
 * The handler:
 * - Fetches the tx receipt on Arc.
 * - Locates the ERC-20 Transfer log for the token.
 * - Verifies amount > 0, valid addresses.
 * - Builds a synthetic PaymentRequest (id = `direct-${txHash}` for idempotency)
 *   and Receipt using the provided label/note.
 * - Calls the existing issuePsp machinery (reuses readDirectSettlementLog,
 *   buildSignedPsp, DB persistence with the DISBURSE_PSP_SIGNING_KEY).
 *
 * Response: 200 { psp: PspV1, requestId, txHash, ... }
 * Errors: 400 for bad input / no matching transfer; 500 for issuance config issues.
 *
 * Public (no auth). The on-chain transfer is the source of truth; label/note
 * are descriptive metadata asserted at registration time.
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

    // Optional hints for disambiguation / validation (if the tx has >1 transfer)
    const hintRecipient = (body.recipient as string | undefined)?.trim();
    const hintAmount = (body.amount as string | undefined)?.trim();

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

    // Pick the transfer. Prefer exact match on hint if provided.
    let chosen: DecodedTransfer | undefined;

    if (hintRecipient && hintAmount) {
      const hintTo = validateRecipient(hintRecipient);
      const hintValue = parseTokenAmount(hintAmount, tokenInput);
      chosen = decodedTransfers.find(
        (t) =>
          t.to.toLowerCase() === hintTo.toLowerCase() &&
          t.value === hintValue
      );
    }

    if (!chosen && hintRecipient) {
      const hintTo = validateRecipient(hintRecipient);
      chosen = decodedTransfers.find((t) => t.to.toLowerCase() === hintTo.toLowerCase());
    }

    if (!chosen) {
      // Default: take the first (typical single-transfer disbursement tx)
      chosen = decodedTransfers[0];
    }

    if (!chosen) {
      sendJson(response, 400, { error: "Could not select a matching transfer from the transaction." });
      return;
    }

    // Build normalized request / receipt (reusing existing helpers)
    const amountStr = formatTokenAmount(chosen.value, tokenInput);

    // Validate/normalize user metadata (throws on bad values -> 400 via sendError)
    const label = normalizeLabel(labelInput);
    const note = noteInput ? normalizeNote(noteInput) : undefined;
    let invoiceDate: string | undefined;
    if (invoiceDateInput) {
      invoiceDate = normalizeInvoiceDate(invoiceDateInput);
    }

    const nowIso = new Date().toISOString();
    const requestId = `direct-${txHash.toLowerCase()}`;

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

    const directReceipt: Receipt = makeReceipt(directRequest, chosen);

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


