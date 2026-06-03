#!/usr/bin/env node
/**
 * Apply the missing apply_market_position_delta function to Supabase.
 * Uses the Supabase client's rpc to execute raw SQL via a temporary function.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://rbnhpoqhwepfnuyktsjj.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

// Read the migration SQL
const sql = readFileSync(
  resolve(__dirname, "..", "supabase", "migrations", "202605200003_market_position_cache.sql"),
  "utf-8"
);

// Execute via fetch to Supabase's SQL endpoint
const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  },
  body: JSON.stringify({ query: sql }),
});

// If exec_sql doesn't exist, try the pg-meta endpoint
if (!resp.ok) {
  console.log("exec_sql not available, trying Supabase SQL API...");
  
  // Use the Supabase Management API to run SQL
  // The management API endpoint is at the project level
  const pgResp = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  
  if (!pgResp.ok) {
    console.log("pg/query also not available. Will use supabase CLI...");
    console.log("Status:", pgResp.status, await pgResp.text());
    
    // Last resort: use npx supabase db push
    console.log("\nRun this SQL manually in the Supabase SQL Editor:");
    console.log("---");
    console.log(sql);
    console.log("---");
  } else {
    console.log("Migration applied successfully via pg/query");
  }
} else {
  console.log("Migration applied successfully");
}
