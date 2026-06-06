import {
  decodeEventLog,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hash,
  type Hex
} from "viem";
import { ARC_EXPLORER_URL, TOKENS, erc20Abi } from "./arc.js";

export type PaymentToken = keyof typeof TOKENS;

export type DecodedTransfer = {
  txHash: Hash;
  blockNumber: bigint;
  logIndex?: number;
  from: Address;
  to: Address;
  value: bigint;
};

export type TransferLog = {
  transactionHash?: Hash | null;
  blockNumber: bigint | null;
  logIndex?: number | null;
  data: Hex;
  topics: [] | [Hex, ...Hex[]];
};

const MAX_LABEL_LENGTH = 80;
const MAX_NOTE_LENGTH = 240;

export function validateRecipient(value: string): Address {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) {
    throw new Error("Enter a valid 0x recipient address.");
  }
  return getAddress(trimmed);
}

export function normalizeLabel(value: string): string {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label) {
    throw new Error("Add a request label.");
  }
  if (label.length > MAX_LABEL_LENGTH) {
    throw new Error(`Keep labels under ${MAX_LABEL_LENGTH} characters.`);
  }
  return label;
}

export function normalizeNote(value: string): string | undefined {
  const note = value.trim().replace(/\s+/g, " ");
  if (!note) {
    return undefined;
  }
  if (note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Keep notes under ${MAX_NOTE_LENGTH} characters.`);
  }
  return note;
}

export function parseTokenAmount(amount: string, token: PaymentToken): bigint {
  const trimmed = amount.trim();
  const decimals = TOKENS[token].decimals;
  const pattern = new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${decimals}})?$`);

  if (!pattern.test(trimmed)) {
    throw new Error(`${token} amounts support up to ${decimals} decimals.`);
  }

  const parsed = parseUnits(trimmed, decimals);
  if (parsed <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }

  return parsed;
}

export function formatTokenAmount(amount: bigint, token: PaymentToken): string {
  const value = formatUnits(amount, TOKENS[token].decimals);
  return trimTrailingZeros(value);
}

export function trimTrailingZeros(value: string): string {
  if (!value.includes(".")) {
    return value;
  }
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

export function shortAddress(value: string, prefix = 6, suffix = 4): string {
  if (value.length <= prefix + suffix + 3) {
    return value;
  }
  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
}

export function isPaymentToken(value: unknown): value is PaymentToken {
  return value === "USDC" || value === "EURC";
}

export function getTokenBySymbol(token: PaymentToken) {
  return TOKENS[token];
}

export type Receipt = {
  requestId: string;
  txHash: Hash;
  from: Address;
  to: Address;
  token: PaymentToken;
  amount: string;
  blockNumber: string;
  confirmedAt: string;
  explorerUrl: string;
  directSettlementLogIndex?: number;
};

export function makeReceipt(request: { id: string; token: PaymentToken }, transfer: DecodedTransfer): Receipt {
  return {
    requestId: request.id,
    txHash: transfer.txHash,
    from: transfer.from,
    to: transfer.to,
    token: request.token,
    amount: formatTokenAmount(transfer.value, request.token),
    blockNumber: transfer.blockNumber.toString(),
    confirmedAt: new Date().toISOString(),
    explorerUrl: toExplorerTxUrl(transfer.txHash)
  };
}

export function decodeTransferLog(log: TransferLog): DecodedTransfer | undefined {
  if (!log.transactionHash || log.blockNumber === null) {
    return undefined;
  }

  try {
    const decoded = decodeEventLog({
      abi: erc20Abi,
      eventName: "Transfer",
      data: log.data,
      topics: log.topics
    });

    if (decoded.eventName !== "Transfer") {
      return undefined;
    }

    const args = decoded.args as { from?: Address; to?: Address; value?: bigint };
    if (!args.from || !args.to || typeof args.value !== "bigint") {
      return undefined;
    }

    return {
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex ?? undefined,
      from: getAddress(args.from),
      to: getAddress(args.to),
      value: args.value
    };
  } catch {
    return undefined;
  }
}

export function toExplorerTxUrl(hash: Hash): string {
  return `${ARC_EXPLORER_URL}/tx/${hash}`;
}

export function toExplorerAddressUrl(address: Address): string {
  return `${ARC_EXPLORER_URL}/address/${address}`;
}
