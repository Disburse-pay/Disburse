/**
 * PSP — Feature-flagged issuance hook
 *
 * Called after a payment reaches terminal "paid" state. Non-fatal:
 * any failure is logged but never propagated to the payment flow.
 *
 * Gated on: process.env.ENABLE_PSP === "1"
 */

import type { PaymentRequest, Receipt } from "../../src/lib/payments.js";
import { issuePsp } from "./issue.js";
import { triggerWebhooks } from "../webhooks.js";

/**
 * Attempt to issue a PSP. Returns the PSP UID if successful, undefined otherwise.
 * Silently returns undefined if:
 * - The feature flag is off
 * - The signing key is not configured
 * - Any error occurs during issuance
 */
export async function tryIssuePsp(
  request: PaymentRequest,
  receipt: Receipt
): Promise<string | undefined> {
  if (process.env.ENABLE_PSP !== "1") {
    return undefined;
  }

  if (!process.env.DISBURSE_PSP_SIGNING_KEY) {
    return undefined;
  }

  try {
    const { psp } = await issuePsp(request, receipt);

    // Fire webhooks in the background (non-blocking, non-fatal)
    triggerWebhooks(psp as unknown as Record<string, unknown>).catch((err) => {
      console.error(`[PSP] Webhook delivery error for ${psp.uid}:`, err instanceof Error ? err.message : err);
    });

    return psp.uid;
  } catch (error) {
    // Non-fatal — log and continue
    console.error(
      `[PSP] Failed to issue PSP for request ${request.id}:`,
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}
