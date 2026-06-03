/**
 * Backfill PSPs for paid payment_requests that never got one issued.
 *
 * Run with: node --env-file=.env.local --import tsx scripts/backfill-psp.ts
 *
 * Read+write. Idempotent — issuePsp() upserts on request_id, so re-running
 * is safe. Failures per-request are logged and the loop continues.
 *
 * Requires the same env as the server: ENABLE_PSP=1, DISBURSE_PSP_SIGNING_KEY,
 * ARC_SETTLEMENT_CONTRACT, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL.
 */

import { getSupabaseAdmin } from "../server/supabase.js";
import { issuePsp } from "../server/psp/issue.js";
import {
  rowToPaymentRequest,
  rowToReceipt,
  type PaymentReceiptRow,
  type PaymentRequestRow,
} from "../src/lib/realtime.js";

if (process.env.ENABLE_PSP !== "1" || !process.env.DISBURSE_PSP_SIGNING_KEY) {
  console.error(
    "Refusing to run: ENABLE_PSP must be '1' and DISBURSE_PSP_SIGNING_KEY must be set."
  );
  process.exit(1);
}

const supabase = getSupabaseAdmin();

// 1) Find all paid requests with no PSP row.
const { data: paidRows, error: paidErr } = await supabase
  .from("payment_requests")
  .select("*")
  .eq("status", "paid");
if (paidErr) throw paidErr;
if (!paidRows || paidRows.length === 0) {
  console.log("No paid requests found.");
  process.exit(0);
}

const { data: pspRows, error: pspErr } = await supabase
  .from("psp_documents")
  .select("request_id")
  .in(
    "request_id",
    paidRows.map((r) => r.id)
  );
if (pspErr) throw pspErr;

const haveIds = new Set((pspRows ?? []).map((r) => r.request_id));
const missing = paidRows.filter((r) => !haveIds.has(r.id));

console.log(
  `Paid: ${paidRows.length}.  Already have PSP: ${haveIds.size}.  Missing: ${missing.length}.`
);
if (missing.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

// 2) Backfill each missing request.
let ok = 0;
let failed = 0;

for (const row of missing) {
  const id = row.id as string;
  try {
    const request = rowToPaymentRequest(row as PaymentRequestRow);

    const { data: receiptRow, error: rErr } = await supabase
      .from("payment_receipts")
      .select("*")
      .eq("request_id", id)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!receiptRow) {
      throw new Error("no payment_receipts row");
    }
    const receipt = rowToReceipt(receiptRow as PaymentReceiptRow);

    const { psp, isNew } = await issuePsp({
      kind: "payment",
      request,
      receipt,
    });
    console.log(
      `  ${isNew ? "ISSUED " : "EXISTED"}  ${id}  →  ${psp.uid}  (${row.label ?? "no label"})`
    );
    ok += 1;
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAILED   ${id}  →  ${msg}`);
  }
}

console.log("─".repeat(60));
console.log(`Done. issued/existing=${ok}  failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
