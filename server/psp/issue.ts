/**
 * PSP — Issuance
 *
 * Builds and persists a Portable Settlement Proof for a confirmed/settled
 * payment request. Idempotent: if a PSP already exists for the request,
 * returns it without re-issuing.
 *
 * Called after the payment reaches terminal state (direct confirm or
 * cross-chain settle). Failures are non-fatal — they are logged but never
 * roll back the payment.
 */

import type { Address, Hex } from "viem";
import { ARC_CHAIN_ID } from "../../src/lib/arc.js";
import { isCrossChainPaymentRequest, type PaymentRequest, type Receipt } from "../../src/lib/payments.js";
import { buildSignedPsp } from "../../src/lib/psp/sign.js";
import type { NetworkMode, PspCore, PspV1 } from "../../src/lib/psp/types.js";
import { readCrossChainSettlementLog, readDirectSettlementLog, readSourcePaymentLog } from "./fetchLogs.js";
import { getSupabaseAdmin } from "../supabase.js";
import { HttpError } from "../http.js";

// ---------- Configuration ----------

const PSP_ISSUER_NAME = "Disburse";
const PSP_ISSUER_URL = "https://disburse.app";

function getPspSigningKey(): Hex {
  const key = process.env.DISBURSE_PSP_SIGNING_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("DISBURSE_PSP_SIGNING_KEY is not configured or invalid.");
  }
  return key as Hex;
}

function getNetworkMode(): NetworkMode {
  return (process.env.PSP_NETWORK_MODE as NetworkMode) || "testnet";
}

function getSettlementContract(): Address {
  const addr = process.env.ARC_SETTLEMENT_CONTRACT;
  if (!addr) {
    throw new Error("ARC_SETTLEMENT_CONTRACT is not configured.");
  }
  return addr as Address;
}

// ---------- Public API ----------

export type IssuePspResult = {
  psp: PspV1;
  isNew: boolean;
};

/**
 * Issue a PSP for a payment request. Idempotent.
 *
 * @param request - The confirmed/settled payment request
 * @param receipt - The payment receipt (from payment_receipts)
 * @returns The PSP document and whether it was newly created
 */
export async function issuePsp(
  request: PaymentRequest,
  receipt: Receipt
): Promise<IssuePspResult> {
  const supabase = getSupabaseAdmin();

  // Check for existing PSP (idempotent)
  const { data: existing } = await supabase
    .from("psp_documents")
    .select("document")
    .eq("request_id", request.id)
    .maybeSingle();

  if (existing?.document) {
    return { psp: existing.document as unknown as PspV1, isNew: false };
  }

  // Build the PSP
  const signingKey = getPspSigningKey();
  const networkMode = getNetworkMode();
  const isCrossChain = isCrossChainPaymentRequest(request) &&
    receipt.sourceChainId !== undefined &&
    receipt.sourceTxHash !== undefined;

  // Fetch settlement log from Arc
  const { settlement } = isCrossChain
    ? await readCrossChainSettlementLog(receipt, getSettlementContract())
    : await readDirectSettlementLog(receipt, request);

  // Fetch source log if cross-chain
  let source: PspCore["source"];
  if (isCrossChain && receipt.sourceChainId && receipt.sourceTxHash) {
    const sourceContract = process.env[
      `SOURCE_CONTRACT_${receipt.sourceChainId}`
    ] as Address | undefined;

    if (sourceContract) {
      const { source: sourceLog } = await readSourcePaymentLog(
        receipt.sourceTxHash,
        receipt.sourceChainId,
        sourceContract
      );
      source = sourceLog;
    }
  }

  // Derive issuer address from signing key
  const { privateKeyToAccount } = await import("viem/accounts");
  const issuerAccount = privateKeyToAccount(signingKey);

  const core: PspCore = {
    version: 1,
    networkMode,
    issuer: {
      name: PSP_ISSUER_NAME,
      url: PSP_ISSUER_URL,
      publicKey: issuerAccount.address,
    },
    invoice: {
      requestId: request.id,
      label: request.label,
      invoiceDate: request.invoiceDate,
      note: request.note,
      payer: receipt.from,
      recipient: receipt.to,
      token: request.token,
      amount: request.amount,
    },
    settlement,
    ...(source ? { source } : {}),
  };

  // Sign and build the full PSP document
  const psp = await buildSignedPsp(core, signingKey);

  // Persist to database
  const { error: insertError } = await supabase.from("psp_documents").upsert(
    {
      uid: psp.uid,
      request_id: request.id,
      network_mode: networkMode,
      digest: psp.digest,
      document: psp as unknown as Record<string, unknown>,
      issuer_public_key: issuerAccount.address.toLowerCase(),
      signature: psp.signature.value,
      created_at: psp.createdAt,
    },
    { onConflict: "request_id" }
  );

  if (insertError) {
    throw new HttpError(500, `Failed to persist PSP: ${insertError.message}`);
  }

  // Log the event (non-fatal if this fails)
  try {
    await supabase.from("payment_request_events").insert({
      request_id: request.id,
      event_type: "psp_issue",
      status: request.status,
      message: `Portable Settlement Proof issued: ${psp.uid}`,
      tx_hash: receipt.txHash,
    });
  } catch {
    // Non-fatal — PSP was persisted successfully
  }

  return { psp, isNew: true };
}

/**
 * Read an existing PSP by UID.
 */
export async function readPspByUid(uid: string): Promise<PspV1 | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("psp_documents")
    .select("document")
    .eq("uid", uid)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, error.message);
  }

  return data?.document ? (data.document as unknown as PspV1) : null;
}

/**
 * Read an existing PSP by payment request ID.
 */
export async function readPspByRequestId(requestId: string): Promise<PspV1 | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("psp_documents")
    .select("document")
    .eq("request_id", requestId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, error.message);
  }

  return data?.document ? (data.document as unknown as PspV1) : null;
}
