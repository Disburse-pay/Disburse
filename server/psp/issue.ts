/**
 * PSP — Issuance
 *
 * Builds and persists a Portable Settlement Proof. Idempotent on the
 * variant-specific key (request_id for payments, market_claim_id for market
 * claims). Called after the underlying event reaches terminal state.
 *
 * Failures are non-fatal to the parent flow — they are logged but never
 * roll back a confirmed payment or a successful claim.
 */

import { formatUnits, type Address, type Hex } from "viem";
import { ARC_CHAIN_ID } from "../../src/lib/arc.js";
import { isRemotePaymentSourceChainId } from "../../src/lib/crosschain.js";
import { isCrossChainPaymentRequest, type PaymentRequest, type Receipt } from "../../src/lib/payments.js";
import type { Market, MarketClaim } from "../../src/lib/markets/types.js";
import { buildSignedPsp } from "../../src/lib/psp/sign.js";
import type { NetworkMode, PspCore, PspV1 } from "../../src/lib/psp/types.js";
import {
  readCrossChainSettlementLog,
  readDirectSettlementLog,
  readMarketClaimLog,
  readSourcePaymentLog,
} from "./fetchLogs.js";
import { getSupabaseAdmin } from "../supabase.js";
import { HttpError } from "../http.js";

// ---------- Configuration ----------

const PSP_ISSUER_NAME = "Disburse";
const PSP_ISSUER_URL = "https://disburse.app";

// USDC decimals on Arc. Shares and payouts in the markets system are stored
// as decimal strings in the same 1e6 base so they format consistently here.
const USDC_DECIMALS = 6;

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
 * Discriminated context for PSP issuance.
 *
 * - `payment`: terminal-state PaymentRequest + Receipt. Persisted with the
 *   request_id idempotency key.
 * - `market_claim`: indexed MarketClaim + parent Market context. Persisted
 *   with the market_claim_id idempotency key.
 */
export type IssueContext =
  | { kind: "payment"; request: PaymentRequest; receipt: Receipt }
  | { kind: "market_claim"; claim: MarketClaim; market: Market };

/**
 * Issue a PSP for a payment or a market-claim event. Idempotent on the
 * variant-specific key.
 */
export async function issuePsp(ctx: IssueContext): Promise<IssuePspResult> {
  if (ctx.kind === "payment") {
    return issuePaymentPsp(ctx.request, ctx.receipt);
  }
  return issueMarketClaimPsp(ctx.claim, ctx.market);
}

// ---------- Payment issuance (existing v1 path) ----------

async function issuePaymentPsp(
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
  // Cross-chain settlement (a QrPaymentSettled event on the Arc settlement
  // contract) only happens when funds originate on a genuinely *remote* source
  // chain. arc_settlement requests paid directly on Arc (source == dest == Arc)
  // settle with a plain USDC Transfer instead, so they must be read with
  // readDirectSettlementLog. isCrossChainPaymentRequest() is true for both, so
  // it alone is not enough — gate on the source actually being a remote chain.
  const isCrossChain =
    isCrossChainPaymentRequest(request) &&
    receipt.sourceTxHash !== undefined &&
    isRemotePaymentSourceChainId(receipt.sourceChainId);

  // Fetch settlement log from Arc
  const { settlement } = isCrossChain
    ? await readCrossChainSettlementLog(receipt, getSettlementContract())
    : await readDirectSettlementLog(receipt, request);

  // Fetch source log if cross-chain
  let source: PspCore["source"];
  if (
    isCrossChain &&
    isRemotePaymentSourceChainId(receipt.sourceChainId) &&
    receipt.sourceTxHash
  ) {
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

// ---------- Market-claim issuance (v1.1) ----------

async function issueMarketClaimPsp(
  claim: MarketClaim,
  market: Market
): Promise<IssuePspResult> {
  // Market must be resolved before a claim can yield a PSP — without a winning
  // outcome, the PspMarketClaim block is incoherent. Fail loud rather than
  // silently writing a malformed proof.
  if (market.winningOutcome === undefined || market.status !== "resolved") {
    throw new HttpError(
      400,
      `Cannot issue market-claim PSP: market ${market.id} is not resolved`
    );
  }

  if (!market.resolvesAt) {
    throw new HttpError(
      400,
      `Cannot issue market-claim PSP: market ${market.id} has no resolvesAt timestamp`
    );
  }

  const supabase = getSupabaseAdmin();

  // Idempotency lookup keyed on market_claim_id (parallel to request_id for
  // payment PSPs). The schema's CHECK constraint guarantees these two columns
  // are mutually exclusive.
  const { data: existing } = await supabase
    .from("psp_documents")
    .select("document")
    .eq("market_claim_id", claim.id)
    .maybeSingle();

  if (existing?.document) {
    return { psp: existing.document as unknown as PspV1, isNew: false };
  }

  const signingKey = getPspSigningKey();
  const networkMode = getNetworkMode();

  // Fetch and validate the MarketClaimed log against the on-chain tx.
  const { settlement } = await readMarketClaimLog(claim, market.onchainAddress);

  const { privateKeyToAccount } = await import("viem/accounts");
  const issuerAccount = privateKeyToAccount(signingKey);

  // payoutMicros is stored as a number in 1e6 base; render the human form
  // ("5.00") for the PSP, while sharesRedeemed stays at base scale per spec.
  const payoutAmount = formatUnits(BigInt(claim.payoutMicros), USDC_DECIMALS);

  const core: PspCore = {
    version: 1,
    networkMode,
    issuer: {
      name: PSP_ISSUER_NAME,
      url: PSP_ISSUER_URL,
      publicKey: issuerAccount.address,
    },
    marketClaim: {
      marketId: claim.marketId,
      onchainMarket: market.onchainAddress,
      question: market.question,
      outcome: claim.outcome,
      winningOutcome: market.winningOutcome,
      sharesRedeemed: claim.sharesMicros.toString(),
      payoutAmount,
      resolvedAt: market.resolvesAt,
    },
    settlement: {
      ...settlement,
      chainId: ARC_CHAIN_ID,
    },
  };

  const psp = await buildSignedPsp(core, signingKey);

  const { error: insertError } = await supabase.from("psp_documents").upsert(
    {
      uid: psp.uid,
      market_claim_id: claim.id,
      network_mode: networkMode,
      digest: psp.digest,
      document: psp as unknown as Record<string, unknown>,
      issuer_public_key: issuerAccount.address.toLowerCase(),
      signature: psp.signature.value,
      created_at: psp.createdAt,
    },
    { onConflict: "market_claim_id" }
  );

  if (insertError) {
    throw new HttpError(500, `Failed to persist PSP: ${insertError.message}`);
  }

  // Stamp the claim row with the new PSP UID so the frontend can subscribe
  // to `market_claims` realtime and surface the proof immediately. Non-fatal:
  // the PSP itself is already persisted and discoverable via market_claim_id.
  try {
    await supabase
      .from("market_claims")
      .update({ psp_uid: psp.uid })
      .eq("id", claim.id);
  } catch {
    // Non-fatal — PSP is the source of truth; the psp_uid column is a cache.
  }

  return { psp, isNew: true };
}

// ---------- Reads ----------

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

/**
 * Read an existing PSP by market-claim ID. Mirrors readPspByRequestId for the
 * market-claim variant.
 */
export async function readPspByMarketClaimId(
  marketClaimId: string
): Promise<PspV1 | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("psp_documents")
    .select("document")
    .eq("market_claim_id", marketClaimId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, error.message);
  }

  return data?.document ? (data.document as unknown as PspV1) : null;
}
