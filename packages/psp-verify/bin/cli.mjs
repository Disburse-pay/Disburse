#!/usr/bin/env node

/**
 * PSP Verify CLI
 *
 * A trusted issuer is mandatory. Supplying the issuer embedded in the PSP
 * itself is circular and does not establish authenticity.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);

function usage() {
  console.log(`
  psp-verify — Verify a Portable Settlement Proof against a trusted issuer

  Usage:
    psp-verify <file.json> --issuer 0x...
    cat proof.json | psp-verify --stdin --issuer 0x...

  Options:
    --issuer <address>   Required independently trusted issuer address
    --stdin              Read PSP JSON from stdin
    --help               Show this help

  Scope:
    This offline command verifies structure, digest, UID, and trusted-issuer
    signature. It reports settlement status as "not checked".

  Exit codes:
    0  Valid for the supplied trusted issuer
    1  Invalid, ambiguous arguments, or error
  `);
}

if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}
if (args.length === 0) {
  usage();
  process.exit(1);
}

const issuerIndexes = args
  .map((arg, index) => (arg === "--issuer" ? index : -1))
  .filter((index) => index !== -1);
if (issuerIndexes.length !== 1) {
  console.error("Error: Provide --issuer exactly once using an independently trusted address.");
  process.exit(1);
}

const issuerIndex = issuerIndexes[0];
const issuer = args[issuerIndex + 1];
if (!issuer || issuer.startsWith("--")) {
  console.error("Error: --issuer requires one EVM address.");
  process.exit(1);
}

const stdinCount = args.filter((arg) => arg === "--stdin").length;
if (stdinCount > 1) {
  console.error("Error: --stdin may be provided at most once.");
  process.exit(1);
}
const useStdin = stdinCount === 1;

const consumed = new Set([issuerIndex, issuerIndex + 1]);
const positionals = [];
for (let index = 0; index < args.length; index += 1) {
  if (consumed.has(index) || args[index] === "--stdin") {
    continue;
  }
  if (args[index].startsWith("--")) {
    console.error(`Error: Unknown option "${args[index]}".`);
    process.exit(1);
  }
  positionals.push(args[index]);
}

if (useStdin && positionals.length > 0) {
  console.error("Error: Do not provide a file path together with --stdin.");
  process.exit(1);
}
if (!useStdin && positionals.length !== 1) {
  console.error("Error: Provide exactly one PSP file path, or use --stdin.");
  process.exit(1);
}

let jsonContent;
if (useStdin) {
  jsonContent = readFileSync(0, "utf-8");
} else {
  try {
    jsonContent = readFileSync(resolve(positionals[0]), "utf-8");
  } catch (error) {
    console.error(`Error: Cannot read file "${positionals[0]}": ${error.message}`);
    process.exit(1);
  }
}

const { verifyJson } = await import("../dist/index.js");
const result = await verifyJson(jsonContent, { expectedIssuer: issuer });

if (!result.ok) {
  console.error(`✗ PSP verification failed: ${result.reason}\n`);
  process.exit(1);
}

console.log("✓ PSP is valid for the supplied trusted issuer");
console.log("  Settlement:  not checked (offline verification)\n");
console.log(`  Kind:        ${result.fields.kind}`);
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
