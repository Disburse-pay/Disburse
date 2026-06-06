#!/usr/bin/env node
/**
 * Settlement-only (re)deploy for the hardened QrPaymentSettlement.
 *
 * Unlike `deploy-qr-contracts.mjs --full` (which also redeploys the Base/Monad
 * QrPaymentSource contracts), this deploys ONLY a fresh QrPaymentSettlement on
 * Arc, re-authorizes the EXISTING source contracts, re-points the token routes,
 * and optionally prefunds + hands ownership to a multisig. Use it to roll out
 * the pause / rescueTokens / 2-step-owner hardening without disturbing sources.
 *
 * Modes (safe by default — nothing touches the chain unless you ask):
 *   (no flags)     compile only, exit.
 *   --dry-run      validate config + deployer funding, print the full plan. No tx.
 *   --broadcast    deploy + setAllowedSource + setTokenRoute for each source.
 *
 * Options:
 *   --prefund <amount>            after deploy, transfer <amount> Arc USDC (human
 *                                 units, e.g. 250) from the deployer to the new
 *                                 contract.
 *   --transfer-ownership <addr>   nominate <addr> as pendingOwner (2-step; the
 *                                 multisig must then call acceptOwnership()).
 *
 * Reads QR_DEPLOYER_PRIVATE_KEY, source/token addresses, and optional RPC
 * overrides from .env.deploy.local / .env.local / .env. Writes a deployment
 * record to deployments/ and the env lines you need to update to
 * .env.settlement.generated.
 *
 * Example:
 *   node scripts/deploy-settlement-only.mjs --dry-run
 *   node scripts/deploy-settlement-only.mjs --broadcast --prefund 250
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const ARC_CHAIN_ID = 5_042_002;
const BASE_SEPOLIA_CHAIN_ID = 84_532;
const MONAD_TESTNET_CHAIN_ID = 10_143;
const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const POLYMER_TESTNET_PROVER_ADDRESS = "0x85e9506fd24F9B588dcf2A5AaEF7069e34D99fCE";

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)"
]);

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const flagValue = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const dryRun = hasFlag("--dry-run");
const broadcast = hasFlag("--broadcast");
const prefundAmount = flagValue("--prefund");
const transferOwnershipTo = flagValue("--transfer-ownership");
const includeMonad = hasFlag("--include-monad");

loadEnvFiles([".env.deploy.local", ".env.local", ".env"]);

const artifact = compileSettlement();

if (!dryRun && !broadcast) {
  console.log("Compiled QrPaymentSettlement.");
  console.log("Re-run with --dry-run to validate config, or --broadcast to deploy.");
  process.exit(0);
}

const arc = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [readEnv("ARC_RPC_URL") || "https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
  testnet: true
});

const deployerPrivateKey = readPrivateKey("QR_DEPLOYER_PRIVATE_KEY");
const account = privateKeyToAccount(deployerPrivateKey);

const arcUsdc = readAddress(["ARC_USDC_ADDRESS", "VITE_ARC_USDC_ADDRESS"], ARC_USDC_ADDRESS);
const baseSource = readOptionalAddress(["BASE_SEPOLIA_QR_PAYMENT_SOURCE", "VITE_BASE_SEPOLIA_QR_PAYMENT_SOURCE"]);
const baseToken = readOptionalAddress(["BASE_SEPOLIA_USDC_ADDRESS", "VITE_BASE_SEPOLIA_USDC_ADDRESS"]);
const monadSource = readOptionalAddress(["MONAD_QR_PAYMENT_SOURCE", "VITE_MONAD_QR_PAYMENT_SOURCE"]);
const monadToken = readOptionalAddress(["MONAD_USDC_ADDRESS", "VITE_MONAD_USDC_ADDRESS"]);

// Build the authorization plan from whichever sources are configured.
const sourcePlan = [];
if (baseSource && baseToken) {
  sourcePlan.push({ label: "Base Sepolia", chainId: BASE_SEPOLIA_CHAIN_ID, source: baseSource, token: baseToken });
}
if (includeMonad && monadSource && monadToken) {
  sourcePlan.push({ label: "Monad", chainId: MONAD_TESTNET_CHAIN_ID, source: monadSource, token: monadToken });
}

if (transferOwnershipTo && !isAddress(transferOwnershipTo)) {
  throw new Error(`--transfer-ownership must be a valid 0x address, got: ${transferOwnershipTo}`);
}

const publicClient = createPublicClient({ chain: arc, transport: http(arc.rpcUrls.default.http[0], { timeout: 15_000 }) });

const gasBalance = await publicClient.getBalance({ address: account.address });
let usdcDecimals = 6;
let usdcBalance = null;
try {
  usdcDecimals = await publicClient.readContract({ address: arcUsdc, abi: ERC20_ABI, functionName: "decimals" });
  usdcBalance = await publicClient.readContract({
    address: arcUsdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address]
  });
} catch (error) {
  console.warn(`Warning: could not read Arc USDC (${arcUsdc}): ${error.shortMessage || error.message}`);
}

// ---------- Plan summary ----------
console.log("\n=== Settlement-only deploy plan ===");
console.log(`Deployer:        ${account.address}`);
console.log(`Arc gas balance: ${formatEther(gasBalance)} (native)`);
console.log(`Arc USDC:        ${usdcBalance === null ? "unknown" : formatUnits(usdcBalance, usdcDecimals)} (${arcUsdc})`);
console.log(`Prover:          ${POLYMER_TESTNET_PROVER_ADDRESS}`);
console.log(`Arc USDC route:  ${arcUsdc}`);
if (sourcePlan.length === 0) {
  console.log("Sources:         NONE configured — set BASE_SEPOLIA_QR_PAYMENT_SOURCE / MONAD_QR_PAYMENT_SOURCE (+ token addresses).");
} else {
  for (const s of sourcePlan) {
    console.log(`Source:          ${s.label} (chain ${s.chainId}) ${s.source} | token ${s.token} -> ${arcUsdc}`);
  }
}
if (prefundAmount) console.log(`Prefund:         ${prefundAmount} USDC -> new contract`);
if (transferOwnershipTo) console.log(`Ownership:       nominate ${transferOwnershipTo} (pendingOwner; multisig must acceptOwnership())`);

// ---------- Pre-flight checks ----------
const problems = [];
if (gasBalance <= 0n) problems.push("Deployer has zero native (gas) balance on Arc.");
if (sourcePlan.length === 0) problems.push("No source contracts configured to authorize.");
if (prefundAmount) {
  if (!/^\d+(\.\d+)?$/.test(prefundAmount)) {
    problems.push(`--prefund must be a positive number, got: ${prefundAmount}`);
  } else if (usdcBalance !== null && parseUnits(prefundAmount, usdcDecimals) > usdcBalance) {
    problems.push(`Deployer USDC balance is less than --prefund ${prefundAmount}.`);
  }
}

if (dryRun) {
  if (problems.length) {
    console.log("\nDRY RUN — blockers found:");
    for (const p of problems) console.log(`  - ${p}`);
    console.log("\nFix the above, then re-run with --broadcast.");
    process.exit(1);
  }
  console.log("\nDRY RUN — all checks passed. Re-run with --broadcast to deploy.");
  process.exit(0);
}

// ---------- Broadcast ----------
if (problems.length) {
  console.error("\nRefusing to broadcast — blockers found:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const walletClient = createWalletClient({ account, chain: arc, transport: http(arc.rpcUrls.default.http[0], { timeout: 15_000 }) });

console.log("\nDeploying QrPaymentSettlement...");
const deployHash = await walletClient.deployContract({
  account,
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [POLYMER_TESTNET_PROVER_ADDRESS]
});
const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash, confirmations: 1 });
if (deployReceipt.status !== "success" || !deployReceipt.contractAddress) {
  throw new Error(`Deployment failed: ${deployHash}`);
}
const settlementAddress = getAddress(deployReceipt.contractAddress);
console.log(`Deployed at ${settlementAddress} (tx ${deployHash})`);

const configuration = { allowedSources: [], tokenRoutes: [] };
for (const s of sourcePlan) {
  configuration.allowedSources.push(await writeCall("setAllowedSource", [s.chainId, s.source, true], s.label));
  configuration.tokenRoutes.push(await writeCall("setTokenRoute", [s.chainId, s.token, arcUsdc], s.label));
}

let prefund = null;
if (prefundAmount) {
  const amount = parseUnits(prefundAmount, usdcDecimals);
  console.log(`Prefunding ${prefundAmount} USDC -> ${settlementAddress}...`);
  const hash = await walletClient.writeContract({
    account,
    address: arcUsdc,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [settlementAddress, amount]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`Prefund transfer failed: ${hash}`);
  prefund = { amount: prefundAmount, txHash: hash };
  console.log(`Prefunded (tx ${hash})`);
}

let ownership = null;
if (transferOwnershipTo) {
  ownership = await writeCall("transferOwnership", [getAddress(transferOwnershipTo)], "ownership");
  console.log(`Nominated ${transferOwnershipTo} as pendingOwner — it must call acceptOwnership().`);
}

writeOutput({
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  mode: "settlement-only",
  prover: POLYMER_TESTNET_PROVER_ADDRESS,
  settlement: { chainId: ARC_CHAIN_ID, address: settlementAddress, txHash: deployHash },
  arcUsdc,
  configuration,
  prefund,
  ownership
});

console.log("\n=== Done. Next steps ===");
console.log(`1. Update env (Vercel + .env.local + VPS) to the new address:`);
console.log(`     ARC_SETTLEMENT_CONTRACT=${settlementAddress}`);
console.log(`     ARC_QR_PAYMENT_SETTLEMENT=${settlementAddress}`);
console.log(`     VITE_ARC_QR_PAYMENT_SETTLEMENT=${settlementAddress}`);
console.log(`2. Redeploy the Vercel app and restart the VPS keeper.`);
if (!prefundAmount) console.log(`3. Prefund the new contract with Arc USDC (re-run with --prefund <amount>, or transfer manually).`);

// ===================== helpers =====================

async function writeCall(functionName, callArgs, label) {
  console.log(`Calling ${functionName} (${label})...`);
  const hash = await walletClient.writeContract({
    account,
    address: settlementAddress,
    abi: artifact.abi,
    functionName,
    args: callArgs
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`${functionName} failed: ${hash}`);
  console.log(`  confirmed (tx ${hash})`);
  return { functionName, label, args: callArgs.map(String), txHash: hash };
}

function compileSettlement() {
  const input = {
    language: "Solidity",
    sources: {
      "QrPaymentSettlement.sol": {
        content: readFileSync(join(repoRoot, "contracts", "src", "QrPaymentSettlement.sol"), "utf8")
      }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter((item) => item.severity === "error") ?? [];
  if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  const compiled = output.contracts?.["QrPaymentSettlement.sol"]?.QrPaymentSettlement;
  const bytecode = compiled?.evm?.bytecode?.object;
  if (!compiled?.abi || !bytecode) throw new Error("Missing compiled QrPaymentSettlement artifact.");
  return { abi: compiled.abi, bytecode: `0x${bytecode}` };
}

function writeOutput(record) {
  mkdirSync(join(repoRoot, "deployments"), { recursive: true });
  const path = join(repoRoot, "deployments", `settlement-redeploy-${Date.now()}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  const envPath = join(repoRoot, ".env.settlement.generated");
  writeFileSync(
    envPath,
    [
      `ARC_SETTLEMENT_CONTRACT=${record.settlement.address}`,
      `ARC_QR_PAYMENT_SETTLEMENT=${record.settlement.address}`,
      `VITE_ARC_QR_PAYMENT_SETTLEMENT=${record.settlement.address}`,
      ""
    ].join("\n")
  );
  console.log(`\nWrote ${path}`);
  console.log(`Wrote ${envPath}`);
}

function readEnv(key) {
  return process.env[key]?.trim();
}

function readPrivateKey(key) {
  const value = readEnv(key);
  if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${key} must be set to a 32-byte hex private key in your local environment.`);
  }
  return value;
}

function readAddress(keys, fallback) {
  const found = readOptionalAddress(keys);
  if (found) return found;
  if (fallback) return getAddress(fallback);
  throw new Error(`Missing address. Set one of: ${keys.join(", ")}.`);
}

function readOptionalAddress(keys) {
  for (const key of keys) {
    const value = readEnv(key);
    if (!value) continue;
    if (!isAddress(value)) throw new Error(`${key} must be a valid 0x address.`);
    return getAddress(value);
  }
  return undefined;
}

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const path = join(repoRoot, fileName);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = unquoteEnvValue(match[2]);
    }
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
