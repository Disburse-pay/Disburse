#!/usr/bin/env node

/**
 * Deploy the prediction-markets stack to Arc Testnet.
 *
 * Contracts deployed (in order):
 *   1. OutcomeToken      — ERC-1155 shares (one contract for all markets)
 *   2. AdminResolver     — v1 admin-keyed resolver, owned by deployer
 *   3. MarketFactory     — admin-only Market deployer; wires Token+Resolver
 *
 * Ownership transfers (post-deploy, so factory can authorize new markets):
 *   OutcomeToken.transferOwnership(factory)
 *   AdminResolver.transferOwnership(factory)
 *
 * Output is written to deployments/markets-<timestamp>.json with addresses,
 * ABIs, deployer, chainId, and block numbers — same shape as the existing
 * PSP verifier deployment artifact so server/contracts.ts can consume it
 * uniformly.
 *
 * Required env:
 *   MARKETS_DEPLOYER_PRIVATE_KEY — deployer + initial admin/owner
 *
 * Optional env:
 *   ARC_RPC_URL                  — override default RPC
 *   MARKETS_COLLATERAL_ADDRESS   — override USDC address (default: Arc USDC)
 *   MARKETS_ADMIN_MULTISIG_OWNERS     — comma-separated admin owner addresses
 *   MARKETS_ADMIN_MULTISIG_THRESHOLD  — threshold for admin multisig
 */

import { createPublicClient, createWalletClient, http, getAddress, getContract } from "viem";
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
const RPC_TIMEOUT_MS = 60_000;
const DEFAULT_USDC = "0x3600000000000000000000000000000000000000";

const deployerKey = process.env.MARKETS_DEPLOYER_PRIVATE_KEY;
if (!deployerKey) {
  console.error("Missing MARKETS_DEPLOYER_PRIVATE_KEY in env. Add it to .env.local.");
  process.exit(1);
}

const collateralAddress = getAddress(process.env.MARKETS_COLLATERAL_ADDRESS || DEFAULT_USDC);
const adminMultisigOwners = parseAddressList(process.env.MARKETS_ADMIN_MULTISIG_OWNERS);
const adminMultisigThreshold = parseOptionalInt(process.env.MARKETS_ADMIN_MULTISIG_THRESHOLD);
const deployerAccount = privateKeyToAccount(deployerKey);

if (adminMultisigOwners.length > 0) {
  if (!adminMultisigThreshold) {
    throw new Error("MARKETS_ADMIN_MULTISIG_THRESHOLD is required when MARKETS_ADMIN_MULTISIG_OWNERS is set.");
  }
  if (adminMultisigThreshold > adminMultisigOwners.length) {
    throw new Error("MARKETS_ADMIN_MULTISIG_THRESHOLD cannot exceed owner count.");
  }
}

function parseAddressList(value) {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => getAddress(entry));
}

function parseOptionalInt(value) {
  if (!value?.trim()) return undefined;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error("MARKETS_ADMIN_MULTISIG_THRESHOLD must be a positive integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("MARKETS_ADMIN_MULTISIG_THRESHOLD must be a positive safe integer.");
  }
  return parsed;
}

console.log(`Deployer:    ${deployerAccount.address}`);
console.log(`Collateral:  ${collateralAddress} (USDC)`);
if (adminMultisigOwners.length > 0) {
  console.log(`Admin msig:  ${adminMultisigThreshold}-of-${adminMultisigOwners.length}`);
}
console.log(`Chain:       Arc Testnet (${ARC_CHAIN_ID})`);
console.log(`RPC:         ${ARC_RPC_URL}`);
console.log("");

// ─── Compile ─────────────────────────────────────────────────────────────────

function readSource(rel) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

console.log("Compiling markets contracts…");

const sources = {
  "markets/interfaces/IResolver.sol": { content: readSource("contracts/src/markets/interfaces/IResolver.sol") },
  "markets/OutcomeToken.sol":        { content: readSource("contracts/src/markets/OutcomeToken.sol") },
  "markets/Market.sol":              { content: readSource("contracts/src/markets/Market.sol") },
  "markets/Exchange.sol":            { content: readSource("contracts/src/markets/Exchange.sol") },
  "markets/AdminResolver.sol":       { content: readSource("contracts/src/markets/AdminResolver.sol") },
  "markets/MarketFactory.sol":       { content: readSource("contracts/src/markets/MarketFactory.sol") },
  "markets/MarketsAdminMultisig.sol": { content: readSource("contracts/src/markets/MarketsAdminMultisig.sol") },
  "markets/MarketsPspVerifier.sol":  { content: readSource("contracts/src/markets/MarketsPspVerifier.sol") }
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
    // Node 20+ on Windows requires shell:true to spawn .cmd files
    // (CVE-2024-27980 mitigation).
    shell: process.platform === "win32"
  }
);

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

if (solcOutput.errors?.some((e) => e.severity === "error")) {
  console.error("Compilation errors:");
  for (const err of solcOutput.errors.filter((e) => e.severity === "error")) {
    console.error(err.formattedMessage || err.message);
  }
  process.exit(1);
}

// Warnings are useful but non-fatal; print them.
if (solcOutput.errors?.length) {
  for (const warn of solcOutput.errors) {
    console.warn(warn.formattedMessage || warn.message);
  }
}

function compiledOf(path, name) {
  const c = solcOutput.contracts[path]?.[name];
  if (!c) throw new Error(`Compiled artifact missing: ${path}:${name}`);
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
}

const outcomeTokenC = compiledOf("markets/OutcomeToken.sol", "OutcomeToken");
const adminResolverC = compiledOf("markets/AdminResolver.sol", "AdminResolver");
const marketFactoryC = compiledOf("markets/MarketFactory.sol", "MarketFactory");
const marketC = compiledOf("markets/Market.sol", "Market");
const exchangeC = compiledOf("markets/Exchange.sol", "Exchange");
const adminMultisigC = compiledOf("markets/MarketsAdminMultisig.sol", "MarketsAdminMultisig");
const marketsPspVerifierC = compiledOf("markets/MarketsPspVerifier.sol", "MarketsPspVerifier");

console.log(`  OutcomeToken:   ${outcomeTokenC.bytecode.length / 2} bytes`);
console.log(`  AdminResolver:  ${adminResolverC.bytecode.length / 2} bytes`);
console.log(`  MarketFactory:  ${marketFactoryC.bytecode.length / 2} bytes`);
console.log(`  Exchange:       ${exchangeC.bytecode.length / 2} bytes`);
console.log(`  AdminMultisig:  ${adminMultisigC.bytecode.length / 2} bytes`);
console.log(`  MarketsPSP:     ${marketsPspVerifierC.bytecode.length / 2} bytes`);
console.log(`  Market:         ${marketC.bytecode.length / 2} bytes (deployed by factory)\n`);

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

async function deploy(label, abi, bytecode, args) {
  console.log(`Deploying ${label}…`);
  const hash = await walletClient.deployContract({ abi, bytecode, args });
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") {
    console.error(`${label} deploy reverted.`);
    process.exit(1);
  }
  const address = getAddress(receipt.contractAddress);
  console.log(`  ${label} @ ${address}\n`);
  return { address, txHash: hash, blockNumber: Number(receipt.blockNumber) };
}

// 1. OutcomeToken
const outcomeToken = await deploy("OutcomeToken", outcomeTokenC.abi, outcomeTokenC.bytecode, []);

// 2. AdminResolver (owned by deployer initially)
const adminResolver = await deploy("AdminResolver", adminResolverC.abi, adminResolverC.bytecode, [
  deployerAccount.address
]);

// 3. Exchange (collateral + outcomeToken)
const exchange = await deploy("Exchange", exchangeC.abi, exchangeC.bytecode, [
  collateralAddress,
  outcomeToken.address
]);

// 4. MarketFactory
const marketFactory = await deploy("MarketFactory", marketFactoryC.abi, marketFactoryC.bytecode, [
  collateralAddress,
  outcomeToken.address,
  adminResolver.address
]);

let adminMultisig;
if (adminMultisigOwners.length > 0) {
  adminMultisig = await deploy("MarketsAdminMultisig", adminMultisigC.abi, adminMultisigC.bytecode, [
    adminMultisigOwners,
    BigInt(adminMultisigThreshold)
  ]);
}

// ─── Wire ownership so the factory can authorize new markets ────────────────

console.log("Transferring OutcomeToken ownership to MarketFactory…");
const tokenContract = getContract({
  abi: outcomeTokenC.abi,
  address: outcomeToken.address,
  client: { public: publicClient, wallet: walletClient }
});
const tokenHash = await tokenContract.write.transferOwnership([marketFactory.address]);
await publicClient.waitForTransactionReceipt({ hash: tokenHash, confirmations: 1 });
console.log(`  tx: ${tokenHash}\n`);

console.log("Transferring AdminResolver ownership to MarketFactory…");
const resolverContract = getContract({
  abi: adminResolverC.abi,
  address: adminResolver.address,
  client: { public: publicClient, wallet: walletClient }
});
const resolverHash = await resolverContract.write.transferOwnership([marketFactory.address]);
await publicClient.waitForTransactionReceipt({ hash: resolverHash, confirmations: 1 });
console.log(`  tx: ${resolverHash}\n`);

let factoryOwnerHash;
if (adminMultisig) {
  console.log("Transferring MarketFactory ownership to MarketsAdminMultisig…");
  const factoryContract = getContract({
    abi: marketFactoryC.abi,
    address: marketFactory.address,
    client: { public: publicClient, wallet: walletClient }
  });
  factoryOwnerHash = await factoryContract.write.transferOwnership([adminMultisig.address]);
  await publicClient.waitForTransactionReceipt({ hash: factoryOwnerHash, confirmations: 1 });
  console.log(`  tx: ${factoryOwnerHash}\n`);
} else {
  // NOTE: The deployer keeps MarketFactory ownership (= admin powers).
}

// ─── Save deployment artifact ────────────────────────────────────────────────

const deployment = {
  name: "DisburseMarkets",
  chainId: ARC_CHAIN_ID,
  deployer: deployerAccount.address,
  collateral: collateralAddress,
  deployedAt: new Date().toISOString(),
  contracts: {
    OutcomeToken:  { ...outcomeToken,  abi: outcomeTokenC.abi  },
    AdminResolver: { ...adminResolver, abi: adminResolverC.abi },
    Exchange:      { ...exchange,      abi: exchangeC.abi      },
    MarketFactory: { ...marketFactory, abi: marketFactoryC.abi },
    ...(adminMultisig ? { MarketsAdminMultisig: { ...adminMultisig, abi: adminMultisigC.abi } } : {})
  },
  // Market is deployed per-market by MarketFactory; ship its ABI here too
  // so the off-chain code can decode events without recompiling.
  marketAbi: marketC.abi,
  marketsPspVerifierAbi: marketsPspVerifierC.abi,
  ownershipTransfers: {
    outcomeTokenToFactory: tokenHash,
    adminResolverToFactory: resolverHash,
    ...(factoryOwnerHash ? { marketFactoryToAdminMultisig: factoryOwnerHash } : {})
  }
};

const deploymentsDir = resolve(ROOT, "deployments");
mkdirSync(deploymentsDir, { recursive: true });
const filename = `markets-${Date.now()}.json`;
writeFileSync(resolve(deploymentsDir, filename), JSON.stringify(deployment, null, 2));

console.log("✓ Markets stack deployed.\n");
console.log("Add these to .env.local:");
console.log(`  MARKETS_OUTCOME_TOKEN=${outcomeToken.address}`);
console.log(`  MARKETS_ADMIN_RESOLVER=${adminResolver.address}`);
console.log(`  MARKETS_EXCHANGE=${exchange.address}`);
console.log(`  MARKETS_FACTORY=${marketFactory.address}`);
if (adminMultisig) {
  console.log(`  MARKETS_ADMIN_MULTISIG=${adminMultisig.address}`);
}
console.log(`\nArtifact: deployments/${filename}`);
