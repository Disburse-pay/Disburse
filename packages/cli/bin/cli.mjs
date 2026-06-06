#!/usr/bin/env node

/**
 * Disburse CLI
 *
 * Agent rails:
 *   disburse send --to 0x... --amount 10 --label "Invoice 1" --private-key $DISBURSE_PRIVATE_KEY
 *   disburse batch --csv payouts.csv --private-key $DISBURSE_PRIVATE_KEY
 */

import { resolve, dirname } from "node:path";
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
  --token <USDC|EURC>             Default token: USDC
  --private-key <0x...>           Or set DISBURSE_PRIVATE_KEY env var
  --out-dir <path>                Output directory for proofs + PDFs (default: cwd)
  --rpc <url>                     Custom Arc RPC
  --json                          Print machine-readable JSON to stdout
  --yes                           Skip any future confirmations
  --help, -h

Examples:
  DISBURSE_PRIVATE_KEY=0x... npx @disburse/cli send \
    --to 0x742d35Cc6634C0532925a3b844Bc9e7595f8fA4c \
    --amount 12.5 \
    --label "Invoice 1" \
    --note "Subscription - May 2026"

  DISBURSE_PRIVATE_KEY=0x... npx @disburse/cli batch --csv payouts.csv --json
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
const csvPath = getArg("csv");
const token = (getArg("token") || "USDC").toUpperCase();
const privateKey = getArg("private-key") || process.env.DISBURSE_PRIVATE_KEY;
const outDir = getArg("out-dir") || process.cwd();
const rpc = getArg("rpc");
const yes = args.includes("--yes");
const json = args.includes("--json");

function fail(message) {
  if (json) {
    console.log(JSON.stringify({ success: false, error: message }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
}

if (command === "send" && (!recipient || !amount || !label)) {
  fail("Missing required arguments: --recipient/--to, --amount, --label");
}
if (command === "batch" && !csvPath) {
  fail("Missing required argument: --csv <path>");
}
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  fail("Private key required via --private-key or DISBURSE_PRIVATE_KEY env var (0x + 64 hex chars).");
}
if (token !== "USDC" && token !== "EURC") {
  fail("token must be USDC or EURC");
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
  const result = command === "batch"
    ? await run({ csvPath, token, privateKey, outDir, rpc, yes, json })
    : await run({ recipient, amount, label, note, token, privateKey, outDir, rpc, yes, json });
  if (json) console.log(JSON.stringify(result, null, 2));
  process.exit(result?.success === false ? 1 : 0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
