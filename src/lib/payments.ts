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
import { ARC_CHAIN_ID, ARC_EXPLORER_URL, TOKENS, erc20Abi } from "./arc.js";
import {
  ARC_DESTINATION_CHAIN_ID,
  getAllowedSourceChainIds,
  isPaymentSourceChainId,
  type PaymentSourceChainId,
  type CrossChainPaymentState
} from "./crosschain.js";

export type PaymentToken = keyof typeof TOKENS;

export type PaymentStatus = "open" | "paid" | "possible_match" | "expired" | "failed";

export type PaymentRequest = {
  id: string;
  recipient: Address;
  token: PaymentToken;
  amount: string;
  label: string;
  note?: string;
  invoiceDate?: string;
  expiresAt?: string;
  dueAt?: string;
  createdAt: string;
  submittedAt?: string;
  startBlock: string;
  status: PaymentStatus;
  txHash?: Hash;
  destinationChainId?: typeof ARC_DESTINATION_CHAIN_ID;
  allowedSourceChainIds?: PaymentSourceChainId[];
  settlement?: CrossChainPaymentState;
};

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
  chainId?: number;
  sourceChainId?: PaymentSourceChainId;
  sourceTxHash?: Hash;
  attestationUid?: string;
  attestationFingerprint?: string;
  directSettlementLogIndex?: number;
};

export type SharePayload = Omit<PaymentRequest, "status" | "txHash" | "submittedAt"> & {
  version: 1;
};

export type CrossChainSharePayload = {
  version: 2;
  id: string;
  recipient: Address;
  token: "USDC";
  amount: string;
  label: string;
  note?: string;
  invoiceDate?: string;
  expiresAt?: string;
  dueAt?: string;
  createdAt: string;
  destinationChainId: typeof ARC_DESTINATION_CHAIN_ID;
  allowedSourceChainIds: PaymentSourceChainId[];
};

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
export const PAYMENT_VALIDITY_MINUTES = 15;

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

export function createExpiry(createdAt: string | Date, minutes = PAYMENT_VALIDITY_MINUTES): string {
  const createdTime = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) {
    throw new Error("Payment request creation time is invalid.");
  }
  return new Date(createdTime + minutes * 60_000).toISOString();
}

export function normalizeInvoiceDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Add an invoice date.");
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error("Add a valid invoice date.");
  }

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Add a valid invoice date.");
  }

  return trimmed;
}

export function normalizeDateTime(value: string, fieldName: string): string {
  const trimmed = value.trim();
  const timestamp = Date.parse(trimmed);
  if (!trimmed || !Number.isFinite(timestamp)) {
    throw new Error(`Payment request ${fieldName} is invalid.`);
  }
  return new Date(timestamp).toISOString();
}

export function isPaymentExpired(request: PaymentRequest, now = new Date()): boolean {
  const expiry = request.expiresAt ?? request.dueAt;
  if (!expiry) {
    return false;
  }
  const expiryTime = new Date(expiry).getTime();
  if (!Number.isFinite(expiryTime)) {
    return true;
  }
  return expiryTime < now.getTime();
}

export function hasPreExpirySubmission(request: PaymentRequest): boolean {
  const expiry = request.expiresAt ?? request.dueAt;
  if (!expiry || !request.submittedAt) {
    return false;
  }

  const expiresAt = new Date(expiry).getTime();
  const submittedAt = new Date(request.submittedAt).getTime();
  if (!Number.isFinite(expiresAt) || !Number.isFinite(submittedAt)) {
    return false;
  }

  return submittedAt <= expiresAt;
}

export function isPaymentPayable(request: PaymentRequest, now = new Date()): boolean {
  if (request.status === "paid" || request.status === "failed") {
    return false;
  }
  return !isPaymentExpired(request, now) || hasPreExpirySubmission(request);
}

export function refreshDerivedStatus(request: PaymentRequest, now = new Date()): PaymentRequest {
  if (request.status === "paid" || request.status === "failed") {
    return request;
  }
  return {
    ...request,
    status:
      isPaymentExpired(request, now) && !hasPreExpirySubmission(request)
        ? "expired"
        : request.status === "possible_match"
          ? "possible_match"
          : "open"
  };
}

export function encodeRequestPayload(request: PaymentRequest): string {
  if (isArcSettlementPaymentRequest(request)) {
    const payload: CrossChainSharePayload = {
      version: 2,
      id: request.id,
      recipient: request.recipient,
      token: "USDC",
      amount: request.amount,
      label: request.label,
      note: request.note,
      invoiceDate: request.invoiceDate,
      expiresAt: request.expiresAt,
      dueAt: request.dueAt,
      createdAt: request.createdAt,
      destinationChainId: ARC_DESTINATION_CHAIN_ID,
      allowedSourceChainIds: request.allowedSourceChainIds?.length
        ? request.allowedSourceChainIds
        : getAllowedSourceChainIds()
    };
    return encodeBase64UrlJson(payload);
  }

  const payload: SharePayload = {
    version: 1,
    id: request.id,
    recipient: request.recipient,
    token: request.token,
    amount: request.amount,
    label: request.label,
    note: request.note,
    invoiceDate: request.invoiceDate,
    expiresAt: request.expiresAt,
    dueAt: request.dueAt,
    createdAt: request.createdAt,
    startBlock: request.startBlock
  };
  return encodeBase64UrlJson(payload);
}

export function decodeRequestPayload(encoded: string): PaymentRequest {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SharePayload | CrossChainSharePayload>;

  if (value.version === 2) {
    return decodeCrossChainRequestPayload(value);
  }

  if (value.version !== 1) {
    throw new Error("Unsupported request version.");
  }

  if (!value.id || !value.recipient || !value.token || !value.amount || !value.label || !value.createdAt || !value.startBlock) {
    throw new Error("Payment request is incomplete.");
  }

  if (!isPaymentToken(value.token)) {
    throw new Error("Unsupported payment token.");
  }

  const startBlock = BigInt(value.startBlock);
  if (startBlock < 0n) {
    throw new Error("Payment request start block is invalid.");
  }

  return {
    id: String(value.id),
    recipient: validateRecipient(value.recipient),
    token: value.token,
    amount: formatTokenAmount(parseTokenAmount(String(value.amount), value.token), value.token),
    label: normalizeLabel(String(value.label)),
    note: value.note ? normalizeNote(String(value.note)) : undefined,
    invoiceDate: value.invoiceDate ? normalizeInvoiceDate(String(value.invoiceDate)) : undefined,
    expiresAt: value.expiresAt ? normalizeDateTime(String(value.expiresAt), "expiry time") : undefined,
    dueAt: value.dueAt ? normalizeDateTime(String(value.dueAt), "due time") : undefined,
    createdAt: normalizeDateTime(String(value.createdAt), "creation time"),
    startBlock: String(startBlock),
    status: "open"
  };
}

export function mergeScannedRequest(existing: PaymentRequest | undefined, scanned: PaymentRequest): PaymentRequest {
  if (!existing || !hasSameRequestPayload(existing, scanned)) {
    return scanned;
  }

  return refreshDerivedStatus({
    ...scanned,
    submittedAt: existing.submittedAt,
    status: existing.status,
    txHash: existing.txHash,
    settlement: existing.settlement ?? scanned.settlement
  });
}

export function isCrossChainPaymentRequest(
  request: Pick<PaymentRequest, "destinationChainId" | "allowedSourceChainIds"> | undefined
): request is PaymentRequest & { destinationChainId: typeof ARC_DESTINATION_CHAIN_ID; allowedSourceChainIds: PaymentSourceChainId[] } {
  return isArcSettlementPaymentRequest(request);
}

export function isArcSettlementPaymentRequest(
  request: Pick<PaymentRequest, "destinationChainId" | "allowedSourceChainIds"> | undefined
): request is PaymentRequest & { destinationChainId: typeof ARC_DESTINATION_CHAIN_ID; allowedSourceChainIds: PaymentSourceChainId[] } {
  return request?.destinationChainId === ARC_DESTINATION_CHAIN_ID && Array.isArray(request.allowedSourceChainIds);
}

export function buildShareUrl(request: PaymentRequest, origin: string): string {
  return `${origin}/pay?r=${encodeRequestPayload(request)}`;
}

export function toExplorerTxUrl(hash: Hash): string {
  return `${ARC_EXPLORER_URL}/tx/${hash}`;
}

export function toExplorerAddressUrl(address: Address): string {
  return `${ARC_EXPLORER_URL}/address/${address}`;
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

export function makeReceipt(request: PaymentRequest, transfer: DecodedTransfer): Receipt {
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

export function makeCrossChainReceipt(input: {
  request: PaymentRequest;
  destinationTxHash: Hash;
  payer: Address;
  blockNumber: string;
  confirmedAt?: string;
  explorerUrl: string;
  sourceChainId: PaymentSourceChainId;
  sourceTxHash: Hash;
}): Receipt {
  return {
    requestId: input.request.id,
    txHash: input.destinationTxHash,
    from: input.payer,
    to: input.request.recipient,
    token: input.request.token,
    amount: input.request.amount,
    blockNumber: input.blockNumber,
    confirmedAt: input.confirmedAt ?? new Date().toISOString(),
    explorerUrl: input.explorerUrl,
    chainId: ARC_CHAIN_ID,
    sourceChainId: input.sourceChainId,
    sourceTxHash: input.sourceTxHash
  };
}

export function transferMatchesRequest(request: PaymentRequest, transfer: DecodedTransfer): boolean {
  return (
    transfer.to.toLowerCase() === request.recipient.toLowerCase() &&
    transfer.value === parseTokenAmount(request.amount, request.token)
  );
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

function hasSameRequestPayload(left: PaymentRequest, right: PaymentRequest): boolean {
  return (
    left.id === right.id &&
    left.recipient.toLowerCase() === right.recipient.toLowerCase() &&
    left.token === right.token &&
    left.amount === right.amount &&
    left.label === right.label &&
    optionalString(left.note) === optionalString(right.note) &&
    optionalString(left.invoiceDate) === optionalString(right.invoiceDate) &&
    optionalString(left.expiresAt) === optionalString(right.expiresAt) &&
    optionalString(left.dueAt) === optionalString(right.dueAt) &&
    left.createdAt === right.createdAt &&
    left.startBlock === right.startBlock &&
    optionalString(left.destinationChainId?.toString()) === optionalString(right.destinationChainId?.toString()) &&
    JSON.stringify(left.allowedSourceChainIds ?? []) === JSON.stringify(right.allowedSourceChainIds ?? [])
  );
}

function optionalString(value: string | undefined): string {
  return value ?? "";
}

function decodeCrossChainRequestPayload(value: Partial<SharePayload | CrossChainSharePayload>): PaymentRequest {
  if (
    !value.id ||
    !value.recipient ||
    !value.token ||
    !value.amount ||
    !value.label ||
    !value.createdAt ||
    !("destinationChainId" in value) ||
    value.destinationChainId !== ARC_DESTINATION_CHAIN_ID ||
    !Array.isArray(value.allowedSourceChainIds)
  ) {
    throw new Error("Arc-settlement payment request is incomplete.");
  }

  if (value.token !== "USDC") {
    throw new Error("Arc-settlement QR payments currently support USDC routes only.");
  }

  const allowedSourceChainIds = value.allowedSourceChainIds.filter(isPaymentSourceChainId);
  if (!allowedSourceChainIds.length) {
    throw new Error("Arc-settlement payment request is missing source chains.");
  }

  return {
    id: String(value.id),
    recipient: validateRecipient(value.recipient),
    token: "USDC",
    amount: formatTokenAmount(parseTokenAmount(String(value.amount), "USDC"), "USDC"),
    label: normalizeLabel(String(value.label)),
    note: value.note ? normalizeNote(String(value.note)) : undefined,
    invoiceDate: value.invoiceDate ? normalizeInvoiceDate(String(value.invoiceDate)) : undefined,
    expiresAt: value.expiresAt ? normalizeDateTime(String(value.expiresAt), "expiry time") : undefined,
    dueAt: value.dueAt ? normalizeDateTime(String(value.dueAt), "due time") : undefined,
    createdAt: normalizeDateTime(String(value.createdAt), "creation time"),
    startBlock: "0",
    status: "open",
    destinationChainId: ARC_DESTINATION_CHAIN_ID,
    allowedSourceChainIds
  };
}

function encodeBase64UrlJson(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
