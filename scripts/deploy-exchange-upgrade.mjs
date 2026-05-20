#!/usr/bin/env node

/**
 * Redeploy Exchange contract only — preserves existing OutcomeToken,
 * AdminResolver, MarketFactory, and all existing markets.
 *
 * This script:
 *   1. Compiles Exchange.sol (and its dependencies)
 *   2. Deploys the new Exchange to Arc Testnet
 *   3. Outputs the new address for .env updates
 *
 * The new Exchange needs the same constructor args:
 *   - collateral (USDC)
 *   - outcomeToken (existing OutcomeToken address)
 *
 * Users need to re-approve the new Exchange address:
 *   USDC.approve(newExchange, max)
 *   OutcomeToken.setApprovalForAll(newExchange, true)
 *
 * Required env:
 *   MARKETS_DEPLOYER_PRIVATE_KEY
 *   MARKETS_OUTCOME_TOKEN (existing address)
 */

import { createPublicClient, createWalletClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const ARC_CHAIN_ID = 5_042_002;
const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const RPC_TIMEOUT_MS = 60_000;
const DEFAULT_USDC = "0x3600000000000000000000000000000000000000";

const deployerKey = process.env.MARKETS_DEPLOYER_PRIVATE_KEY;
if (!deployerKey) {
  console.error("Missing MARKETS_DEPLOYER_PRIVATE_KEY in env.");
  process.exit(1);
}

const outcomeTokenAddress = process.env.MARKETS_OUTCOME_TOKEN;
if (!outcomeTokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(outcomeTokenAddress)) {
  console.error("Missing or invalid MARKETS_OUTCOME_TOKEN in env.");
  process.exit(1);
}

const collateralAddress = getAddress(process.env.MARKETS_COLLATERAL_ADDRESS || DEFAULT_USDC);
const deployerAccount = privateKeyToAccount(deployerKey);

console.log(`Deployer:       ${deployerAccount.address}`);
console.log(`Collateral:     ${collateralAddress}`);
console.log(`OutcomeToken:   ${outcomeTokenAddress}`);
console.log(`Chain:          Arc Testnet (${ARC_CHAIN_ID})`);
console.log(`RPC:            ${ARC_RPC_URL}\n`);

// ─── Compile ─────────────────────────────────────────────────────────────────

function readSource(rel) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

console.log("Compiling Exchange.sol…");

const sources = {
  "markets/Exchange.sol": { content: readSource("contracts/src/markets/Exchange.sol") },
  "markets/OutcomeToken.sol": { content: readSource("contracts/src/markets/OutcomeToken.sol") },
  "markets/Market.sol": { content: readSource("contracts/src/markets/Market.sol") },
  "markets/interfaces/IResolver.sol": { content: readSource("contracts/src/markets/interfaces/IResolver.sol") },
};

const solcInput = JSON.stringify({
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object"] }
    }
  }
});

const solcProcess = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["solc", "--standard-json"],
  {
    cwd: ROOT,
    input: solcInput,
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === "win32"
  }
);

if (solcProcess.error) throw solcProcess.error;
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

if (solcOutput.errors?.some((e) => e.severity === "error")) {
  console.error("Compilation errors:");
  for (const err of solcOutput.errors.filter((e) => e.severity === "error")) {
    console.error(err.formattedMessage || err.message);
  }
  process.exit(1);
}

if (solcOutput.errors?.length) {
  for (const warn of solcOutput.errors) {
    console.warn(warn.formattedMessage || warn.message);
  }
}

const exchangeC = solcOutput.contracts["markets/Exchange.sol"]?.["Exchange"];
if (!exchangeC) throw new Error("Exchange artifact not found in compiler output.");
const abi = exchangeC.abi;
const bytecode = `0x${exchangeC.evm.bytecode.object}`;

console.log(`  Exchange bytecode: ${bytecode.length / 2} bytes\n`);

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

console.log("Deploying Exchange…");
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [collateralAddress, getAddress(outcomeTokenAddress)]
});
console.log(`  tx: ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
if (receipt.status !== "success") {
  console.error("Exchange deploy reverted.");
  process.exit(1);
}
const address = getAddress(receipt.contractAddress);
console.log(`  Exchange @ ${address}\n`);

// ─── Save ────────────────────────────────────────────────────────────────────

const deployment = {
  name: "ExchangeUpgrade",
  reason: "Added tryFillOrders for best-effort batch fills",
  chainId: ARC_CHAIN_ID,
  deployer: deployerAccount.address,
  deployedAt: new Date().toISOString(),
  previousExchange: process.env.MARKETS_EXCHANGE || "unknown",
  contracts: {
    Exchange: { address, txHash: hash, blockNumber: Number(receipt.blockNumber), abi }
  }
};

const deploymentsDir = resolve(ROOT, "deployments");
mkdirSync(deploymentsDir, { recursive: true });
const filename = `exchange-upgrade-${Date.now()}.json`;
writeFileSync(resolve(deploymentsDir, filename), JSON.stringify(deployment, null, 2));

console.log("✓ Exchange redeployed.\n");
console.log("Update these in .env.local and VPS mm-bot.env:");
console.log(`  MARKETS_EXCHANGE=${address}`);
console.log(`  VITE_MARKETS_EXCHANGE=${address}`);
console.log(`\nArtifact: deployments/${filename}`);
console.log(`\nIMPORTANT: Users must re-approve the new Exchange:`);
console.log(`  USDC.approve(${address}, type(uint256).max)`);
console.log(`  OutcomeToken.setApprovalForAll(${address}, true)`);
