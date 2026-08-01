#!/usr/bin/env node

/**
 * Compile or deploy PspVerifier v2 to Arc Testnet.
 *
 * Usage:
 *   node scripts/deploy-psp-verifier.mjs --compile-only
 *   node scripts/deploy-psp-verifier.mjs
 *
 * Required for deployment:
 *   QR_DEPLOYER_PRIVATE_KEY
 *   DISBURSE_PSP_ISSUER_ADDRESS
 *   ARC_SETTLEMENT_CONTRACT
 *   PSP_VERIFIER_OWNER
 *
 * Optional:
 *   ARC_RPC_URL
 *   ALLOW_EOA_PSP_OWNER=true       (required if the target owner has no code)
 *   ALLOW_DEPLOYER_AS_PSP_OWNER=true
 *
 * The PSP signing private key is intentionally not accepted by this script.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  zeroAddress,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, "..");
const require = createRequire(import.meta.url);
const solc = require("solc");
const arcChainId = 5_042_002;
const rpcUrl =
  process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const rpcTimeoutMs = 30_000;
const argumentsSet = new Set(process.argv.slice(2));
const supportedArguments = new Set(["--compile-only"]);

for (const argument of argumentsSet) {
  if (!supportedArguments.has(argument)) {
    throw new Error(`Unsupported argument: ${argument}`);
  }
}

console.log("Compiling PspVerifier v2...");
const source = readFileSync(
  resolve(rootDirectory, "contracts/src/PspVerifier.sol"),
  "utf-8"
);
const solcInput = JSON.stringify({
  language: "Solidity",
  sources: {
    "PspVerifier.sol": { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object"] },
    },
  },
});

const solcOutput = JSON.parse(solc.compile(solcInput));
const compilerErrors = (solcOutput.errors || []).filter(
  (entry) => entry.severity === "error"
);
if (compilerErrors.length > 0) {
  for (const error of compilerErrors) {
    console.error(error.formattedMessage || error.message);
  }
  process.exit(1);
}

const compiled = solcOutput.contracts?.["PspVerifier.sol"]?.PspVerifier;
if (!compiled?.evm?.bytecode?.object) {
  throw new Error("PspVerifier bytecode was not produced.");
}
const abi = compiled.abi;
const bytecode = `0x${compiled.evm.bytecode.object}`;
console.log(`Compiled ${bytecode.length / 2 - 1} bytes of creation bytecode.`);

if (argumentsSet.has("--compile-only")) {
  console.log("Compile-only check complete; no network calls or writes were made.");
  process.exit(0);
}

const requiredEnvironment = {
  QR_DEPLOYER_PRIVATE_KEY: process.env.QR_DEPLOYER_PRIVATE_KEY,
  DISBURSE_PSP_ISSUER_ADDRESS: process.env.DISBURSE_PSP_ISSUER_ADDRESS,
  ARC_SETTLEMENT_CONTRACT: process.env.ARC_SETTLEMENT_CONTRACT,
  PSP_VERIFIER_OWNER: process.env.PSP_VERIFIER_OWNER,
};
const missingEnvironment = Object.entries(requiredEnvironment)
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missingEnvironment.length > 0) {
  throw new Error(
    `Missing required environment: ${missingEnvironment.join(", ")}`
  );
}

const deployer = privateKeyToAccount(
  requiredEnvironment.QR_DEPLOYER_PRIVATE_KEY
);
const issuer = requireNonZeroAddress(
  requiredEnvironment.DISBURSE_PSP_ISSUER_ADDRESS,
  "DISBURSE_PSP_ISSUER_ADDRESS"
);
const settlement = requireNonZeroAddress(
  requiredEnvironment.ARC_SETTLEMENT_CONTRACT,
  "ARC_SETTLEMENT_CONTRACT"
);
const targetOwner = requireNonZeroAddress(
  requiredEnvironment.PSP_VERIFIER_OWNER,
  "PSP_VERIFIER_OWNER"
);

if (
  targetOwner === getAddress(deployer.address) &&
  process.env.ALLOW_DEPLOYER_AS_PSP_OWNER !== "true"
) {
  throw new Error(
    "Refusing a persistent deployer-owned verifier. Set a separate PSP_VERIFIER_OWNER, or explicitly set ALLOW_DEPLOYER_AS_PSP_OWNER=true."
  );
}

const arcChain = {
  id: arcChainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({
  chain: arcChain,
  transport: http(rpcUrl, { timeout: rpcTimeoutMs }),
});
const walletClient = createWalletClient({
  account: deployer,
  chain: arcChain,
  transport: http(rpcUrl, { timeout: rpcTimeoutMs }),
});

const actualChainId = await publicClient.getChainId();
if (actualChainId !== arcChainId) {
  throw new Error(
    `RPC chain mismatch: expected ${arcChainId}, received ${actualChainId}`
  );
}
await requireContractCode(publicClient, settlement, "settlement contract");

const settlementProbeAbi = [
  {
    type: "function",
    name: "settled",
    stateMutability: "view",
    inputs: [{ name: "settlementId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
];
try {
  await publicClient.readContract({
    address: settlement,
    abi: settlementProbeAbi,
    functionName: "settled",
    args: [zeroHash],
  });
} catch (error) {
  throw new Error(
    `ARC_SETTLEMENT_CONTRACT does not expose settled(bytes32): ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

const ownerCode = await publicClient.getCode({ address: targetOwner });
if (
  (!ownerCode || ownerCode === "0x") &&
  targetOwner !== getAddress(deployer.address) &&
  process.env.ALLOW_EOA_PSP_OWNER !== "true"
) {
  throw new Error(
    "PSP_VERIFIER_OWNER has no contract code. Use a multisig/contract owner or explicitly set ALLOW_EOA_PSP_OWNER=true."
  );
}

console.log(`Deployer:   ${deployer.address}`);
console.log(`Issuer:     ${issuer}`);
console.log(`Settlement: ${settlement} (registry version 1)`);
console.log(`Owner:      ${targetOwner}`);
console.log(`Chain:      Arc Testnet (${arcChainId})`);
console.log("Deploying PspVerifier v2...");

const deploymentHash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [settlement, issuer],
});
const receipt = await publicClient.waitForTransactionReceipt({
  hash: deploymentHash,
  confirmations: 2,
});
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error("PspVerifier deployment reverted or returned no address.");
}
const verifierAddress = receipt.contractAddress;
await requireContractCode(publicClient, verifierAddress, "deployed verifier");

const [
  verifierVersion,
  verifierArcChainId,
  fieldsTypehash,
  domainSeparator,
  issuerTrusted,
  registration,
  currentOwner,
] = await Promise.all([
  publicClient.readContract({
    address: verifierAddress,
    abi,
    functionName: "VERIFIER_VERSION",
  }),
  publicClient.readContract({
    address: verifierAddress,
    abi,
    functionName: "ARC_TESTNET_CHAIN_ID",
  }),
  publicClient.readContract({
    address: verifierAddress,
    abi,
    functionName: "PSP_FIELDS_TYPEHASH",
  }),
  publicClient.readContract({
    address: verifierAddress,
    abi,
    functionName: "domainSeparator",
  }),
  publicClient.readContract({
    address: verifierAddress,
    abi,
    functionName: "trustedIssuers",
    args: [issuer],
  }),
  publicClient.readContract({
    address: verifierAddress,
    abi,
    functionName: "settlementRegistrations",
    args: [settlement],
  }),
  publicClient.readContract({
    address: verifierAddress,
    abi,
    functionName: "owner",
  }),
]);
const expectedFieldsTypehash = keccak256(
  stringToHex(
    "PspFields(bytes32 documentDigest,string networkMode,string verificationMode,address settlementContract,uint64 settlementRegistryVersion,bytes32 settlementId,address invoicePayer,address invoiceRecipient,string invoiceToken,string invoiceAmount,string requestId,uint256 settlementChainId,bytes32 settlementTxHash)"
  )
);
const expectedDomainSeparator = keccak256(
  encodeAbiParameters(
    parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
    [
      keccak256(
        stringToHex(
          "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        )
      ),
      keccak256(stringToHex("Disburse PSP Verifier")),
      keccak256(stringToHex("2")),
      BigInt(arcChainId),
      verifierAddress,
    ]
  )
);
if (verifierVersion !== 2n) {
  throw new Error(`Post-deploy check failed: verifier version is ${verifierVersion}.`);
}
if (verifierArcChainId !== BigInt(arcChainId)) {
  throw new Error(`Post-deploy check failed: verifier Arc chain is ${verifierArcChainId}.`);
}
if (fieldsTypehash.toLowerCase() !== expectedFieldsTypehash.toLowerCase()) {
  throw new Error("Post-deploy check failed: unexpected PspFields typehash.");
}
if (domainSeparator.toLowerCase() !== expectedDomainSeparator.toLowerCase()) {
  throw new Error("Post-deploy check failed: unexpected EIP-712 domain separator.");
}
if (!issuerTrusted) {
  throw new Error("Post-deploy check failed: issuer is not trusted.");
}
if (registration[0] !== 1n || registration[1] !== true) {
  throw new Error("Post-deploy check failed: settlement registry version 1 is not enabled.");
}
if (getAddress(currentOwner) !== getAddress(deployer.address)) {
  throw new Error("Post-deploy check failed: unexpected initial owner.");
}

let ownershipStatus = "accepted";
let ownershipTransferHash;
if (targetOwner !== getAddress(deployer.address)) {
  ownershipTransferHash = await walletClient.writeContract({
    address: verifierAddress,
    abi,
    functionName: "transferOwnership",
    args: [targetOwner],
  });
  const transferReceipt = await publicClient.waitForTransactionReceipt({
    hash: ownershipTransferHash,
    confirmations: 2,
  });
  if (transferReceipt.status !== "success") {
    throw new Error("Ownership transfer transaction reverted.");
  }
  const pendingOwner = await publicClient.readContract({
    address: verifierAddress,
    abi,
    functionName: "pendingOwner",
  });
  if (getAddress(pendingOwner) !== targetOwner) {
    throw new Error("Post-transfer check failed: unexpected pending owner.");
  }
  ownershipStatus = "pending_acceptance";
}

const deployment = {
  name: "PspVerifier",
  contractVersion: 2,
  pspFieldsTypehash: fieldsTypehash,
  domainSeparator,
  address: verifierAddress,
  chainId: arcChainId,
  deploymentTxHash: deploymentHash,
  ownershipTransferTxHash: ownershipTransferHash,
  deployer: deployer.address,
  owner: ownershipStatus === "accepted" ? targetOwner : deployer.address,
  pendingOwner:
    ownershipStatus === "pending_acceptance" ? targetOwner : undefined,
  ownershipStatus,
  issuer,
  settlementRegistrations: [
    {
      address: settlement,
      registryVersion: 1,
      enabled: true,
    },
  ],
  blockNumber: receipt.blockNumber.toString(),
  deployedAt: new Date().toISOString(),
  abi,
};

const deploymentsDirectory = resolve(rootDirectory, "deployments");
mkdirSync(deploymentsDirectory, { recursive: true });
const filename = `psp-verifier-v2-${Date.now()}.json`;
writeFileSync(
  resolve(deploymentsDirectory, filename),
  JSON.stringify(deployment, null, 2)
);

console.log(`PspVerifier v2 deployed at ${verifierAddress}.`);
console.log(`Deployment saved to deployments/${filename}.`);
if (ownershipStatus === "pending_acceptance") {
  console.log(
    `Ownership is not complete. ${targetOwner} must call acceptOwnership() before the deployer is removed from service.`
  );
}

function requireNonZeroAddress(value, name) {
  if (!value || !isAddress(value)) {
    throw new Error(`${name} must be a valid EVM address.`);
  }
  const address = getAddress(value);
  if (address === zeroAddress) {
    throw new Error(`${name} must not be the zero address.`);
  }
  return address;
}

async function requireContractCode(client, address, label) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    throw new Error(`${label} ${address} has no bytecode on Arc Testnet.`);
  }
}
