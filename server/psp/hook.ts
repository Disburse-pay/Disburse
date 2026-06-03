/**
 * PSP — Feature-flagged issuance hook
 *
 * Called after a payment or market claim reaches terminal state. Non-fatal:
 * any failure is logged but never propagated to the parent flow.
 *
 * Gated on: process.env.ENABLE_PSP === "1"
 */

import type { Market, MarketClaim } from "../../src/lib/markets/types.js";
import type { PaymentRequest, Receipt } from "../../src/lib/payments.js";
import { issuePsp } from "./issue.js";
import { triggerWebhooks } from "../webhooks.js";
import { getSupabaseAdmin } from "../supabase.js";

function pspEnabled(): boolean {
  return (
    process.env.ENABLE_PSP === "1" &&
    Boolean(process.env.DISBURSE_PSP_SIGNING_KEY)
  );
}

/**
 * Attempt to issue a PSP for a confirmed/settled payment. Returns the PSP
 * UID if successful, undefined otherwise. Silently returns undefined if:
 * - The feature flag is off
 * - The signing key is not configured
 * - Any error occurs during issuance
 */
export async function tryIssuePsp(
  request: PaymentRequest,
  receipt: Receipt
): Promise<string | undefined> {
  if (!pspEnabled()) {
    return undefined;
  }

  try {
    const { psp } = await issuePsp({ kind: "payment", request, receipt });

    // Fire webhooks in the background (non-blocking, non-fatal)
    triggerWebhooks(psp as unknown as Record<string, unknown>).catch((err) => {
      console.error(`[PSP] Webhook delivery error for ${psp.uid}:`, err instanceof Error ? err.message : err);
    });

    return psp.uid;
  } catch (error) {
    // Non-fatal — log and continue.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[PSP] Failed to issue PSP for request ${request.id}:`, message);

    // Leave a queryable trace so a "pending" PSP (none issued yet) is
    // distinguishable from one that actively failed, with the reason attached.
    // Best-effort: never let observability disturb the confirmed payment.
    try {
      await getSupabaseAdmin().from("payment_request_events").insert({
        request_id: request.id,
        event_type: "psp_error",
        status: request.status,
        message: `PSP issuance failed: ${message}`,
        tx_hash: receipt.txHash,
      });
    } catch {
      // Swallow — the console line above is the fallback signal.
    }

    return undefined;
  }
}

/**
 * Attempt to issue a PSP for an on-chain market claim. Mirrors `tryIssuePsp`
 * for the market_claim variant of `IssueContext` — non-fatal, same gating,
 * same webhook fanout. Returns the PSP UID on success.
 */
export async function tryIssueMarketClaimPsp(
  claim: MarketClaim,
  market: Market
): Promise<string | undefined> {
  if (!pspEnabled()) {
    return undefined;
  }

  try {
    const { psp } = await issuePsp({ kind: "market_claim", claim, market });

    triggerWebhooks(psp as unknown as Record<string, unknown>).catch((err) => {
      console.error(
        `[PSP] Webhook delivery error for ${psp.uid}:`,
        err instanceof Error ? err.message : err
      );
    });

    return psp.uid;
  } catch (error) {
    console.error(
      `[PSP] Failed to issue PSP for market claim ${claim.id}:`,
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}
