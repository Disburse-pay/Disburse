#!/usr/bin/env node

/**
 * PSP Verify CLI
 *
 * Usage:
 *   psp-verify <file.json> [--issuer 0x...]
 *   cat proof.json | psp-verify --stdin [--issuer 0x...]
 *
 * Exit codes:
 *   0 = valid PSP
 *   1 = invalid PSP or error
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);

function usage() {
  console.log(`
  psp-verify — Verify a Disburse Portable Settlement Proof

  Usage:
    psp-verify <file.json> [--issuer 0x...]
    cat proof.json | psp-verify --stdin [--issuer 0x...]

  Options:
    --issuer <address>   Expected issuer address (optional extra check)
    --stdin              Read PSP JSON from stdin
    --help               Show this help

  Exit codes:
    0  Valid PSP
    1  Invalid PSP or error
  `);
}

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  usage();
  process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
}

const issuerIdx = args.indexOf("--issuer");
const issuer = issuerIdx !== -1 ? args[issuerIdx + 1] : undefined;
const useStdin = args.includes("--stdin");

let jsonContent;

if (useStdin) {
  jsonContent = readFileSync(0, "utf-8");
} else {
  const filePath = args.find((a) => !a.startsWith("--") && (issuerIdx === -1 || args.indexOf(a) !== issuerIdx + 1));
  if (!filePath) {
    console.error("Error: No file path provided. Use --stdin or pass a file path.");
    process.exit(1);
  }
  try {
    jsonContent = readFileSync(resolve(filePath), "utf-8");
  } catch (err) {
    console.error(`Error: Cannot read file "${filePath}": ${err.message}`);
    process.exit(1);
  }
}

// Dynamic import so the CLI works even before TS is compiled (uses dist/)
const { verifyJson } = await import("../dist/index.js");

const options = issuer ? { expectedIssuer: issuer } : undefined;
const result = await verifyJson(jsonContent, options);

if (result.ok) {
  console.log("✓ PSP is valid\n");
  console.log(`  Request ID:  ${result.fields.requestId}`);
  console.log(`  Payer:       ${result.fields.payer}`);
  console.log(`  Recipient:   ${result.fields.recipient}`);
  console.log(`  Token:       ${result.fields.token}`);
  console.log(`  Amount:      ${result.fields.amount}`);
  console.log(`  Chain:       ${result.fields.settlementChainId}`);
  console.log(`  Tx:          ${result.fields.settlementTxHash}`);
  console.log(`  Issuer:      ${result.fields.issuer}`);
  console.log(`  Network:     ${result.fields.networkMode}`);
  process.exit(0);
} else {
  console.error(`✗ PSP verification failed: ${result.reason}\n`);
  process.exit(1);
}
