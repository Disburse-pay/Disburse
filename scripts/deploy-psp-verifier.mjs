#!/usr/bin/env node

/**
 * Deploy PspVerifier.sol to Arc Testnet.
 *
 * Usage:
 *   node scripts/deploy-psp-verifier.mjs
 *
 * Required env:
 *   QR_DEPLOYER_PRIVATE_KEY — deployer private key (also owns the verifier)
 *   DISBURSE_PSP_SIGNING_KEY — issuer key (the PSP signer address will be derived)
 *   ARC_SETTLEMENT_CONTRACT — existing QrPaymentSettlement address
 *
 * Optional env:
 *   ARC_RPC_URL — override the default Arc Testnet RPC
 */

import { createPublicClient, createWalletClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Configuration ───────────────────────────────────────────────────────────

const ARC_CHAIN_ID = 5_042_002;
const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const RPC_TIMEOUT_MS = 30_000;

const deployerKey = process.env.QR_DEPLOYER_PRIVATE_KEY;
const issuerKey = process.env.DISBURSE_PSP_SIGNING_KEY;
const settlementContract = process.env.ARC_SETTLEMENT_CONTRACT;

if (!deployerKey || !issuerKey || !settlementContract) {
  console.error("Missing required env: QR_DEPLOYER_PRIVATE_KEY, DISBURSE_PSP_SIGNING_KEY, ARC_SETTLEMENT_CONTRACT");
  process.exit(1);
}

const deployerAccount = privateKeyToAccount(deployerKey);
const issuerAccount = privateKeyToAccount(issuerKey);
const issuerAddress = issuerAccount.address;

console.log(`Deployer: ${deployerAccount.address}`);
console.log(`Issuer:   ${issuerAddress}`);
console.log(`Settlement: ${settlementContract}`);
console.log(`Chain:    Arc Testnet (${ARC_CHAIN_ID})`);
console.log("");

// ─── Compile ─────────────────────────────────────────────────────────────────

console.log("Compiling PspVerifier.sol...");

const contractSource = readFileSync(resolve(ROOT, "contracts/src/PspVerifier.sol"), "utf-8");

const solcInput = JSON.stringify({
  language: "Solidity",
  sources: {
    "PspVerifier.sol": { content: contractSource }
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object"] }
    }
  }
});

const solcProcess = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["solc", "--standard-json"], {
  cwd: ROOT,
  input: solcInput,
  encoding: "utf-8",
  maxBuffer: 10 * 1024 * 1024
});

if (solcProcess.error) {
  throw solcProcess.error;
}

if (solcProcess.status !== 0) {
  console.error(solcProcess.stderr || solcProcess.stdout);
  process.exit(solcProcess.status ?? 1);
}

const jsonStart = solcProcess.stdout.indexOf("{");
if (jsonStart === -1) {
  console.error(solcProcess.stdout || solcProcess.stderr);
  throw new Error("solc did not return JSON output.");
}

const solcOutput = JSON.parse(solcProcess.stdout.slice(jsonStart));

if (solcOutput.errors?.some(e => e.severity === "error")) {
  console.error("Compilation errors:");
  for (const err of solcOutput.errors.filter(e => e.severity === "error")) {
    console.error(err.formattedMessage || err.message);
  }
  process.exit(1);
}

const compiled = solcOutput.contracts["PspVerifier.sol"]["PspVerifier"];
const abi = compiled.abi;
const bytecode = `0x${compiled.evm.bytecode.object}`;

console.log(`Compiled. Bytecode: ${bytecode.length / 2} bytes\n`);

// ─── Deploy ──────────────────────────────────────────────────────────────────

const arcChain = {
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } }
};

const publicClient = createPublicClient({
  chain: arcChain,
  transport: http(ARC_RPC_URL, { timeout: RPC_TIMEOUT_MS })
});

const walletClient = createWalletClient({
  account: deployerAccount,
  chain: arcChain,
  transport: http(ARC_RPC_URL, { timeout: RPC_TIMEOUT_MS })
});

console.log("Deploying PspVerifier...");

const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [getAddress(settlementContract), getAddress(issuerAddress)]
});

console.log(`Tx: ${hash}`);
console.log("Waiting for receipt...");

const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

if (receipt.status !== "success") {
  console.error("Deploy transaction reverted!");
  process.exit(1);
}

const verifierAddress = receipt.contractAddress;
console.log(`\n✓ PspVerifier deployed at: ${verifierAddress}\n`);

// ─── Save deployment ─────────────────────────────────────────────────────────

const deployment = {
  name: "PspVerifier",
  address: verifierAddress,
  deployer: deployerAccount.address,
  issuer: issuerAddress,
  settlementContract,
  chainId: ARC_CHAIN_ID,
  txHash: hash,
  blockNumber: Number(receipt.blockNumber),
  deployedAt: new Date().toISOString(),
  abi
};

const deploymentsDir = resolve(ROOT, "deployments");
mkdirSync(deploymentsDir, { recursive: true });
const filename = `psp-verifier-${Date.now()}.json`;
writeFileSync(resolve(deploymentsDir, filename), JSON.stringify(deployment, null, 2));
console.log(`Deployment saved: deployments/${filename}`);
