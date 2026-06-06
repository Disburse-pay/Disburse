#!/usr/bin/env node

/**
 * Disburse CLI
 *
 * Primary command for agent rails:
 *   disburse send --recipient 0x... --amount 10 --label "Invoice 1" --note "Subscription" \
 *     --private-key $DISBURSE_PRIVATE_KEY
 *
 * Produces:
 *   - On-chain ERC-20 transfer (Arc Testnet USDC/EURC)
 *   - proof.json (signed PSP from Disburse)
 *   - disburse-invoice-....pdf (with label, note, PSP digest footer)
 *
 * Verification:
 *   npx @disburse/psp-verify proof.json
 *
 * The CLI never logs private keys.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
Disburse CLI — direct stablecoin disbursements with Invoice + PSP proofs

Usage:
  disburse send [options]

Required:
  --recipient, --to <address>     Destination EVM address on Arc
  --amount <number>               Human amount, e.g. 25 or 0.5
  --label <text>                  Invoice label (shown on PDF + PSP)

Optional:
  --note <text>                   Free-text note for the invoice/PSP
  --token <USDC|EURC>             Default: USDC
  --private-key <0x...>           Or set DISBURSE_PRIVATE_KEY env var
  --out-dir <path>                Output directory for proof.json + PDF (default: cwd)
  --rpc <url>                     Custom Arc RPC (default: public endpoints)
  --yes                           Skip any future confirmations
  --help, -h

Examples:
  # Basic agent disbursement (recommended: use env var for the key)
  DISBURSE_PRIVATE_KEY=0x... npx @disburse/cli send \\
    --to 0x742d35Cc6634C0532925a3b844Bc9e7595f8fA4c \\
    --amount 12.5 \\
    --label "Invoice 1" \\
    --note "Subscription - May 2026"

  # With explicit key flag (avoid in shared logs / shell history)
  npx @disburse/cli send --to 0x... --amount 5 --label "Payout" --private-key 0x...

After success the CLI prints:
  • Transaction explorer link
  • Paths to proof.json and the PDF invoice
  • Exact command to independently verify the PSP with @disburse/psp-verify

The returned PSP is signed by Disburse and can be verified offline or on-chain.
`);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args[0] !== "send") {
  // Allow "disburse --to ..." as shorthand for send
  if (!args.includes("--to") && !args.includes("--recipient")) {
    console.error("Unknown command. Use: disburse send ...  or  disburse --help");
    process.exit(1);
  }
}

// Parse args (simple, no 3rd-party dep)
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
const token = (getArg("token") || "USDC").toUpperCase();
const privateKey = getArg("private-key") || process.env.DISBURSE_PRIVATE_KEY;
const outDir = getArg("out-dir") || process.cwd();
const rpc = getArg("rpc");
const yes = args.includes("--yes");

if (!recipient || !amount || !label) {
  console.error("Missing required arguments: --recipient/--to, --amount, --label");
  console.error("Run with --help for usage.");
  process.exit(1);
}

if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("Private key required via --private-key or DISBURSE_PRIVATE_KEY env var (0x + 64 hex chars).");
  process.exit(1);
}

if (token !== "USDC" && token !== "EURC") {
  console.error('token must be USDC or EURC');
  process.exit(1);
}

// Dynamic import the implementation (works for src during dev with tsx or after tsc to dist)
const entry = resolve(__dirname, "../dist/send.js");

let send;
try {
  const mod = await import(pathToFileURL(entry).href);
  send = mod.send;
} catch (e) {
  // Fallback for development before build (user can run with tsx)
  try {
    const devMod = await import(pathToFileURL(resolve(__dirname, "../src/send.ts")).href);
    send = devMod.send;
  } catch (e2) {
    console.error("Failed to load CLI implementation. Run `npm run build` in packages/cli or use tsx.");
    console.error(String(e));
    process.exit(1);
  }
}

if (typeof send !== "function") {
  console.error("CLI implementation missing exported send()");
  process.exit(1);
}

try {
  await send({
    recipient,
    amount,
    label,
    note,
    token,
    privateKey,
    outDir,
    rpc,
    yes
  });
  process.exit(0);
} catch (err) {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
