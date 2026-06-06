/**
 * PSP — Log fetching
 *
 * Reads the terminal settlement logs from Arc (and source chain when
 * cross-chain) needed to build a PSP document.
 */

import {
  decodeEventLog,
  getAddress,
  keccak256,
  toBytes,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { publicClient, ARC_CHAIN_ID, TOKENS } from "../../src/lib/arc.js";
import {
  qrPaymentInitiatedEvent,
  type RemotePaymentSourceChainId,
} from "../../src/lib/crosschain.js";
import { createCrossChainPublicClient } from "../../src/lib/crosschainOnchain.js";
import type { MarketClaim } from "../../src/lib/markets/types.js";
import type { PaymentRequest, Receipt } from "../../src/lib/payments.js";
import type { PspSettlement, PspSource } from "../../src/lib/psp/types.js";

// ---------- Constants ----------

const QR_PAYMENT_SETTLED_EVENT = {
  type: "event" as const,
  name: "QrPaymentSettled" as const,
  inputs: [
    { name: "settlementId", type: "bytes32", indexed: true },
    { name: "requestId", type: "bytes32", indexed: true },
    { name: "recipient", type: "address", indexed: true },
    { name: "sourceChainId", type: "uint32", indexed: false },
    { name: "payer", type: "address", indexed: false },
    { name: "sourceToken", type: "address", indexed: false },
    { name: "destinationToken", type: "address", indexed: false },
    { name: "amount", type: "uint256", indexed: false },
    { name: "nonce", type: "uint256", indexed: false },
  ],
} as const;

// Mirrors `Market.sol` exactly. Shape kept in lockstep with the on-chain
// event so the same fetch-and-decode pattern from QrPaymentSettled applies.
const MARKET_CLAIMED_EVENT = {
  type: "event" as const,
  name: "MarketClaimed" as const,
  inputs: [
    { name: "settlementId", type: "bytes32", indexed: true },
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "claimant", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
    { name: "outcome", type: "uint8", indexed: false },
  ],
} as const;

const TRANSFER_EVENT = {
  type: "event" as const,
  name: "Transfer" as const,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

// Event topic selectors, computed from the ABI at runtime via viem.
const QR_PAYMENT_SETTLED_SELECTOR = keccak256(
  toBytes("QrPaymentSettled(bytes32,bytes32,address,uint32,address,address,address,uint256,uint256)")
);

const TRANSFER_SELECTOR = keccak256(
  toBytes("Transfer(address,address,uint256)")
);

const MARKET_CLAIMED_SELECTOR = keccak256(
  toBytes("MarketClaimed(bytes32,bytes32,address,uint256,uint8)")
);

// ---------- Types ----------

export type ArcSettlementLog = {
  settlement: PspSettlement;
};

export type SourcePaymentLog = {
  source: PspSource;
};

// ---------- Direct settlement (Arc-to-Arc Transfer) ----------

/**
 * For direct Arc payments, the settlement event is a USDC Transfer log
 * matching the receipt. We synthesize a PspSettlement from it.
 */
export async function readDirectSettlementLog(
  receipt: Receipt,
  request: PaymentRequest
): Promise<ArcSettlementLog> {
  const txReceipt = await publicClient.getTransactionReceipt({
    hash: receipt.txHash,
  });

  const tokenAddress = TOKENS[request.token].address.toLowerCase();
  const transferLog = txReceipt.logs.find((log) => {
    if (
      log.address.toLowerCase() !== tokenAddress ||
      (log as any).topics[0]?.toLowerCase() !== TRANSFER_SELECTOR.toLowerCase()
    ) {
      return false;
    }

    return receipt.directSettlementLogIndex === undefined || log.logIndex === receipt.directSettlementLogIndex;
  });

  if (!transferLog) {
    throw new Error(
      `No Transfer log found in tx ${receipt.txHash} for token ${request.token}`
    );
  }

  const block = await publicClient.getBlock({
    blockNumber: txReceipt.blockNumber,
  });

  return {
    settlement: {
      chainId: ARC_CHAIN_ID,
      txHash: receipt.txHash,
      blockNumber: String(txReceipt.blockNumber),
      settledAt: new Date(Number(block.timestamp) * 1000).toISOString(),
      settlementEvent: {
        contract: getAddress(transferLog.address) as Address,
        settlementId: receipt.txHash as Hex, // For direct transfers, use txHash as settlement ID
        eventTopic: TRANSFER_SELECTOR,
        logIndex: transferLog.logIndex ?? 0,
      },
    },
  };
}

// ---------- Cross-chain settlement (QrPaymentSettled) ----------

/**
 * For cross-chain payments, read the QrPaymentSettled event from the Arc
 * settlement transaction.
 */
export async function readCrossChainSettlementLog(
  receipt: Receipt,
  settlementContract: Address
): Promise<ArcSettlementLog> {
  const txReceipt = await publicClient.getTransactionReceipt({
    hash: receipt.txHash,
  });

  const settledLog = txReceipt.logs.find(
    (log) =>
      log.address.toLowerCase() === settlementContract.toLowerCase() &&
      (log as any).topics[0]?.toLowerCase() === QR_PAYMENT_SETTLED_SELECTOR.toLowerCase()
  );

  if (!settledLog) {
    throw new Error(
      `No QrPaymentSettled log found in tx ${receipt.txHash} from contract ${settlementContract}`
    );
  }

  const decoded = decodeEventLog({
    abi: [QR_PAYMENT_SETTLED_EVENT],
    data: settledLog.data,
    topics: (settledLog as any).topics as [Hex, ...Hex[]],
  });

  const block = await publicClient.getBlock({
    blockNumber: txReceipt.blockNumber,
  });

  return {
    settlement: {
      chainId: ARC_CHAIN_ID,
      txHash: receipt.txHash,
      blockNumber: String(txReceipt.blockNumber),
      settledAt: new Date(Number(block.timestamp) * 1000).toISOString(),
      settlementEvent: {
        contract: getAddress(settlementContract),
        settlementId: (decoded as any).args.settlementId as Hex,
        eventTopic: QR_PAYMENT_SETTLED_SELECTOR,
        logIndex: settledLog.logIndex ?? 0,
      },
    },
  };
}

// ---------- Source-chain log (QrPaymentInitiated) ----------

/**
 * Read the QrPaymentInitiated event from the source chain transaction.
 */
export async function readSourcePaymentLog(
  sourceTxHash: Hash,
  sourceChainId: RemotePaymentSourceChainId,
  sourceContract: Address
): Promise<SourcePaymentLog> {
  const client = createCrossChainPublicClient(sourceChainId);
  const txReceipt = await client.getTransactionReceipt({ hash: sourceTxHash });

  const initiatedLog = txReceipt.logs.find(
    (log) =>
      log.address.toLowerCase() === sourceContract.toLowerCase() &&
      (log as any).topics[0]?.toLowerCase() ===
        keccak256(
          toBytes(
            "QrPaymentInitiated(bytes32,address,address,address,uint256,uint256,uint256)"
          )
        ).toLowerCase()
  );

  if (!initiatedLog) {
    throw new Error(
      `No QrPaymentInitiated log found in tx ${sourceTxHash} on chain ${sourceChainId}`
    );
  }

  const decoded = decodeEventLog({
    abi: [qrPaymentInitiatedEvent],
    data: initiatedLog.data,
    topics: (initiatedLog as any).topics as [Hex, ...Hex[]],
  });

  return {
    source: {
      chainId: sourceChainId,
      txHash: sourceTxHash,
      blockNumber: String(txReceipt.blockNumber),
      payer: (decoded as any).args.payer as Address,
      token: (decoded as any).args.token as Address,
      amount: String((decoded as any).args.amount),
    },
  };
}

// ---------- Market-claim settlement (MarketClaimed) ----------

/**
 * Read the `MarketClaimed` event from the Arc claim transaction.
 *
 * Mirrors `readCrossChainSettlementLog` — the on-chain event was designed in
 * lockstep with QrPaymentSettled so the same fetch-decode-then-assemble
 * pattern produces a valid PspSettlement. Returns the settlement metadata
 * needed by the PSP issuer; the market-side fields (question, outcome,
 * payout) are denormalized at the issuer from the off-chain MarketClaim row.
 *
 * Asserts the event's `settlementId` matches the off-chain row to catch the
 * "wrong tx hash recorded in market_claims" failure mode loudly.
 */
export async function readMarketClaimLog(
  claim: MarketClaim,
  marketContract: Address
): Promise<ArcSettlementLog> {
  const txReceipt = await publicClient.getTransactionReceipt({
    hash: claim.txHash as Hash,
  });

  const claimedLog = txReceipt.logs.find(
    (log) =>
      log.address.toLowerCase() === marketContract.toLowerCase() &&
      (log as any).topics[0]?.toLowerCase() === MARKET_CLAIMED_SELECTOR.toLowerCase()
  );

  if (!claimedLog) {
    throw new Error(
      `No MarketClaimed log found in tx ${claim.txHash} from market ${marketContract}`
    );
  }

  const decoded = decodeEventLog({
    abi: [MARKET_CLAIMED_EVENT],
    data: claimedLog.data,
    topics: (claimedLog as any).topics as [Hex, ...Hex[]],
  });

  const onchainSettlementId = (decoded as any).args.settlementId as Hex;
  if (onchainSettlementId.toLowerCase() !== claim.settlementId.toLowerCase()) {
    throw new Error(
      `Settlement ID mismatch in tx ${claim.txHash}: log emitted ${onchainSettlementId}, market_claims row has ${claim.settlementId}`
    );
  }

  const block = await publicClient.getBlock({
    blockNumber: txReceipt.blockNumber,
  });

  return {
    settlement: {
      chainId: ARC_CHAIN_ID,
      txHash: claim.txHash as Hash,
      blockNumber: String(txReceipt.blockNumber),
      settledAt: new Date(Number(block.timestamp) * 1000).toISOString(),
      settlementEvent: {
        contract: getAddress(marketContract),
        settlementId: onchainSettlementId,
        eventTopic: MARKET_CLAIMED_SELECTOR,
        logIndex: claimedLog.logIndex ?? 0,
      },
    },
  };
}
