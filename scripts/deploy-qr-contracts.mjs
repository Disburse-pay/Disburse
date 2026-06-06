#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  isAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const ARC_CHAIN_ID = 5_042_002;
const BASE_SEPOLIA_CHAIN_ID = 84_532;
const MONAD_TESTNET_CHAIN_ID = 10_143;
const OLD_MEGAETH_TESTNET_CHAIN_ID = 6_343;
const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const MONAD_USDC_ADDRESS = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const DEPLOYED_ARC_SETTLEMENT = "0x8c535227ed2b2963a3c1176510bc59e7a7fef07d";
const DEPLOYED_OLD_MEGAETH_SOURCE = "0x8c535227ed2b2963a3c1176510bc59e7a7fef07d";
const POLYMER_TESTNET_PROVER_ADDRESS = "0x85e9506fd24F9B588dcf2A5AaEF7069e34D99fCE";

const cliArgs = new Set(process.argv.slice(2));
const compileOnly = cliArgs.has("--compile-only");
const skipConfigure = cliArgs.has("--skip-configure");
const addMonadSource = cliArgs.has("--add-monad-source") || cliArgs.has("--monad-only");
const fullDeploy = cliArgs.has("--full");

loadEnvFiles([".env.deploy.local", ".env.local", ".env"]);

const artifacts = compileContracts();

if (compileOnly) {
  console.log("Compiled QrPaymentSource and QrPaymentSettlement.");
  process.exit(0);
}

if (!addMonadSource && !fullDeploy) {
  throw new Error("Choose --add-monad-source for the MegaETH-to-Monad migration or --full for a full redeploy.");
}

const deployerPrivateKey = readPrivateKey("QR_DEPLOYER_PRIVATE_KEY");
const account = privateKeyToAccount(deployerPrivateKey);

const routes = {
  arc: {
    key: "ARC",
    label: "Arc Testnet",
    chainId: ARC_CHAIN_ID,
    rpcUrl: readEnv("ARC_RPC_URL") || "https://rpc.testnet.arc.network",
    explorerUrl: "https://testnet.arcscan.app",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }
  },
  base: {
    key: "BASE_SEPOLIA",
    label: "Base Sepolia",
    chainId: BASE_SEPOLIA_CHAIN_ID,
    rpcUrl: readEnv("BASE_SEPOLIA_RPC_URL") || "https://sepolia.base.org",
    explorerUrl: "https://sepolia-explorer.base.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
  },
  monad: {
    key: "MONAD",
    label: "Monad Testnet",
    chainId: MONAD_TESTNET_CHAIN_ID,
    rpcUrl: readEnv("MONAD_RPC_URL") || "https://testnet-rpc.monad.xyz",
    explorerUrl: "https://testnet.monadscan.com",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 }
  }
};

for (const route of Object.values(routes)) {
  route.chain = defineChain({
    id: route.chainId,
    name: route.label,
    nativeCurrency: route.nativeCurrency,
    rpcUrls: { default: { http: [route.rpcUrl] } },
    blockExplorers: { default: { name: `${route.label} Explorer`, url: route.explorerUrl } },
    testnet: true
  });
}

const baseSourceToken = skipConfigure || addMonadSource
  ? undefined
  : readAddress(["BASE_SEPOLIA_USDC_ADDRESS", "VITE_BASE_SEPOLIA_USDC_ADDRESS"]);
const monadSourceToken = readAddress(["MONAD_USDC_ADDRESS", "VITE_MONAD_USDC_ADDRESS"], MONAD_USDC_ADDRESS);
const arcUsdcToken = skipConfigure
  ? ARC_USDC_ADDRESS
  : readAddress(["ARC_USDC_ADDRESS", "VITE_ARC_USDC_ADDRESS"], ARC_USDC_ADDRESS);

console.log(`Deploying QR contracts from ${account.address}.`);

if (addMonadSource) {
  await runAddMonadSource();
} else {
  await runFullDeploy();
}

async function runAddMonadSource() {
  await assertFunded(routes.monad, account.address);
  await assertFunded(routes.arc, account.address);

  const arcSettlementAddress = readAddress(
    ["ARC_QR_PAYMENT_SETTLEMENT", "VITE_ARC_QR_PAYMENT_SETTLEMENT"],
    DEPLOYED_ARC_SETTLEMENT
  );
  const oldMegaSource =
    readOptionalAddress(["OLD_MEGAETH_QR_PAYMENT_SOURCE"]) ?? getAddress(DEPLOYED_OLD_MEGAETH_SOURCE);
  const monadSource = await deploy(routes.monad, artifacts.QrPaymentSource, []);
  const configuration = { allowedSources: {}, tokenRoutes: {} };

  if (!skipConfigure) {
    configuration.allowedSources.monad = await configureAllowedSource(
      arcSettlementAddress,
      MONAD_TESTNET_CHAIN_ID,
      monadSource.address,
      true
    );
    configuration.tokenRoutes.monad = await configureTokenRoute(
      arcSettlementAddress,
      MONAD_TESTNET_CHAIN_ID,
      monadSourceToken,
      arcUsdcToken
    );
    configuration.allowedSources.oldMegaEth = await configureAllowedSource(
      arcSettlementAddress,
      OLD_MEGAETH_TESTNET_CHAIN_ID,
      oldMegaSource,
      false
    );
  }

  writeDeploymentOutput(
    {
      deployedAt: new Date().toISOString(),
      deployer: account.address,
      mode: "add-monad-source",
      prover: POLYMER_TESTNET_PROVER_ADDRESS,
      contracts: {
        arcSettlement: {
          chainId: ARC_CHAIN_ID,
          address: arcSettlementAddress
        },
        monadSource
      },
      tokens: {
        arcUsdc: arcUsdcToken,
        monadSourceToken
      },
      disabledSources: {
        oldMegaEth: {
          chainId: OLD_MEGAETH_TESTNET_CHAIN_ID,
          sourceContract: oldMegaSource
        }
      },
      configured: !skipConfigure,
      configuration
    },
    [
      `ARC_QR_PAYMENT_SETTLEMENT=${arcSettlementAddress}`,
      `VITE_MONAD_USDC_ADDRESS=${monadSourceToken}`,
      `MONAD_USDC_ADDRESS=${monadSourceToken}`,
      `VITE_MONAD_QR_PAYMENT_SOURCE=${monadSource.address}`,
      `MONAD_QR_PAYMENT_SOURCE=${monadSource.address}`
    ]
  );

  console.log("Monad source deployment complete.");
  console.log(`Arc settlement: ${arcSettlementAddress}`);
  console.log(`Monad source:   ${monadSource.address}`);
}

async function runFullDeploy() {
  await assertFunded(routes.base, account.address);
  await assertFunded(routes.monad, account.address);
  await assertFunded(routes.arc, account.address);

  const baseSource = await deploy(routes.base, artifacts.QrPaymentSource, []);
  const monadSource = await deploy(routes.monad, artifacts.QrPaymentSource, []);
  const arcSettlement = await deploy(routes.arc, artifacts.QrPaymentSettlement, [POLYMER_TESTNET_PROVER_ADDRESS]);
  const configuration = { allowedSources: {}, tokenRoutes: {} };

  if (!skipConfigure) {
    configuration.allowedSources.baseSepolia = await configureAllowedSource(
      arcSettlement.address,
      BASE_SEPOLIA_CHAIN_ID,
      baseSource.address,
      true
    );
    configuration.allowedSources.monad = await configureAllowedSource(
      arcSettlement.address,
      MONAD_TESTNET_CHAIN_ID,
      monadSource.address,
      true
    );
    configuration.tokenRoutes.baseSepolia = await configureTokenRoute(
      arcSettlement.address,
      BASE_SEPOLIA_CHAIN_ID,
      baseSourceToken,
      arcUsdcToken
    );
    configuration.tokenRoutes.monad = await configureTokenRoute(
      arcSettlement.address,
      MONAD_TESTNET_CHAIN_ID,
      monadSourceToken,
      arcUsdcToken
    );
  }

  writeDeploymentOutput(
    {
      deployedAt: new Date().toISOString(),
      deployer: account.address,
      mode: "full",
      prover: POLYMER_TESTNET_PROVER_ADDRESS,
      contracts: {
        arcSettlement,
        baseSource,
        monadSource
      },
      tokens: {
        arcUsdc: arcUsdcToken,
        baseSourceToken,
        monadSourceToken
      },
      configured: !skipConfigure,
      configuration
    },
    [
      `ARC_QR_PAYMENT_SETTLEMENT=${arcSettlement.address}`,
      `VITE_BASE_SEPOLIA_QR_PAYMENT_SOURCE=${baseSource.address}`,
      `BASE_SEPOLIA_QR_PAYMENT_SOURCE=${baseSource.address}`,
      `VITE_MONAD_USDC_ADDRESS=${monadSourceToken}`,
      `MONAD_USDC_ADDRESS=${monadSourceToken}`,
      `VITE_MONAD_QR_PAYMENT_SOURCE=${monadSource.address}`,
      `MONAD_QR_PAYMENT_SOURCE=${monadSource.address}`
    ]
  );

  console.log("Deployment complete.");
  console.log(`Arc settlement: ${arcSettlement.address}`);
  console.log(`Base source:    ${baseSource.address}`);
  console.log(`Monad source:   ${monadSource.address}`);
}

async function configureAllowedSource(settlementAddress, sourceChainId, sourceContract, allowed) {
  const transaction = await writeContract(
    routes.arc,
    settlementAddress,
    artifacts.QrPaymentSettlement.abi,
    "setAllowedSource",
    [sourceChainId, sourceContract, allowed]
  );
  return {
    ...transaction,
    chainId: sourceChainId,
    sourceContract,
    allowed
  };
}

async function configureTokenRoute(settlementAddress, sourceChainId, sourceToken, destinationToken) {
  const transaction = await writeContract(
    routes.arc,
    settlementAddress,
    artifacts.QrPaymentSettlement.abi,
    "setTokenRoute",
    [sourceChainId, sourceToken, destinationToken]
  );
  return {
    ...transaction,
    chainId: sourceChainId,
    sourceToken,
    destinationToken
  };
}

function compileContracts() {
  const sources = {
    "QrPaymentSource.sol": {
      content: readFileSync(join(repoRoot, "contracts", "src", "QrPaymentSource.sol"), "utf8")
    },
    "QrPaymentSettlement.sol": {
      content: readFileSync(join(repoRoot, "contracts", "src", "QrPaymentSettlement.sol"), "utf8")
    }
  };
  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"]
        }
      }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter((item) => item.severity === "error") ?? [];
  if (errors.length) {
    throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  }

  return {
    QrPaymentSource: readArtifact(output, "QrPaymentSource.sol", "QrPaymentSource"),
    QrPaymentSettlement: readArtifact(output, "QrPaymentSettlement.sol", "QrPaymentSettlement")
  };
}

function readArtifact(output, fileName, contractName) {
  const artifact = output.contracts?.[fileName]?.[contractName];
  const bytecode = artifact?.evm?.bytecode?.object;
  if (!artifact?.abi || !bytecode) {
    throw new Error(`Missing compiled artifact for ${contractName}.`);
  }
  return {
    abi: artifact.abi,
    bytecode: `0x${bytecode}`
  };
}

async function deploy(route, artifact, args) {
  const publicClient = publicClientFor(route);
  const walletClient = walletClientFor(route);
  console.log(`Deploying ${route.label} contract...`);
  const hash = await walletClient.deployContract({
    account,
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`${route.label} deployment failed: ${hash}`);
  }
  console.log(`${route.label} deployed at ${receipt.contractAddress}`);
  return {
    chainId: route.chainId,
    address: receipt.contractAddress,
    txHash: hash,
    explorerUrl: `${route.explorerUrl}/tx/${hash}`
  };
}

async function writeContract(route, address, abi, functionName, args) {
  const publicClient = publicClientFor(route);
  const walletClient = walletClientFor(route);
  console.log(`Calling ${functionName} on ${route.label}...`);
  const hash = await walletClient.writeContract({
    account,
    address,
    abi,
    functionName,
    args
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") {
    throw new Error(`${functionName} failed on ${route.label}: ${hash}`);
  }
  console.log(`${functionName} confirmed: ${hash}`);
  return {
    transactionChainId: route.chainId,
    txHash: hash,
    explorerUrl: `${route.explorerUrl}/tx/${hash}`
  };
}

async function assertFunded(route, address) {
  const balance = await publicClientFor(route).getBalance({ address });
  if (balance <= 0n) {
    throw new Error(`${route.label} deployer ${address} has zero ${route.nativeCurrency.symbol} balance.`);
  }
  console.log(`${route.label} deployer balance: ${formatEther(balance)} ${route.nativeCurrency.symbol}`);
}

function publicClientFor(route) {
  return createPublicClient({
    chain: route.chain,
    transport: http(route.rpcUrl, { timeout: 15_000 })
  });
}

function walletClientFor(route) {
  return createWalletClient({
    account,
    chain: route.chain,
    transport: http(route.rpcUrl, { timeout: 15_000 })
  });
}

function readPrivateKey(key) {
  const value = readEnv(key);
  if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${key} must be set to a 32-byte hex private key in your local environment.`);
  }
  return value;
}

function readAddress(keys, fallback) {
  for (const key of keys) {
    const value = readEnv(key);
    if (!value) {
      continue;
    }
    if (!isAddress(value)) {
      throw new Error(`${key} must be a valid 0x address.`);
    }
    return getAddress(value);
  }
  if (fallback) {
    return getAddress(fallback);
  }
  throw new Error(`Missing address. Set one of: ${keys.join(", ")}.`);
}

function readOptionalAddress(keys) {
  for (const key of keys) {
    const value = readEnv(key);
    if (!value) {
      continue;
    }
    if (!isAddress(value)) {
      throw new Error(`${key} must be a valid 0x address.`);
    }
    return getAddress(value);
  }
  return undefined;
}

function writeDeploymentOutput(deployment, envLines) {
  mkdirSync(join(repoRoot, "deployments"), { recursive: true });
  const deploymentPath = join(repoRoot, "deployments", `qr-contracts-${Date.now()}.json`);
  writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);

  const envOutputPath = join(repoRoot, ".env.qr-contracts.generated");
  writeFileSync(envOutputPath, [...envLines, ""].join("\n"));

  console.log(`Wrote deployment JSON: ${deploymentPath}`);
  console.log(`Wrote public env output: ${envOutputPath}`);
}

function readEnv(key) {
  return process.env[key]?.trim();
}

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const path = join(repoRoot, fileName);
    if (!existsSync(path)) {
      continue;
    }
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match || process.env[match[1]] !== undefined) {
        continue;
      }
      process.env[match[1]] = unquoteEnvValue(match[2]);
    }
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
