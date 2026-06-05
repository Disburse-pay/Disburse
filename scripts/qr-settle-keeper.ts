/**
 * QR settlement keeper — finishes cross-chain (Monad/Base → Arc) payments.
 *
 * Cross-chain confirm returns "settling" the moment a Polymer proof is requested
 * (the proof takes 2–5 min — longer than a serverless function may run). This
 * keeper polls those pending requests and, once a proof is ready, submits
 * settle() on Arc and issues the PSP. So settlement completes reliably even if
 * the payer closed the page.
 *
 * Requires the same env as the server: SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL,
 * POLYMER_TESTNET_API_KEY, ARC_RELAYER_PRIVATE_KEY, ARC_QR_PAYMENT_SETTLEMENT /
 * ARC_SETTLEMENT_CONTRACT, ENABLE_PSP, DISBURSE_PSP_SIGNING_KEY.
 *
 * Usage:
 *   # one-shot (cron-friendly): one tick, then exit
 *   node --env-file=.env.local --import tsx scripts/qr-settle-keeper.ts
 *
 *   # daemon (systemd): loop every QR_SETTLE_INTERVAL_MS (default 15s)
 *   QR_SETTLE_KEEPER_LOOP=1 node --env-file=.env.local --import tsx scripts/qr-settle-keeper.ts
 */
import process from "node:process";
import { settleStoredCrossChainQrPayments } from "../server/qr.js";

const LOOP = Boolean(process.env.QR_SETTLE_KEEPER_LOOP);
const INTERVAL_MS = Number(process.env.QR_SETTLE_INTERVAL_MS ?? 15_000);

async function tick(): Promise<void> {
  try {
    const result = await settleStoredCrossChainQrPayments();
    if (result.processed > 0) {
      console.log(`[qr-settle-keeper] processed=${result.processed} settled=${result.settled}`);
    }
  } catch (error) {
    console.error("[qr-settle-keeper] tick failed:", error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  if (!LOOP) {
    await tick();
    return;
  }
  console.log(`[qr-settle-keeper] daemon started (interval ${INTERVAL_MS}ms)`);
  for (;;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
