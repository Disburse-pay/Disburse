/**
 * One-shot PSP diagnostic. Read-only.
 *
 * Run with: node --env-file=.env.local scripts/diagnose-psp.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function line() {
  console.log("─".repeat(72));
}

// 1) Total PSPs issued, with newest few.
{
  const { count, error } = await supabase
    .from("psp_documents")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("psp_documents count failed:", error.message);
  } else {
    console.log(`PSPs issued (all-time): ${count}`);
  }
}

line();

// 2) Sample one paid row to discover schema.
{
  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("schema probe failed:", error.message);
  } else if (data && data.length) {
    console.log("payment_requests columns (newest paid row):");
    for (const k of Object.keys(data[0]).sort()) {
      const v = data[0][k];
      const repr =
        v === null
          ? "null"
          : typeof v === "object"
            ? JSON.stringify(v).slice(0, 120)
            : String(v).slice(0, 80);
      console.log(`  ${k.padEnd(28)} = ${repr}`);
    }
  }
}

line();

// 3) Classify recent paid requests as direct vs cross-chain.
{
  const { data: paid, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("paid lookup failed:", error.message);
  } else if (paid && paid.length) {
    let cross = 0;
    let direct = 0;
    console.log("Recent paid requests (direct vs cross-chain):");
    for (const row of paid) {
      const settlement =
        row.settlement ??
        row.cross_chain_settlement ??
        row.destination_settlement ??
        null;
      const isCross =
        Boolean(row.destination_chain_id) ||
        Boolean(row.source_chain_id) ||
        Boolean(settlement?.sourceChainId) ||
        Boolean(settlement?.destinationChainId);
      if (isCross) cross += 1;
      else direct += 1;
      console.log(
        `  ${row.created_at}  ${isCross ? "CROSS" : "DIRECT"}  id=${row.id}  label=${row.label ?? "-"}`
      );
    }
    line();
    console.log(`Totals: direct=${direct}  cross-chain=${cross}`);
  }
}

line();
console.log("Done.");
