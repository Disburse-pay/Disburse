import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MIN_GAS_PRICE, TOKENS } from "../src/lib/arc.js";
import {
  ARC_DESTINATION_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  CROSSCHAIN_CHAINS,
  MONAD_TESTNET_CHAIN_ID,
  getCrossChainExplorerTxUrl,
  getAllowedSourceChainIds,
  isRemotePaymentSourceChainId,
  qrPaymentInitiatedEvent,
  qrPaymentSettlementAbi,
  requestIdToBytes32,
  type RemotePaymentSourceChainId,
  type CrossChainPaymentState
} from "../src/lib/crosschain.js";
import {
  isCrossChainPaymentRequest,
  makeCrossChainReceipt,
  parseTokenAmount,
  type PaymentRequest,
  type Receipt
} from "../src/lib/payments.js";
import { HttpError } from "./http.js";
import { decodePolymerProofToHex, pollPolymerProof, queryPolymerProof, requestPolymerProof } from "./polymer.js";

export type CrossChainSourcePayment = {
  sourceChainId: RemotePaymentSourceChainId;
  sourceTxHash: Hash;
  sourceBlockNumber: string;
  sourceLogIndex: number;
  payer: Address;
  recipient: Address;
  sourceToken: Address;
  amount: bigint;
  destinationChainId: typeof ARC_DESTINATION_CHAIN_ID;
  nonce: bigint;
};

export type CrossChainSettlementResult = {
  receipt: Receipt;
  settlement: CrossChainPaymentState;
};

type BaseServerRouteConfig<TChainId extends RemotePaymentSourceChainId | typeof ARC_DESTINATION_CHAIN_ID> = {
  chainId: TChainId;
  rpcUrl: string;
  tokenAddress: Address;
  relayerPrivateKey?: Hex;
};

type SourceRouteConfig = BaseServerRouteConfig<RemotePaymentSourceChainId> & {
  sourceContract: Address;
};

type DestinationRouteConfig = BaseServerRouteConfig<typeof ARC_DESTINATION_CHAIN_ID> & {
  settlementContract: Address;
};

type ServerRouteConfig = SourceRouteConfig | DestinationRouteConfig;

const DEPLOYED_ARC_SETTLEMENT = "0x8c535227ed2b2963a3c1176510bc59e7a7fef07d" as Address;
const DEPLOYED_BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const DEPLOYED_MONAD_USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as Address;
const DEPLOYED_SOURCE_CONTRACTS: Partial<Record<RemotePaymentSourceChainId, Address>> = {
  [BASE_SEPOLIA_CHAIN_ID]: DEPLOYED_ARC_SETTLEMENT
};
const DEPLOYED_SOURCE_TOKENS = {
  [BASE_SEPOLIA_CHAIN_ID]: DEPLOYED_BASE_SEPOLIA_USDC,
  [MONAD_TESTNET_CHAIN_ID]: DEPLOYED_MONAD_USDC
} as const satisfies Record<RemotePaymentSourceChainId, Address>;

type SourceReceiptLog = {
  address: Address;
  data: Hex;
  topics: [Hex, ...Hex[]] | [];
  logIndex?: number | null;
};

type DecodedSourcePaymentArgs = {
  requestId: Hex;
  payer: Address;
  recipient: Address;
  token: Address;
  amount: bigint;
  destinationChainId: bigint;
  nonce: bigint;
};

export async function resolveCrossChainSourcePayment(
  request: PaymentRequest,
  txHash: Hash,
  sourceChainIdInput: unknown
): Promise<CrossChainSourcePayment> {
  if (!isCrossChainPaymentRequest(request)) {
    throw new HttpError(400, "Payment request is not an Arc-settlement QR.");
  }
  if (!isRemotePaymentSourceChainId(sourceChainIdInput)) {
    throw new HttpError(400, "Choose a supported source chain.");
  }
  if (!request.allowedSourceChainIds?.includes(sourceChainIdInput)) {
    throw new HttpError(400, "This source chain is not allowed for the QR request.");
  }

  const config = readServerRouteConfig(sourceChainIdInput, "source");
  const receipt = await readSourceReceipt(config, txHash);
  if (receipt.status === "reverted") {
    throw new HttpError(409, "The submitted source-chain transaction reverted.");
  }

  return resolveSourcePaymentLog(request, receipt, {
    chainId: sourceChainIdInput,
    sourceContract: config.sourceContract,
    tokenAddress: config.tokenAddress
  });
}

export function resolveSourcePaymentLog(
  request: PaymentRequest,
  receipt: TransactionReceipt,
  config: {
    chainId: RemotePaymentSourceChainId;
    sourceContract: Address;
    tokenAddress: Address;
  }
): CrossChainSourcePayment {
  if (!isCrossChainPaymentRequest(request)) {
    throw new Error("Payment request is not an Arc-settlement QR.");
  }

  const expectedRequestId = requestIdToBytes32(request.id).toLowerCase();
  const expectedAmount = parseTokenAmount(request.amount, request.token);
  if (receipt.to?.toLowerCase() === config.tokenAddress.toLowerCase()) {
    throw new HttpError(
      409,
      "The submitted transaction is a USDC token transaction, not the QR pay transaction. Submit or verify the hash from the wallet transaction that calls pay on the QR payment contract."
    );
  }
  if (receipt.to?.toLowerCase() !== config.sourceContract.toLowerCase()) {
    throw new HttpError(
      409,
      `The submitted transaction was not sent to the configured QR payment contract ${config.sourceContract}.`
    );
  }

  const matchingLog = receipt.logs
    .map((log) => readSourceReceiptLog(log, config.sourceContract))
    .filter((log): log is SourceReceiptLog => log !== undefined)
    .map(decodeSourcePaymentLog)
    .find((decoded) => {
      if (!decoded) {
        return false;
      }
      return (
        decoded.requestId.toLowerCase() === expectedRequestId &&
        decoded.recipient.toLowerCase() === request.recipient.toLowerCase() &&
        decoded.token.toLowerCase() === config.tokenAddress.toLowerCase() &&
        decoded.amount === expectedAmount &&
        decoded.destinationChainId === BigInt(request.destinationChainId)
      );
    });

  if (!matchingLog) {
    throw new HttpError(409, "The submitted transaction did not emit the expected cross-chain payment event.");
  }
  if (matchingLog.logIndex === undefined) {
    throw new HttpError(409, "The source payment log is missing its global log index.");
  }

  return {
    sourceChainId: config.chainId,
    sourceTxHash: receipt.transactionHash,
    sourceBlockNumber: receipt.blockNumber.toString(),
    sourceLogIndex: matchingLog.logIndex,
    payer: matchingLog.payer,
    recipient: matchingLog.recipient,
    sourceToken: matchingLog.token,
    amount: matchingLog.amount,
    destinationChainId: request.destinationChainId,
    nonce: matchingLog.nonce
  };
}

export async function relayCrossChainSettlement(
  request: PaymentRequest,
  sourcePayment: CrossChainSourcePayment
): Promise<CrossChainSettlementResult> {
  if (!isCrossChainPaymentRequest(request)) {
    throw new HttpError(400, "Payment request is not an Arc-settlement QR.");
  }

  const destinationConfig = readServerRouteConfig(ARC_DESTINATION_CHAIN_ID, "destination");
  const proofJobId = await requestPolymerProof({
    srcChainId: sourcePayment.sourceChainId,
    srcBlockNumber: sourcePayment.sourceBlockNumber,
    globalLogIndex: sourcePayment.sourceLogIndex
  });
  const proof = await pollPolymerProof(proofJobId);
  const destinationReceipt = await submitSettlement(destinationConfig, proof);

  return {
    receipt: makeCrossChainReceipt({
      request,
      destinationTxHash: destinationReceipt.transactionHash,
      payer: sourcePayment.payer,
      blockNumber: destinationReceipt.blockNumber.toString(),
      explorerUrl: getCrossChainExplorerTxUrl(ARC_DESTINATION_CHAIN_ID, destinationReceipt.transactionHash),
      sourceChainId: sourcePayment.sourceChainId,
      sourceTxHash: sourcePayment.sourceTxHash
    }),
    settlement: {
      destinationChainId: ARC_DESTINATION_CHAIN_ID,
      sourceChainId: sourcePayment.sourceChainId,
      sourceTxHash: sourcePayment.sourceTxHash,
      sourceBlockNumber: sourcePayment.sourceBlockNumber,
      sourceLogIndex: sourcePayment.sourceLogIndex,
      proofJobId: String(proofJobId),
      destinationTxHash: destinationReceipt.transactionHash,
      destinationBlockNumber: destinationReceipt.blockNumber.toString(),
      stage: "settled"
    }
  };
}

/**
 * Request a Polymer proof for a confirmed source payment and return the job id.
 * The proof itself can take 2–5 minutes; it is intentionally NOT awaited here.
 * Persist the returned id and finish the settlement later via
 * tryCompleteCrossChainSettlement (driven by the keeper / status polling), so
 * no single request blocks past the serverless function timeout.
 */
export async function beginCrossChainProof(sourcePayment: CrossChainSourcePayment): Promise<number> {
  return requestPolymerProof({
    srcChainId: sourcePayment.sourceChainId,
    srcBlockNumber: sourcePayment.sourceBlockNumber,
    globalLogIndex: sourcePayment.sourceLogIndex
  });
}

/**
 * One non-blocking step toward settlement: query the Polymer proof exactly once.
 *   - proof not ready -> returns null (caller keeps the request `settling`)
 *   - proof errored   -> throws (caller fails/recovers the request)
 *   - proof ready     -> submits settle() on Arc and returns the receipt + state
 */
export async function tryCompleteCrossChainSettlement(
  request: PaymentRequest,
  sourcePayment: CrossChainSourcePayment,
  proofJobId: number
): Promise<CrossChainSettlementResult | null> {
  if (!isCrossChainPaymentRequest(request)) {
    throw new HttpError(400, "Payment request is not an Arc-settlement QR.");
  }

  const result = await queryPolymerProof(proofJobId);
  if (result.status === "error") {
    throw new Error(result.failureReason || "Polymer proof generation failed.");
  }
  const ready = (result.status === "complete" || result.status === "completed") && Boolean(result.proof);
  if (!ready || !result.proof) {
    return null;
  }

  const proof = decodePolymerProofToHex(result.proof);
  const destinationConfig = readServerRouteConfig(ARC_DESTINATION_CHAIN_ID, "destination");
  const destinationReceipt = await submitSettlement(destinationConfig, proof);

  return {
    receipt: makeCrossChainReceipt({
      request,
      destinationTxHash: destinationReceipt.transactionHash,
      payer: sourcePayment.payer,
      blockNumber: destinationReceipt.blockNumber.toString(),
      explorerUrl: getCrossChainExplorerTxUrl(ARC_DESTINATION_CHAIN_ID, destinationReceipt.transactionHash),
      sourceChainId: sourcePayment.sourceChainId,
      sourceTxHash: sourcePayment.sourceTxHash
    }),
    settlement: {
      destinationChainId: ARC_DESTINATION_CHAIN_ID,
      sourceChainId: sourcePayment.sourceChainId,
      sourceTxHash: sourcePayment.sourceTxHash,
      sourceBlockNumber: sourcePayment.sourceBlockNumber,
      sourceLogIndex: sourcePayment.sourceLogIndex,
      proofJobId: String(proofJobId),
      destinationTxHash: destinationReceipt.transactionHash,
      destinationBlockNumber: destinationReceipt.blockNumber.toString(),
      stage: "settled"
    }
  };
}

export function readCreateCrossChainInput(input: Record<string, unknown>): {
  destinationChainId: typeof ARC_DESTINATION_CHAIN_ID;
  allowedSourceChainIds: ReturnType<typeof getAllowedSourceChainIds>;
} {
  return {
    destinationChainId: ARC_DESTINATION_CHAIN_ID,
    allowedSourceChainIds: getAllowedSourceChainIds()
  };
}

function decodeSourcePaymentLog(log: SourceReceiptLog) {
  try {
    const decoded = decodeEventLog({
      abi: [qrPaymentInitiatedEvent],
      data: log.data,
      eventName: "QrPaymentInitiated",
      topics: log.topics
    });
    if (!isSourcePaymentArgs(decoded.args)) {
      return undefined;
    }
    const args = decoded.args;
    return {
      requestId: args.requestId,
      payer: getAddress(args.payer),
      recipient: getAddress(args.recipient),
      token: getAddress(args.token),
      amount: args.amount,
      destinationChainId: args.destinationChainId,
      nonce: args.nonce,
      logIndex: typeof log.logIndex === "number" ? log.logIndex : undefined
    };
  } catch {
    return undefined;
  }
}

function readSourceReceiptLog(log: TransactionReceipt["logs"][number], sourceContract: Address): SourceReceiptLog | undefined {
  const value: unknown = log;
  if (!isRecord(value)) {
    return undefined;
  }

  const { address, data, logIndex } = value;
  const topics = readLogTopics(value.topics);
  if (
    typeof address !== "string" ||
    !isAddress(address) ||
    address.toLowerCase() !== sourceContract.toLowerCase() ||
    typeof data !== "string" ||
    !isHex(data) ||
    !topics ||
    (logIndex !== undefined && logIndex !== null && typeof logIndex !== "number")
  ) {
    return undefined;
  }

  return {
    address,
    data,
    topics,
    logIndex: typeof logIndex === "number" ? logIndex : undefined
  };
}

function readLogTopics(value: unknown): SourceReceiptLog["topics"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const topics: Hex[] = [];
  for (const topic of value) {
    if (!isHex(topic)) {
      return undefined;
    }
    topics.push(topic);
  }

  if (topics.length === 0) {
    return [];
  }
  return [topics[0], ...topics.slice(1)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isSourcePaymentArgs(args: unknown): args is DecodedSourcePaymentArgs {
  if (!args || typeof args !== "object") {
    return false;
  }

  const candidate = args as Record<string, unknown>;
  return (
    typeof candidate.requestId === "string" &&
    typeof candidate.payer === "string" &&
    typeof candidate.recipient === "string" &&
    typeof candidate.token === "string" &&
    typeof candidate.amount === "bigint" &&
    typeof candidate.destinationChainId === "bigint" &&
    typeof candidate.nonce === "bigint"
  );
}

async function readSourceReceipt(config: SourceRouteConfig, txHash: Hash): Promise<TransactionReceipt> {
  try {
    return await createServerPublicClient(config).getTransactionReceipt({ hash: txHash });
  } catch {
    throw new HttpError(409, "Source-chain transaction receipt is not available yet.");
  }
}

async function submitSettlement(config: DestinationRouteConfig, proof: Hex): Promise<TransactionReceipt> {
  if (!config.relayerPrivateKey) {
    throw new Error(`Relayer private key for ${CROSSCHAIN_CHAINS[config.chainId].label} is not configured.`);
  }

  const account = privateKeyToAccount(config.relayerPrivateKey);
  const chain = CROSSCHAIN_CHAINS[config.chainId].chain;
  const publicClient = createServerPublicClient(config);
  const data = encodeFunctionData({
    abi: qrPaymentSettlementAbi,
    functionName: "settle",
    args: [proof]
  });
  const gas = await publicClient.estimateGas({
    account: account.address,
    to: config.settlementContract,
    data
  });
  const gasPrice = await publicClient.getGasPrice();
  const serializedTransaction = await account.signTransaction({
    chainId: chain.id,
    to: config.settlementContract,
    data,
    gas,
    gasPrice: gasPrice > ARC_MIN_GAS_PRICE ? gasPrice : ARC_MIN_GAS_PRICE,
    nonce: await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending"
    }),
    type: "legacy"
  });
  const hash = await publicClient.sendRawTransaction({
    serializedTransaction
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1
  });
  if (receipt.status !== "success") {
    throw new Error(`Arc settlement transaction reverted: ${hash}`);
  }
  return receipt;
}

function createServerPublicClient(config: ServerRouteConfig) {
  return createPublicClient({
    chain: CROSSCHAIN_CHAINS[config.chainId].chain,
    transport: http(config.rpcUrl, {
      timeout: 10_000
    })
  });
}

function readServerRouteConfig(
  chainId: RemotePaymentSourceChainId,
  use: "source"
): SourceRouteConfig;
function readServerRouteConfig(
  chainId: typeof ARC_DESTINATION_CHAIN_ID,
  use: "destination"
): DestinationRouteConfig;
function readServerRouteConfig(
  chainId: RemotePaymentSourceChainId | typeof ARC_DESTINATION_CHAIN_ID,
  use: "source" | "destination"
): SourceRouteConfig | DestinationRouteConfig {
  const prefix =
    chainId === ARC_DESTINATION_CHAIN_ID
      ? "ARC"
      : chainId === BASE_SEPOLIA_CHAIN_ID
        ? "BASE_SEPOLIA"
        : chainId === MONAD_TESTNET_CHAIN_ID
          ? "MONAD"
          : undefined;
  if (!prefix) {
    throw new Error(`Unsupported cross-chain route ${chainId}.`);
  }
  let tokenAddress =
    readAddress(`${prefix}_USDC_ADDRESS`) ??
    readAddress(`VITE_${prefix}_USDC_ADDRESS`) ??
    readDeployedTokenAddress(chainId) ??
    (chainId === ARC_DESTINATION_CHAIN_ID ? TOKENS.USDC.address : undefined);
  const sourceContract =
    use === "source"
      ? readAddress(`${prefix}_QR_PAYMENT_SOURCE`) ??
        readAddress(`VITE_${prefix}_QR_PAYMENT_SOURCE`) ??
        readDeployedSourceContract(chainId)
      : undefined;
  const settlementContract =
    use === "destination"
      ? readAddress(`${prefix}_QR_PAYMENT_SETTLEMENT`) ??
        readAddress(`VITE_${prefix}_QR_PAYMENT_SETTLEMENT`) ??
        DEPLOYED_ARC_SETTLEMENT
      : undefined;
  const rpcUrl = process.env[`${prefix}_RPC_URL`]?.trim() || CROSSCHAIN_CHAINS[chainId].rpcUrl;
  const relayerPrivateKey = readPrivateKey(`${prefix}_RELAYER_PRIVATE_KEY`);

  if (use === "source") {
    if (!isRemotePaymentSourceChainId(chainId)) {
      throw new Error("Arc cannot be configured as a Polymer source route.");
    }

    if (tokenAddress && sourceContract && tokenAddress.toLowerCase() === sourceContract.toLowerCase()) {
      const deployedTokenAddress = readDeployedTokenAddress(chainId);
      if (deployedTokenAddress && deployedTokenAddress.toLowerCase() !== sourceContract.toLowerCase()) {
        tokenAddress = deployedTokenAddress;
      }
    }

    if (!tokenAddress || !sourceContract) {
      const missing = [];
      if (!tokenAddress) {
        missing.push("USDC token address");
      }
      if (!sourceContract) {
        missing.push("source contract");
      }
      throw new Error(`Cross-chain ${use} route for ${CROSSCHAIN_CHAINS[chainId].label} is missing ${missing.join(", ")}.`);
    }

    return {
      chainId,
      rpcUrl,
      sourceContract,
      tokenAddress,
      relayerPrivateKey
    };
  }

  if (!tokenAddress || !settlementContract) {
    const missing = [];
    if (!tokenAddress) {
      missing.push("USDC token address");
    }
    if (!settlementContract) {
      missing.push("settlement contract");
    }
    throw new Error(`Cross-chain ${use} route for ${CROSSCHAIN_CHAINS[chainId].label} is missing ${missing.join(", ")}.`);
  }

  return {
    chainId: ARC_DESTINATION_CHAIN_ID,
    rpcUrl,
    settlementContract,
    tokenAddress,
    relayerPrivateKey
  };
}

export function readServerRouteConfigForTest(
  chainId: RemotePaymentSourceChainId,
  use: "source"
): SourceRouteConfig;
export function readServerRouteConfigForTest(
  chainId: typeof ARC_DESTINATION_CHAIN_ID,
  use: "destination"
): DestinationRouteConfig;
export function readServerRouteConfigForTest(
  chainId: RemotePaymentSourceChainId | typeof ARC_DESTINATION_CHAIN_ID,
  use: "source" | "destination"
): SourceRouteConfig | DestinationRouteConfig {
  return chainId === ARC_DESTINATION_CHAIN_ID
    ? readServerRouteConfig(chainId, "destination")
    : readServerRouteConfig(chainId, use as "source");
}

function readDeployedSourceContract(chainId: RemotePaymentSourceChainId | typeof ARC_DESTINATION_CHAIN_ID): Address | undefined {
  return isRemotePaymentSourceChainId(chainId) ? DEPLOYED_SOURCE_CONTRACTS[chainId] : undefined;
}

function readDeployedTokenAddress(chainId: RemotePaymentSourceChainId | typeof ARC_DESTINATION_CHAIN_ID): Address | undefined {
  return isRemotePaymentSourceChainId(chainId) ? DEPLOYED_SOURCE_TOKENS[chainId] : undefined;
}

function readAddress(key: string): Address | undefined {
  const value = process.env[key]?.trim();
  if (!value) {
    return undefined;
  }
  return getAddress(value);
}

function readPrivateKey(key: string): Hex | undefined {
  const value = process.env[key]?.trim();
  if (!value) {
    return undefined;
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${key} must be a 32-byte hex private key.`);
  }
  return value as Hex;
}
