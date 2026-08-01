#!/usr/bin/env node

/**
 * Disburse CLI
 *
 * Agent rails:
 *   disburse send --to 0x... --amount 10 --label "Invoice 1"
 *   disburse batch --csv payouts.csv --dry-run
 *   (DISBURSE_PRIVATE_KEY is injected by a scoped secret store.)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function printHelp() {
  console.log(`
Disburse CLI — stablecoin disbursements with Invoice + PSP proofs

Usage:
  disburse send [options]
  disburse batch --csv payouts.csv [options]

Required for send:
  --recipient, --to <address>     Destination EVM address on Arc
  --amount <number>               Human amount, e.g. 25 or 0.5
  --label <text>                  Invoice label (shown on PDF + PSP)

Required for batch:
  --csv <path>                    CSV with to,amount,label,note,token columns

Optional:
  --note <text>                   Free-text note for single send
  --invoice-date <YYYY-MM-DD>     Optional invoice date for single send
  --token <USDC|EURC>             Default token: USDC
  --private-key-stdin             Read the private key from stdin (use with --yes or --dry-run)
  --out-dir <path>                Output directory for proofs + PDFs (default: cwd)
  --rpc <url>                     Custom Arc RPC
  --trusted-psp-issuer <0x...>    Trusted issuer for generated verification commands
  --json                          Print machine-readable JSON to stdout
  --dry-run                       Validate and preview without broadcasting
  --yes                           Skip the interactive confirmation after reviewing the command
  --help, -h

Examples:
  # DISBURSE_PRIVATE_KEY is already set by your scoped secret store.
  npx @disburse/cli send \
    --to 0x742d35Cc6634C0532925a3b844Bc9e7595f8fA4c \
    --amount 12.5 \
    --label "Invoice 1" \
    --note "Subscription - May 2026"

  secret-tool lookup service disburse | npx @disburse/cli batch \
    --private-key-stdin --csv payouts.csv --dry-run
`);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const command = args[0] === "batch" ? "batch" : "send";
if (args[0] !== "send" && args[0] !== "batch") {
  if (!args.includes("--to") && !args.includes("--recipient")) {
    console.error("Unknown command. Use: disburse send ..., disburse batch ..., or disburse --help");
    process.exit(1);
  }
}

function getArg(name, alias) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) return args[idx + 1];
  if (alias) {
    const aIdx = args.indexOf(`--${alias}`);
    if (aIdx !== -1 && args[aIdx + 1] && !args[aIdx + 1].startsWith("--")) return args[aIdx + 1];
  }
  return undefined;
}

const recipient = getArg("recipient", "to");
const amount = getArg("amount");
const label = getArg("label");
const note = getArg("note");
const invoiceDate = getArg("invoice-date");
const csvPath = getArg("csv");
const token = (getArg("token") || "USDC").toUpperCase();
const outDir = getArg("out-dir") || process.cwd();
const rpc = getArg("rpc");
const trustedPspIssuer = getArg("trusted-psp-issuer") || process.env.DISBURSE_TRUSTED_PSP_ISSUER;
const yes = args.includes("--yes");
const dryRun = args.includes("--dry-run");
const json = args.includes("--json");

function fail(message) {
  if (json) {
    console.log(JSON.stringify({ success: false, error: message }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
}

if (args.some((arg) => arg === "--private-key" || arg.startsWith("--private-key="))) {
  fail("--private-key is disabled because command-line arguments leak through process listings and shell history. Use DISBURSE_PRIVATE_KEY or --private-key-stdin.");
}
const readPrivateKeyFromStdin = args.includes("--private-key-stdin");
if (readPrivateKeyFromStdin && process.env.DISBURSE_PRIVATE_KEY) {
  fail("Choose one private-key source: DISBURSE_PRIVATE_KEY or --private-key-stdin.");
}
const privateKey = readPrivateKeyFromStdin
  ? readFileSync(0, "utf8").trim()
  : process.env.DISBURSE_PRIVATE_KEY;

if (command === "send" && (!recipient || !amount || !label)) {
  fail("Missing required arguments: --recipient/--to, --amount, --label");
}
if (command === "batch" && !csvPath) {
  fail("Missing required argument: --csv <path>");
}
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  fail("Private key required via DISBURSE_PRIVATE_KEY or --private-key-stdin (0x + 64 hex chars).");
}
if (token !== "USDC" && token !== "EURC") {
  fail("token must be USDC or EURC");
}
if (trustedPspIssuer && !/^0x[0-9a-fA-F]{40}$/.test(trustedPspIssuer)) {
  fail("--trusted-psp-issuer / DISBURSE_TRUSTED_PSP_ISSUER must be a valid 0x EVM address.");
}

const entry = resolve(__dirname, command === "batch" ? "../dist/batch.js" : "../dist/send.js");
let run;
try {
  const mod = await import(pathToFileURL(entry).href);
  run = command === "batch" ? mod.batch : mod.send;
} catch (e) {
  try {
    const devMod = await import(pathToFileURL(resolve(__dirname, command === "batch" ? "../src/batch.ts" : "../src/send.ts")).href);
    run = command === "batch" ? devMod.batch : devMod.send;
  } catch {
    fail(`Failed to load CLI implementation. Run npm run build in packages/cli. ${String(e)}`);
  }
}

if (typeof run !== "function") {
  fail(`CLI implementation missing exported ${command}()`);
}

try {
  const confirm = yes || dryRun ? undefined : confirmExecution;
  const result = command === "batch"
    ? await run({ csvPath, token, privateKey, outDir, rpc, yes, dryRun, confirm, trustedPspIssuer, json })
    : await run({ recipient, amount, label, note, invoiceDate, token, privateKey, outDir, rpc, yes, dryRun, confirm, trustedPspIssuer, json });
  if (json) console.log(JSON.stringify(result, null, 2));
  process.exit(result?.success === false ? 1 : 0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

async function confirmExecution(preview) {
  if (json || !process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error("Interactive confirmation needs a terminal. Review with --dry-run, then explicitly pass --yes for unattended use.");
  }

  console.error(formatPreview(preview));
  const expected = preview.kind === "batch" ? "BATCH" : "SEND";
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await readline.question(`Type ${expected} to broadcast: `);
    return answer.trim() === expected;
  } finally {
    readline.close();
  }
}

function formatPreview(preview) {
  if (preview.kind === "send") {
    return [
      "Review disbursement",
      `  Chain ID:  ${preview.chainId}`,
      `  From:      ${preview.payer}`,
      `  To:        ${preview.recipient}`,
      `  Token:     ${preview.amount} ${preview.token} (${preview.tokenAddress})`,
      `  Label:     ${preview.label}`,
      `  RPC:       ${preview.rpcUrl}`
    ].join("\n");
  }
  const totals = Object.entries(preview.totals)
    .map(([tokenName, tokenAmount]) => `${tokenAmount} ${tokenName}`)
    .join(", ");
  return [
    "Review batch disbursement",
    `  Chain ID:  ${preview.chainId}`,
    `  From:      ${preview.payer}`,
    `  Payments:  ${preview.paymentCount}`,
    `  Totals:    ${totals || "0"}`,
    ...preview.rows.map(
      (row) => `  Row ${row.row}: ${row.amount} ${row.token} -> ${row.recipient} (${row.label})`
    )
  ].join("\n");
}
