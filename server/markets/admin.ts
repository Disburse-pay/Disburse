/**
 * Markets — Admin (relayer-wallet) on-chain operations
 *
 * The MarketFactory deployer owns both the factory itself and (via the
 * factory) the AdminResolver. Admin EOAs reach the chain through this
 * module: createMarket deploys a Market; resolveMarket calls the factory's
 * proxy which calls AdminResolver.resolve which calls Market.resolve.
 *
 * All transactions go out via a single `MARKETS_RELAYER_PRIVATE_KEY` wallet
 * (= the deployer in v1). The legacy-tx signing pattern mirrors the one in
 * `server/crosschain.ts` so the gas-price floor and fallback transport behave
 * consistently across the codebase.
 */

import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  stringToBytes,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MIN_GAS_PRICE, arcTestnet } from "../../src/lib/arc.js";
import { HttpError } from "../http.js";
import type { Outcome } from "../../src/lib/markets/types.js";
import { outcomeToInt } from "./repo.js";
import { createServerArcPublicClient } from "./rpc.js";

// ---------- Configuration ----------

function getRelayerKey(): Hex {
  const key = process.env.MARKETS_RELAYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new HttpError(503, "MARKETS_RELAYER_PRIVATE_KEY is not configured.");
  }
  return key as Hex;
}

/**
 * Address of the admin EOA — derived from MARKETS_RELAYER_PRIVATE_KEY so the
 * caller never has to spell it out separately. Used for audit-log columns
 * like `market_resolutions.resolved_by`.
 */
export function getRelayerAddress(): Address {
  return privateKeyToAccount(getRelayerKey()).address;
}

function getMarketFactoryAddress(): Address {
  const addr = process.env.MARKETS_FACTORY;
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new HttpError(503, "MARKETS_FACTORY is not configured.");
  }
  return getAddress(addr);
}

// Slim ABI: just the function entries we call. Keeps this module independent
// of the deploy artifact while staying in lockstep with MarketFactory.sol.
const FACTORY_ABI = parseAbi([
  "function createMarket(bytes32 marketId, uint64 closesAt, string metadataUri) external returns (address market)",
  "function resolveMarket(bytes32 marketId, uint8 winningOutcome) external",
  "function marketOf(bytes32 marketId) external view returns (address)",
]);

const MARKET_CREATED_EVENT = parseAbiItem(
  "event MarketCreated(bytes32 indexed marketId, address indexed market, uint64 closesAt, address resolver, string metadataUri)"
);

const MARKET_RESOLVED_EVENT = parseAbiItem(
  "event MarketResolved(uint8 winningOutcome, uint64 resolvedAt)"
);

type EventTopics = [] | [Hex, ...Hex[]];
type ReceiptLogWithTopics = {
  address: Address;
  data: Hex;
  topics: EventTopics;
};

// ---------- Helpers ----------

/**
 * Hash an off-chain UUID into the bytes32 the on-chain factory uses to key
 * markets. The same UUID must hash to the same bytes32 on both sides so the
 * backend can later look the market up via `factory.marketOf(hash)`.
 */
export function marketIdToBytes32(uuid: string): Hex {
  return keccak256(stringToBytes(uuid));
}

function relayerClient() {
  // Wallet client wraps the private-key account and produces signed
  // transactions; the server public client uses fallback RPC transport for
  // receipts and reads.
  const publicClient = createServerArcPublicClient({ timeoutMs: 15_000 });
  const account = privateKeyToAccount(getRelayerKey());
  return { publicClient, account };
}

/**
 * Common signed-tx submission for admin calls. Returns the mined receipt or
 * throws an HttpError(502) on revert. Mirrors `server/crosschain.ts`
 * `submitSettlement`.
 */
async function submitAdminTx(to: Address, data: Hex): Promise<{
  txHash: Hash;
  blockNumber: bigint;
  receipt: Awaited<ReturnType<ReturnType<typeof relayerClient>["publicClient"]["waitForTransactionReceipt"]>>;
}> {
  const { publicClient, account } = relayerClient();
  const gas = await publicClient.estimateGas({
    account: account.address,
    to,
    data,
  });
  const gasPrice = await publicClient.getGasPrice();
  const serialized = await account.signTransaction({
    chainId: arcTestnet.id,
    to,
    data,
    gas,
    gasPrice: gasPrice > ARC_MIN_GAS_PRICE ? gasPrice : ARC_MIN_GAS_PRICE,
    nonce: await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    }),
    type: "legacy",
  });
  const txHash = await publicClient.sendRawTransaction({
    serializedTransaction: serialized,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
  });
  if (receipt.status !== "success") {
    throw new HttpError(502, `Admin transaction reverted: ${txHash}`);
  }
  return { txHash, blockNumber: receipt.blockNumber, receipt };
}

// ---------- createMarket ----------

export type CreateMarketResult = {
  /** Off-chain UUID (provided by caller). */
  marketId: string;
  /** bytes32 used on-chain (keccak256 of the UUID string). */
  onchainMarketId: Hex;
  /** Deployed Market contract address. */
  marketAddress: Address;
  /** Factory transaction hash. */
  txHash: Hash;
  blockNumber: string;
};

export async function createMarket(input: {
  marketId: string;
  closesAt: Date;
  metadataUri?: string;
}): Promise<CreateMarketResult> {
  const factory = getMarketFactoryAddress();
  const onchainMarketId = marketIdToBytes32(input.marketId);
  const closesAtSeconds = BigInt(Math.floor(input.closesAt.getTime() / 1000));

  const data = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "createMarket",
    args: [onchainMarketId, closesAtSeconds, input.metadataUri ?? ""],
  });

  const { txHash, blockNumber, receipt } = await submitAdminTx(factory, data);

  // Pull the deployed market address out of the MarketCreated log. Returning
  // the address from the function call is unreliable through eth_sendRawTx,
  // so we decode the event instead.
  const logs = receipt.logs as unknown as ReceiptLogWithTopics[];
  const createdLog = logs.find(
    (log) => log.address.toLowerCase() === factory.toLowerCase()
  );
  if (!createdLog) {
    throw new HttpError(
      502,
      `createMarket tx ${txHash} had no factory log — deployment may have failed silently.`
    );
  }
  const decoded = decodeEventLog({
    abi: [MARKET_CREATED_EVENT],
    data: createdLog.data,
    topics: createdLog.topics,
  }) as { args: { market: Address } };
  const marketAddress = getAddress(decoded.args.market);

  return {
    marketId: input.marketId,
    onchainMarketId,
    marketAddress,
    txHash,
    blockNumber: blockNumber.toString(),
  };
}

// ---------- resolveMarket ----------

export type ResolveMarketResult = {
  marketId: string;
  marketAddress: Address;
  winningOutcome: Outcome;
  txHash: Hash;
  blockNumber: string;
  /** ISO timestamp from the MarketResolved event. */
  resolvedAt: string;
};

export async function resolveMarket(input: {
  marketId: string;
  marketAddress: Address;
  winningOutcome: Outcome;
}): Promise<ResolveMarketResult> {
  const factory = getMarketFactoryAddress();
  const onchainMarketId = marketIdToBytes32(input.marketId);
  const winningInt = outcomeToInt(input.winningOutcome);

  const data = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "resolveMarket",
    args: [onchainMarketId, winningInt],
  });

  const { txHash, blockNumber, receipt } = await submitAdminTx(factory, data);

  // The Market contract (not the factory) emits MarketResolved. Find the log
  // matching the expected market address to extract the resolved-at timestamp.
  const logs = receipt.logs as unknown as ReceiptLogWithTopics[];
  const resolvedLog = logs.find(
    (log) =>
      log.address.toLowerCase() === input.marketAddress.toLowerCase()
  );

  let resolvedAtSeconds: bigint | undefined;
  if (resolvedLog) {
    try {
      const decoded = decodeEventLog({
        abi: [MARKET_RESOLVED_EVENT],
        data: resolvedLog.data,
        topics: resolvedLog.topics,
      }) as { args: { resolvedAt: bigint } };
      resolvedAtSeconds = decoded.args.resolvedAt;
    } catch {
      // Fallback to block timestamp below.
    }
  }

  if (resolvedAtSeconds === undefined) {
    // Falling back to the block timestamp keeps the row populated even if
    // the event log decode races (re-org, RPC bug). Logged because it's
    // unusual — the loud failure mode would be no MarketResolved event at all.
    console.warn(
      `[markets/admin] resolveMarket ${input.marketId}: MarketResolved log missing or undecodable, falling back to block timestamp`
    );
    const block = await relayerClient().publicClient.getBlock({
      blockNumber: receipt.blockNumber,
    });
    resolvedAtSeconds = block.timestamp;
  }

  return {
    marketId: input.marketId,
    marketAddress: input.marketAddress,
    winningOutcome: input.winningOutcome,
    txHash,
    blockNumber: blockNumber.toString(),
    resolvedAt: new Date(Number(resolvedAtSeconds) * 1000).toISOString(),
  };
}
