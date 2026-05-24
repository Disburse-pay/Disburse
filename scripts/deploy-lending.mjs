#!/usr/bin/env node

/**
 * Deploy the Disburse Lending stack to Arc Testnet.
 *
 * Contracts deployed (in order):
 *   1. PythPriceAdapter    — wraps Pyth BTC/USD with staleness + haircut
 *   2. InterestRateModel   — kinked utilization curve (base/kink/slope1/slope2)
 *   3. LendingPool         — main vault (internally deploys AUsdc in ctor)
 *
 * Output goes to deployments/lending-<timestamp>.json with addresses, ABIs,
 * deployer, chainId, and block numbers — same shape as other deployment
 * artifacts so server/contracts.ts can load them uniformly.
 *
 * Required env:
 *   LENDING_DEPLOYER_PRIVATE_KEY       — deployer + initial owner
 *   LENDING_CIRBTC_ADDRESS             — cirBTC ERC20 on Arc Testnet
 *   LENDING_USDC_ADDRESS               — USDC ERC20 on Arc Testnet
 *   LENDING_PYTH_ADDRESS               — Pyth contract on Arc Testnet
 *   LENDING_PYTH_BTC_USD_FEED          — feed id (used as cirBTC proxy)
 *
 * Optional env:
 *   ARC_RPC_URL                        — RPC override
 *   LENDING_INITIAL_HAIRCUT_BPS        — adapter haircut (default 0)
 *   LENDING_PRICE_MAX_AGE_SECONDS      — staleness threshold (default 600)
 *   LENDING_IRM_BASE_RATE_PER_YEAR     — default 0 (0% APR)
 *   LENDING_IRM_KINK                   — default 0.8e18 (80% util)
 *   LENDING_IRM_SLOPE1_PER_YEAR        — default 0.04e18 (4% APR at kink)
 *   LENDING_IRM_SLOPE2_PER_YEAR        — default 1.0e18 (104% APR at 100%)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseGwei
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Configuration ───────────────────────────────────────────────────────────

const ARC_CHAIN_ID = 5_042_002;
const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const ARC_MIN_GAS_PRICE = parseGwei("20");
const RPC_TIMEOUT_MS = 60_000;

function reqEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name} in env. Add it to .env.local.`);
    process.exit(1);
  }
  return v;
}

const deployerKey = reqEnv("LENDING_DEPLOYER_PRIVATE_KEY");
const cirBtcAddress = getAddress(reqEnv("LENDING_CIRBTC_ADDRESS"));
const usdcAddress = getAddress(reqEnv("LENDING_USDC_ADDRESS"));
const pythAddress = getAddress(reqEnv("LENDING_PYTH_ADDRESS"));
const priceFeedId = reqEnv("LENDING_PYTH_BTC_USD_FEED");

if (!/^0x[0-9a-fA-F]{64}$/.test(priceFeedId)) {
  console.error("LENDING_PYTH_BTC_USD_FEED must be a 32-byte 0x-prefixed hex string.");
  process.exit(1);
}

const haircutBps = BigInt(process.env.LENDING_INITIAL_HAIRCUT_BPS || "0");
const maxAge = BigInt(process.env.LENDING_PRICE_MAX_AGE_SECONDS || "600");
const irmBase = BigInt(process.env.LENDING_IRM_BASE_RATE_PER_YEAR || "0");
const irmKink = BigInt(process.env.LENDING_IRM_KINK || (800_000n * 10n ** 12n)); // 0.8e18
const irmSlope1 = BigInt(process.env.LENDING_IRM_SLOPE1_PER_YEAR || (40_000n * 10n ** 12n)); // 0.04e18
const irmSlope2 = BigInt(process.env.LENDING_IRM_SLOPE2_PER_YEAR || 1_000_000_000_000_000_000n); // 1e18

const deployerAccount = privateKeyToAccount(deployerKey);

console.log(`Deployer:    ${deployerAccount.address}`);
console.log(`cirBTC:      ${cirBtcAddress}`);
console.log(`USDC:        ${usdcAddress}`);
console.log(`Pyth:        ${pythAddress}`);
console.log(`Feed:        ${priceFeedId}`);
console.log(`Haircut bps: ${haircutBps}`);
console.log(`MaxAge:      ${maxAge}s`);
console.log(`IRM:         base=${irmBase} kink=${irmKink} slope1=${irmSlope1} slope2=${irmSlope2}`);
console.log(`Chain:       Arc Testnet (${ARC_CHAIN_ID})`);
console.log("");

// ─── Compile ─────────────────────────────────────────────────────────────────

function readSource(rel) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

console.log("Compiling lending contracts…");
const sources = {
  "lending/PythPriceAdapter.sol": { content: readSource("contracts/src/lending/PythPriceAdapter.sol") },
  "lending/InterestRateModel.sol": { content: readSource("contracts/src/lending/InterestRateModel.sol") },
  "lending/AUsdc.sol":            { content: readSource("contracts/src/lending/AUsdc.sol") },
  "lending/LendingPool.sol":      { content: readSource("contracts/src/lending/LendingPool.sol") }
};

const solcInput = JSON.stringify({
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
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
    console.error(err.formattedMessage);
  }
  process.exit(1);
}

function compiledOf(path, name) {
  const c = solcOutput.contracts[path]?.[name];
  if (!c) throw new Error(`Missing artifact: ${path}:${name}`);
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

const adapter = compiledOf("lending/PythPriceAdapter.sol", "PythPriceAdapter");
const irm = compiledOf("lending/InterestRateModel.sol", "InterestRateModel");
const aUsdc = compiledOf("lending/AUsdc.sol", "AUsdc");
const pool = compiledOf("lending/LendingPool.sol", "LendingPool");
console.log("  PythPriceAdapter   bytecode=" + (adapter.bytecode.length - 2) / 2 + "B");
console.log("  InterestRateModel  bytecode=" + (irm.bytecode.length - 2) / 2 + "B");
console.log("  AUsdc              bytecode=" + (aUsdc.bytecode.length - 2) / 2 + "B");
console.log("  LendingPool        bytecode=" + (pool.bytecode.length - 2) / 2 + "B");
console.log("");

// ─── Clients ─────────────────────────────────────────────────────────────────

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

async function deployContract({ label, abi, bytecode, args }) {
  console.log(`Deploying ${label}…`);
  const gasPrice = await publicClient.getGasPrice();
  const effectiveGasPrice = gasPrice > ARC_MIN_GAS_PRICE ? gasPrice : ARC_MIN_GAS_PRICE;
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args,
    gasPrice: effectiveGasPrice
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} deploy reverted: ${hash}`);
  console.log(`  ${label}  ${receipt.contractAddress}  (tx ${hash})`);
  return { address: receipt.contractAddress, txHash: hash, blockNumber: Number(receipt.blockNumber) };
}

// ─── Deploy ──────────────────────────────────────────────────────────────────

const adapterDeploy = await deployContract({
  label: "PythPriceAdapter",
  abi: adapter.abi,
  bytecode: adapter.bytecode,
  args: [pythAddress, priceFeedId, cirBtcAddress, haircutBps, maxAge]
});

const irmDeploy = await deployContract({
  label: "InterestRateModel",
  abi: irm.abi,
  bytecode: irm.bytecode,
  args: [irmBase, irmKink, irmSlope1, irmSlope2]
});

const poolDeploy = await deployContract({
  label: "LendingPool",
  abi: pool.abi,
  bytecode: pool.bytecode,
  args: [usdcAddress, cirBtcAddress, irmDeploy.address, adapterDeploy.address]
});

// Read the AUsdc address from the deployed pool (it's deployed inside the constructor).
const aTokenAddress = await publicClient.readContract({
  address: poolDeploy.address,
  abi: pool.abi,
  functionName: "aToken"
});
console.log(`  AUsdc              ${aTokenAddress}  (deployed by LendingPool ctor)`);

// ─── Smoke read: confirm adapter returns a price ─────────────────────────────

console.log("");
console.log("Smoke read: PythPriceAdapter.getPrice()…");
try {
  const priceWad = await publicClient.readContract({
    address: adapterDeploy.address,
    abi: adapter.abi,
    functionName: "getPrice"
  });
  const usd = Number(priceWad / 10n ** 14n) / 10_000;
  console.log(`  BTC/USD = $${usd.toLocaleString()}`);
} catch (err) {
  console.error("  FAILED:", err.message || err);
  console.error("  (Pyth feed may be stale on Arc Testnet. The adapter is deployed; you can");
  console.error("  push a price via Pyth's updatePriceFeeds or wait for the next publish.)");
}

// ─── Write artifact ──────────────────────────────────────────────────────────

const artifact = {
  name: "DisburseLending",
  chainId: ARC_CHAIN_ID,
  deployer: deployerAccount.address,
  deployedAt: new Date().toISOString(),
  inputs: {
    cirBtc: cirBtcAddress,
    usdc: usdcAddress,
    pyth: pythAddress,
    priceFeedId,
    initialHaircutBps: haircutBps.toString(),
    maxAgeSeconds: maxAge.toString(),
    irm: {
      baseRatePerYear: irmBase.toString(),
      kinkUtilization: irmKink.toString(),
      slope1PerYear: irmSlope1.toString(),
      slope2PerYear: irmSlope2.toString()
    }
  },
  contracts: {
    PythPriceAdapter: { ...adapterDeploy, abi: adapter.abi },
    InterestRateModel: { ...irmDeploy, abi: irm.abi },
    LendingPool: { ...poolDeploy, abi: pool.abi },
    AUsdc: { address: aTokenAddress, abi: aUsdc.abi }
  }
};

const outDir = resolve(ROOT, "deployments");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, `lending-${Date.now()}.json`);
writeFileSync(outPath, JSON.stringify(artifact, null, 2));
console.log("");
console.log(`Wrote ${outPath}`);

// ─── Env snippet ─────────────────────────────────────────────────────────────

const envSnippet = [
  "",
  "# === Lending — deployed contracts (Arc Testnet) ===",
  `LENDING_POOL=${poolDeploy.address}`,
  `LENDING_ATOKEN=${aTokenAddress}`,
  `LENDING_IRM=${irmDeploy.address}`,
  `LENDING_PRICE_ADAPTER=${adapterDeploy.address}`,
  "# Browser-exposed copies (Vite only ships VITE_-prefixed env vars)",
  `VITE_LENDING_POOL=${poolDeploy.address}`,
  `VITE_LENDING_ATOKEN=${aTokenAddress}`,
  `VITE_LENDING_CIRBTC=${cirBtcAddress}`,
  ""
].join("\n");

console.log(envSnippet);
console.log("Paste the above into .env.local (manually — script does not edit env files).");
