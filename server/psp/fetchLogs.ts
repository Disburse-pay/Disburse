/**
 * PSP — exact on-chain evidence readers.
 *
 * A PSP is signed by the service issuer, so these readers are the trust
 * boundary between mutable application data and on-chain facts. Matching only
 * an event selector or emitter is insufficient: every invoice field and every
 * receipt coordinate must identify one exact, successful log.
 */

import {
  decodeEventLog,
  getAddress,
  keccak256,
  toBytes,
  zeroHash,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { publicClient, ARC_CHAIN_ID, TOKENS } from "../../src/lib/arc.js";
import {
  ARC_GATEWAY_DOMAIN,
  GATEWAY_MINTER_ADDRESS
} from "../../src/lib/gateway/types.js";
import {
  createCrossChainPublicClient,
  isRemotePaymentSourceChainId,
  qrPaymentInitiatedEvent,
  requestIdToBytes32,
  type RemotePaymentSourceChainId,
} from "../../src/lib/crosschain.js";
import {
  isCrossChainPaymentRequest,
  parseTokenAmount,
  type PaymentRequest,
  type Receipt,
} from "../../src/lib/payments.js";
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

const TRANSFER_EVENT = {
  type: "event" as const,
  name: "Transfer" as const,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

const GATEWAY_ATTESTATION_USED_EVENT = {
  type: "event" as const,
  name: "AttestationUsed" as const,
  inputs: [
    { name: "token", type: "address", indexed: true },
    { name: "recipient", type: "address", indexed: true },
    { name: "transferSpecHash", type: "bytes32", indexed: true },
    { name: "sourceDomain", type: "uint32", indexed: false },
    { name: "sourceDepositor", type: "bytes32", indexed: false },
    { name: "sourceSigner", type: "bytes32", indexed: false },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

const QR_PAYMENT_SETTLED_SELECTOR = keccak256(
  toBytes("QrPaymentSettled(bytes32,bytes32,address,uint32,address,address,address,uint256,uint256)")
);

const QR_PAYMENT_INITIATED_SELECTOR = keccak256(
  toBytes("QrPaymentInitiated(bytes32,address,address,address,uint256,uint256,uint256)")
);

const TRANSFER_SELECTOR = keccak256(toBytes("Transfer(address,address,uint256)"));
const GATEWAY_ATTESTATION_USED_SELECTOR = keccak256(
  toBytes("AttestationUsed(address,address,bytes32,uint32,bytes32,bytes32,uint256)")
);

// ---------- Types ----------

export type ArcSettlementLog = {
  settlement: PspSettlement;
};

export type SourcePaymentEvidence = {
  requestId: Hex;
  payer: Address;
  recipient: Address;
  sourceToken: Address;
  amount: bigint;
  destinationChainId: typeof ARC_CHAIN_ID;
  nonce: bigint;
  logIndex: number;
};

export type SourcePaymentLog = {
  source: PspSource;
  evidence: SourcePaymentEvidence;
};

export type CrossChainSettlementEvidence = {
  settlementId: Hex;
  requestId: Hex;
  recipient: Address;
  sourceChainId: RemotePaymentSourceChainId;
  payer: Address;
  sourceToken: Address;
  destinationToken: Address;
  amount: bigint;
  nonce: bigint;
  logIndex: number;
};

export type CrossChainSettlementLog = ArcSettlementLog & {
  evidence: CrossChainSettlementEvidence;
};

type ReceiptLog = {
  address: Address;
  blockHash: Hash | null;
  blockNumber: bigint | null;
  data: Hex;
  logIndex: number | null | undefined;
  removed?: boolean;
  topics: [] | [Hex, ...Hex[]];
  transactionHash: Hash | null;
};

// ---------- Direct settlement (Arc-to-Arc Transfer) ----------

/**
 * Read the one exact token Transfer that backs a direct PSP.
 *
 * New receipts should persist directSettlementLogIndex. Legacy rows may omit
 * it, but are accepted only when exactly one fully matching Transfer exists.
 */
export async function readDirectSettlementLog(
  receipt: Receipt,
  request: PaymentRequest
): Promise<ArcSettlementLog> {
  assertCommonPaymentContext(request, receipt);
  assertDirectPaymentContext(request, receipt);

  const txReceipt = await publicClient.getTransactionReceipt({
    hash: receipt.txHash,
  });
  assertTransactionReceipt(
    txReceipt,
    receipt.txHash,
    receipt.blockNumber,
    receipt.blockHash,
    "Arc settlement"
  );

  const block = await publicClient.getBlock({
    blockHash: txReceipt.blockHash,
  });
  assertReceiptBlock(block, txReceipt, "Arc settlement");

  const tokenAddress = TOKENS[request.token].address;
  const expectedAmount = parseTokenAmount(request.amount, request.token);
  const transferCandidates = (txReceipt.logs as unknown as ReceiptLog[])
    .filter(
      (log) =>
        addressesEqual(log.address, tokenAddress) &&
        selectorMatches(log, TRANSFER_SELECTOR)
    )
    .map((log) => {
      assertLogEnvelope(log, txReceipt, "Transfer");
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        eventName: "Transfer",
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args;
      return {
        log,
        from: getAddress(args.from),
        to: getAddress(args.to),
        value: args.value,
        settlementId: txReceipt.transactionHash as Hex,
        eventTopic: TRANSFER_SELECTOR,
      };
    })
    .filter(
      ({ log, from, to, value }) =>
        (receipt.directSettlementLogIndex === undefined ||
          log.logIndex === receipt.directSettlementLogIndex) &&
        addressesEqual(from, receipt.from) &&
        addressesEqual(to, receipt.to) &&
        addressesEqual(to, request.recipient) &&
        value === expectedAmount
    );

  const gatewayCandidates = (txReceipt.logs as unknown as ReceiptLog[])
    .filter(
      (log) =>
        addressesEqual(log.address, GATEWAY_MINTER_ADDRESS) &&
        selectorMatches(log, GATEWAY_ATTESTATION_USED_SELECTOR)
    )
    .map((log) => {
      assertLogEnvelope(log, txReceipt, "AttestationUsed");
      const decoded = decodeEventLog({
        abi: [GATEWAY_ATTESTATION_USED_EVENT],
        eventName: "AttestationUsed",
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args;
      return {
        log,
        from: gatewayBytes32ToAddress(args.sourceDepositor),
        signer: gatewayBytes32ToAddress(args.sourceSigner),
        to: getAddress(args.recipient),
        token: getAddress(args.token),
        sourceDomain: args.sourceDomain,
        value: args.value,
        settlementId: args.transferSpecHash,
        eventTopic: GATEWAY_ATTESTATION_USED_SELECTOR,
      };
    })
    .filter(
      ({ log, from, signer, to, token, sourceDomain, value }) =>
        (receipt.directSettlementLogIndex === undefined ||
          log.logIndex === receipt.directSettlementLogIndex) &&
        addressesEqual(from, receipt.from) &&
        addressesEqual(signer, receipt.from) &&
        addressesEqual(to, receipt.to) &&
        addressesEqual(to, request.recipient) &&
        addressesEqual(token, tokenAddress) &&
        sourceDomain === ARC_GATEWAY_DOMAIN &&
        value === expectedAmount
    );

  const transfer = selectOneExactLog(
    [...transferCandidates, ...gatewayCandidates],
    `settlement event in tx ${receipt.txHash} matching the payment invoice`
  );

  return {
    settlement: {
      chainId: ARC_CHAIN_ID,
      txHash: txReceipt.transactionHash,
      blockNumber: txReceipt.blockNumber.toString(),
      settledAt: blockTimestampToIso(block.timestamp, "Arc settlement"),
      settlementEvent: {
        contract: getAddress(transfer.log.address),
        settlementId: transfer.settlementId,
        eventTopic: transfer.eventTopic,
        logIndex: transfer.log.logIndex,
      },
    },
  };
}

function gatewayBytes32ToAddress(value: Hex): Address {
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("Gateway settlement contains a non-EVM account identifier.");
  }
  return getAddress(`0x${value.slice(-40)}`);
}

// ---------- Source-chain log (QrPaymentInitiated) ----------

/**
 * Read the exact historical source-chain event. The source block number and
 * global log index were persisted by the original cross-chain flow and are
 * mandatory evidence coordinates.
 */
export async function readSourcePaymentLog(
  receipt: Receipt,
  request: PaymentRequest,
  sourceContract: Address
): Promise<SourcePaymentLog> {
  assertCommonPaymentContext(request, receipt);
  const sourceChainId = assertCrossChainPaymentContext(request, receipt);
  const sourceTxHash = receipt.sourceTxHash!;
  const expectedSourceBlock = request.settlement?.sourceBlockNumber;
  const expectedSourceLogIndex = request.settlement?.sourceLogIndex;
  if (!expectedSourceBlock || !isDecimalInteger(expectedSourceBlock)) {
    throw new Error("Cross-chain PSP issuance requires the persisted source block number.");
  }
  if (!isNonNegativeSafeInteger(expectedSourceLogIndex)) {
    throw new Error("Cross-chain PSP issuance requires the persisted source log index.");
  }

  const client = createCrossChainPublicClient(sourceChainId);
  const txReceipt = await client.getTransactionReceipt({ hash: sourceTxHash });
  assertTransactionReceipt(
    txReceipt,
    sourceTxHash,
    expectedSourceBlock,
    undefined,
    "Source payment"
  );

  const block = await client.getBlock({
    blockHash: txReceipt.blockHash,
  });
  assertReceiptBlock(block, txReceipt, "Source payment");

  const expectedRequestId = requestIdToBytes32(request.id);
  const expectedAmount = parseTokenAmount(request.amount, request.token);
  const candidates = (txReceipt.logs as unknown as ReceiptLog[])
    .filter(
      (log) =>
        addressesEqual(log.address, sourceContract) &&
        selectorMatches(log, QR_PAYMENT_INITIATED_SELECTOR)
    )
    .map((log) => {
      assertLogEnvelope(log, txReceipt, "QrPaymentInitiated");
      const decoded = decodeEventLog({
        abi: [qrPaymentInitiatedEvent],
        eventName: "QrPaymentInitiated",
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args;
      return {
        log,
        requestId: args.requestId,
        payer: getAddress(args.payer),
        recipient: getAddress(args.recipient),
        sourceToken: getAddress(args.token),
        amount: args.amount,
        destinationChainId: args.destinationChainId,
        nonce: args.nonce,
      };
    })
    .filter(
      ({ log, requestId, payer, recipient, amount, destinationChainId }) =>
        log.logIndex === expectedSourceLogIndex &&
        hashesEqual(requestId, expectedRequestId) &&
        addressesEqual(payer, receipt.from) &&
        addressesEqual(recipient, receipt.to) &&
        addressesEqual(recipient, request.recipient) &&
        amount === expectedAmount &&
        destinationChainId === BigInt(ARC_CHAIN_ID)
    );

  const initiated = selectOneExactLog(
    candidates,
    `QrPaymentInitiated in source tx ${sourceTxHash} matching the payment invoice`
  );
  const evidence: SourcePaymentEvidence = {
    requestId: initiated.requestId,
    payer: initiated.payer,
    recipient: initiated.recipient,
    sourceToken: initiated.sourceToken,
    amount: initiated.amount,
    destinationChainId: ARC_CHAIN_ID,
    nonce: initiated.nonce,
    logIndex: initiated.log.logIndex,
  };

  return {
    source: {
      chainId: sourceChainId,
      txHash: txReceipt.transactionHash,
      blockNumber: txReceipt.blockNumber.toString(),
      payer: initiated.payer,
      token: initiated.sourceToken,
      amount: initiated.amount.toString(),
    },
    evidence,
  };
}

// ---------- Cross-chain settlement (QrPaymentSettled) ----------

/**
 * Read the exact Arc settlement event and bind it to both the invoice and the
 * already-validated source event.
 */
export async function readCrossChainSettlementLog(
  receipt: Receipt,
  request: PaymentRequest,
  settlementContract: Address,
  sourceEvidence: SourcePaymentEvidence
): Promise<CrossChainSettlementLog> {
  assertCommonPaymentContext(request, receipt);
  const sourceChainId = assertCrossChainPaymentContext(request, receipt);

  const txReceipt = await publicClient.getTransactionReceipt({
    hash: receipt.txHash,
  });
  assertTransactionReceipt(
    txReceipt,
    receipt.txHash,
    receipt.blockNumber,
    receipt.blockHash,
    "Arc settlement"
  );

  const block = await publicClient.getBlock({
    blockHash: txReceipt.blockHash,
  });
  assertReceiptBlock(block, txReceipt, "Arc settlement");

  const expectedRequestId = requestIdToBytes32(request.id);
  const expectedDestinationToken = TOKENS[request.token].address;
  const expectedAmount = parseTokenAmount(request.amount, request.token);
  const candidates = (txReceipt.logs as unknown as ReceiptLog[])
    .filter(
      (log) =>
        addressesEqual(log.address, settlementContract) &&
        selectorMatches(log, QR_PAYMENT_SETTLED_SELECTOR)
    )
    .map((log) => {
      assertLogEnvelope(log, txReceipt, "QrPaymentSettled");
      const decoded = decodeEventLog({
        abi: [QR_PAYMENT_SETTLED_EVENT],
        eventName: "QrPaymentSettled",
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args;
      return {
        log,
        settlementId: args.settlementId,
        requestId: args.requestId,
        recipient: getAddress(args.recipient),
        sourceChainId: Number(args.sourceChainId),
        payer: getAddress(args.payer),
        sourceToken: getAddress(args.sourceToken),
        destinationToken: getAddress(args.destinationToken),
        amount: args.amount,
        nonce: args.nonce,
      };
    })
    .filter(
      ({
        settlementId,
        requestId,
        recipient,
        sourceChainId: eventSourceChainId,
        payer,
        sourceToken,
        destinationToken,
        amount,
        nonce,
      }) =>
        !hashesEqual(settlementId, zeroHash) &&
        hashesEqual(requestId, expectedRequestId) &&
        hashesEqual(requestId, sourceEvidence.requestId) &&
        addressesEqual(recipient, request.recipient) &&
        addressesEqual(recipient, receipt.to) &&
        addressesEqual(recipient, sourceEvidence.recipient) &&
        eventSourceChainId === sourceChainId &&
        addressesEqual(payer, receipt.from) &&
        addressesEqual(payer, sourceEvidence.payer) &&
        addressesEqual(sourceToken, sourceEvidence.sourceToken) &&
        addressesEqual(destinationToken, expectedDestinationToken) &&
        amount === expectedAmount &&
        amount === sourceEvidence.amount &&
        nonce === sourceEvidence.nonce
    );

  const settled = selectOneExactLog(
    candidates,
    `QrPaymentSettled in tx ${receipt.txHash} matching the payment and source evidence`
  );
  const evidence: CrossChainSettlementEvidence = {
    settlementId: settled.settlementId,
    requestId: settled.requestId,
    recipient: settled.recipient,
    sourceChainId,
    payer: settled.payer,
    sourceToken: settled.sourceToken,
    destinationToken: settled.destinationToken,
    amount: settled.amount,
    nonce: settled.nonce,
    logIndex: settled.log.logIndex,
  };

  return {
    settlement: {
      chainId: ARC_CHAIN_ID,
      txHash: txReceipt.transactionHash,
      blockNumber: txReceipt.blockNumber.toString(),
      settledAt: blockTimestampToIso(block.timestamp, "Arc settlement"),
      settlementEvent: {
        contract: getAddress(settlementContract),
        settlementId: settled.settlementId,
        eventTopic: QR_PAYMENT_SETTLED_SELECTOR,
        logIndex: settled.log.logIndex,
      },
    },
    evidence,
  };
}

// ---------- Validation helpers ----------

function assertCommonPaymentContext(request: PaymentRequest, receipt: Receipt): void {
  if (request.status !== "paid") {
    throw new Error("PSP issuance requires a paid payment request.");
  }
  if (receipt.requestId !== request.id) {
    throw new Error("Payment receipt request id does not match the payment request.");
  }
  if (!request.txHash || !hashesEqual(request.txHash, receipt.txHash)) {
    throw new Error("Payment request transaction hash does not match its receipt.");
  }
  if (!addressesEqual(receipt.to, request.recipient)) {
    throw new Error("Payment receipt recipient does not match the payment request.");
  }
  if (receipt.token !== request.token) {
    throw new Error("Payment receipt token does not match the payment request.");
  }

  let requestAmount: bigint;
  let receiptAmount: bigint;
  try {
    requestAmount = parseTokenAmount(request.amount, request.token);
    receiptAmount = parseTokenAmount(receipt.amount, receipt.token);
  } catch {
    throw new Error("Payment request or receipt amount is invalid.");
  }
  if (requestAmount !== receiptAmount) {
    throw new Error("Payment receipt amount does not match the payment request.");
  }
  if (receipt.chainId !== undefined && receipt.chainId !== ARC_CHAIN_ID) {
    throw new Error(`Payment receipt chain must be Arc ${ARC_CHAIN_ID}.`);
  }
  if (!isDecimalInteger(receipt.blockNumber)) {
    throw new Error("Payment receipt block number is invalid.");
  }
}

function assertDirectPaymentContext(request: PaymentRequest, receipt: Receipt): void {
  if (
    isRemotePaymentSourceChainId(receipt.sourceChainId) ||
    (receipt.sourceTxHash !== undefined &&
      !hashesEqual(receipt.sourceTxHash, receipt.txHash))
  ) {
    throw new Error("A remote-source receipt cannot be issued as a direct PSP.");
  }
  if (
    isCrossChainPaymentRequest(request) &&
    !request.allowedSourceChainIds.includes(ARC_CHAIN_ID)
  ) {
    throw new Error("This Arc-settlement request does not permit direct Arc payment.");
  }
}

function assertCrossChainPaymentContext(
  request: PaymentRequest,
  receipt: Receipt
): RemotePaymentSourceChainId {
  if (!isCrossChainPaymentRequest(request)) {
    throw new Error("Cross-chain PSP issuance requires an Arc-settlement payment request.");
  }
  if (!isRemotePaymentSourceChainId(receipt.sourceChainId) || !receipt.sourceTxHash) {
    throw new Error("Cross-chain PSP issuance requires a remote source chain and transaction.");
  }
  if (!request.allowedSourceChainIds.includes(receipt.sourceChainId)) {
    throw new Error("The receipt source chain is not allowed by the payment request.");
  }
  if (
    !request.settlement ||
    request.settlement.stage !== "settled" ||
    request.settlement.sourceChainId !== receipt.sourceChainId ||
    !request.settlement.sourceTxHash ||
    !hashesEqual(request.settlement.sourceTxHash, receipt.sourceTxHash) ||
    !request.settlement.destinationTxHash ||
    !hashesEqual(request.settlement.destinationTxHash, receipt.txHash) ||
    request.settlement.destinationBlockNumber !== receipt.blockNumber
  ) {
    throw new Error("Cross-chain request settlement metadata does not match its receipt.");
  }
  return receipt.sourceChainId;
}

function assertTransactionReceipt(
  txReceipt: TransactionReceipt,
  expectedHash: Hash,
  expectedBlockNumber: string,
  expectedBlockHash: Hash | undefined,
  label: string
): void {
  if (txReceipt.status !== "success") {
    throw new Error(`${label} transaction reverted.`);
  }
  if (!hashesEqual(txReceipt.transactionHash, expectedHash)) {
    throw new Error(`${label} transaction hash does not match the requested receipt.`);
  }
  if (
    !isHash(txReceipt.blockHash) ||
    txReceipt.blockHash.toLowerCase() === zeroHash
  ) {
    throw new Error(`${label} receipt is missing a valid block hash.`);
  }
  if (
    expectedBlockHash &&
    !hashesEqual(txReceipt.blockHash, expectedBlockHash)
  ) {
    throw new Error(`${label} block hash does not match persisted payment evidence.`);
  }
  if (
    !isDecimalInteger(expectedBlockNumber) ||
    txReceipt.blockNumber !== BigInt(expectedBlockNumber)
  ) {
    throw new Error(`${label} block number does not match persisted payment evidence.`);
  }
}

function assertReceiptBlock(
  block: { hash: Hash | null; number: bigint; timestamp: bigint },
  txReceipt: TransactionReceipt,
  label: string
): void {
  if (
    !block.hash ||
    !hashesEqual(block.hash, txReceipt.blockHash) ||
    block.number !== txReceipt.blockNumber
  ) {
    throw new Error(`${label} block hash or number does not match its transaction receipt.`);
  }
}

function assertLogEnvelope(
  log: ReceiptLog,
  txReceipt: TransactionReceipt,
  eventName: string
): asserts log is ReceiptLog & {
  blockHash: Hash;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hash;
} {
  if (
    !isHash(log.transactionHash) ||
    !isHash(log.blockHash) ||
    log.blockNumber === null ||
    !hashesEqual(log.transactionHash, txReceipt.transactionHash) ||
    log.blockNumber !== txReceipt.blockNumber ||
    !hashesEqual(log.blockHash, txReceipt.blockHash)
  ) {
    throw new Error(`${eventName} log is not part of the exact transaction receipt block.`);
  }
  if (!isNonNegativeSafeInteger(log.logIndex)) {
    throw new Error(`${eventName} log is missing a valid global log index.`);
  }
  if ("removed" in log && log.removed === true) {
    throw new Error(`${eventName} log was removed from the canonical chain.`);
  }
}

function selectOneExactLog<T>(
  candidates: T[],
  description: string
): T {
  if (candidates.length === 0) {
    throw new Error(`No exact ${description} was found.`);
  }
  if (candidates.length > 1) {
    throw new Error(`Ambiguous ${description}: multiple exact logs were found.`);
  }
  return candidates[0];
}

function selectorMatches(log: ReceiptLog, selector: Hex): boolean {
  return Boolean(
    log.topics[0] &&
      log.topics[0].toLowerCase() === selector.toLowerCase()
  );
}

function addressesEqual(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function hashesEqual(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isHash(value: unknown): value is Hash {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isDecimalInteger(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function blockTimestampToIso(timestamp: bigint, label: string): string {
  const milliseconds = Number(timestamp) * 1_000;
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${label} block timestamp is invalid.`);
  }
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} block timestamp is invalid.`);
  }
  return date.toISOString();
}
