/**
 * PSP — Log fetching
 *
 * Reads the terminal settlement logs from Arc (and source chain when
 * cross-chain) needed to build a PSP document.
 */

import {
  decodeEventLog,
  getAddress,
  type Address,
  type Hash,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { publicClient, ARC_CHAIN_ID, TOKENS } from "../../src/lib/arc.js";
import {
  ARC_DESTINATION_CHAIN_ID,
  qrPaymentInitiatedEvent,
  qrPaymentSettlementAbi,
  type RemotePaymentSourceChainId,
} from "../../src/lib/crosschain.js";
import { createCrossChainPublicClient } from "../../src/lib/crosschainOnchain.js";
import type { PaymentRequest, Receipt } from "../../src/lib/payments.js";
import type { PspSettlement, PspSettlementEvent, PspSource } from "../../src/lib/psp/types.js";

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

const TRANSFER_EVENT = {
  type: "event" as const,
  name: "Transfer" as const,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

const QR_PAYMENT_SETTLED_TOPIC =
  "0x" + Buffer.from(
    Array.from(
      new Uint8Array(
        // keccak256("QrPaymentSettled(bytes32,bytes32,address,uint32,address,address,address,uint256,uint256)")
        // Precomputed for determinism:
        Buffer.from("a]we compute at runtime below", "utf-8")
      )
    )
  ).toString("hex");

// We'll compute topics from the ABI at runtime using viem utilities
import { keccak256, toBytes, encodeEventTopics } from "viem";

const QR_PAYMENT_SETTLED_SELECTOR = keccak256(
  toBytes("QrPaymentSettled(bytes32,bytes32,address,uint32,address,address,address,uint256,uint256)")
);

const TRANSFER_SELECTOR = keccak256(
  toBytes("Transfer(address,address,uint256)")
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
  const transferLog = txReceipt.logs.find(
    (log) =>
      log.address.toLowerCase() === tokenAddress &&
      (log as any).topics[0]?.toLowerCase() === TRANSFER_SELECTOR.toLowerCase()
  );

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
