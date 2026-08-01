import {
  BRIDGE_CHAINS,
  isBridgeSourceKey,
  isSupportedBridgeRoute,
  normalizeBridgeAmount,
  type BridgeRoute
} from "./config";
import { parseUnits, type Address } from "viem";

export type BridgeRecovery = {
  amount: string;
  burnTxId: string;
  route: BridgeRoute;
};

const EVM_TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_TRANSACTION_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export function parseBridgeRecovery(search: string): BridgeRecovery | undefined {
  const params = new URLSearchParams(search);
  const burnTxId = params.get("tx");
  const amount = params.get("amount");
  const source = params.get("from");
  const destination = params.get("to");

  if (!burnTxId || !amount || !source || destination !== "Arc_Testnet" || !isBridgeSourceKey(source)) {
    return undefined;
  }

  const route: BridgeRoute = { source, destination };
  if (!isSupportedBridgeRoute(route) || !isBridgeTransactionId(source, burnTxId)) {
    return undefined;
  }

  try {
    return {
      amount: normalizeBridgeAmount(amount),
      burnTxId: BRIDGE_CHAINS[source].walletFamily === "evm" ? burnTxId.toLowerCase() : burnTxId,
      route
    };
  } catch {
    return undefined;
  }
}

export function buildBridgeRecoverySearch(recovery: BridgeRecovery): string {
  const params = new URLSearchParams({
    tx: recovery.burnTxId,
    amount: recovery.amount,
    from: recovery.route.source,
    to: recovery.route.destination
  });
  return `?${params.toString()}`;
}

export function buildBridgeLocationSearch(
  currentSearch: string,
  recovery?: BridgeRecovery
): string {
  const current = new URLSearchParams(currentSearch);
  const params = new URLSearchParams();
  if (current.get("bridge") === "1") {
    params.set("bridge", "1");
  }
  if (recovery) {
    params.set("tx", recovery.burnTxId);
    params.set("amount", recovery.amount);
    params.set("from", recovery.route.source);
    params.set("to", recovery.route.destination);
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function recoveryMatchesIntent(
  recovery: BridgeRecovery,
  route: BridgeRoute,
  amount: string | undefined
): boolean {
  return Boolean(
    amount &&
      recovery.amount === amount &&
      recovery.route.source === route.source &&
      recovery.route.destination === route.destination
  );
}

export function isBridgeTransactionId(source: BridgeRoute["source"], value: string): boolean {
  return BRIDGE_CHAINS[source].walletFamily === "solana"
    ? SOLANA_TRANSACTION_SIGNATURE.test(value)
    : EVM_TRANSACTION_HASH.test(value);
}

type CircleMessageResponse = {
  sourceTxHash?: unknown;
  messages?: unknown;
};

type CircleDecodedMessage = {
  cctpVersion?: unknown;
  decodedMessage?: {
    sourceDomain?: unknown;
    destinationDomain?: unknown;
    destinationCaller?: unknown;
    minFinalityThreshold?: unknown;
    decodedMessageBody?: {
      mintRecipient?: unknown;
      amount?: unknown;
    };
  };
};

export async function validateBridgeRecovery(
  recovery: BridgeRecovery,
  destinationAccount: Address
): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const domain = BRIDGE_CHAINS[recovery.route.source].domain;
    const url = `https://iris-api-sandbox.circle.com/v2/messages/${domain}?transactionHash=${encodeURIComponent(recovery.burnTxId)}`;
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (response.status === 404) {
      throw new Error("Recovery safety check: Circle has not indexed this burn yet. Wait a moment and retry.");
    }
    if (!response.ok) {
      throw new Error("Recovery safety check: Circle could not verify this burn. Retry when its API is available.");
    }
    assertBridgeRecoveryMessage(recovery, destinationAccount, await response.json());
  } finally {
    window.clearTimeout(timeout);
  }
}

export function assertBridgeRecoveryMessage(
  recovery: BridgeRecovery,
  destinationAccount: Address,
  payload: unknown
): void {
  const response = payload as CircleMessageResponse;
  const messages = Array.isArray(response?.messages) ? response.messages : [];
  if (messages.length !== 1) {
    throw new Error("Recovery safety check: the source transaction does not contain one unambiguous CCTP burn.");
  }
  if (
    typeof response.sourceTxHash !== "string" ||
    !transactionIdsEqual(recovery.route.source, response.sourceTxHash, recovery.burnTxId)
  ) {
    throw new Error("Recovery safety check: Circle returned a different source transaction.");
  }

  const message = messages[0] as CircleDecodedMessage;
  const decoded = message.decodedMessage;
  const body = decoded?.decodedMessageBody;
  const expectedAmount = parseUnits(recovery.amount, 6).toString();
  const expectedSourceDomain = BRIDGE_CHAINS[recovery.route.source].domain.toString();
  const expectedDestinationDomain = BRIDGE_CHAINS.Arc_Testnet.domain.toString();

  if (
    message.cctpVersion !== 2 ||
    decoded?.sourceDomain !== expectedSourceDomain ||
    decoded.destinationDomain !== expectedDestinationDomain ||
    body?.amount !== expectedAmount ||
    !isRecipientForAddress(body?.mintRecipient, destinationAccount) ||
    !isZeroBytes32(decoded.destinationCaller) ||
    !isStandardFinality(decoded.minFinalityThreshold)
  ) {
    throw new Error(
      "Recovery safety check: the burn does not match this source, amount, Standard route, and Arc recipient."
    );
  }
}

function transactionIdsEqual(source: BridgeRoute["source"], left: string, right: string): boolean {
  return BRIDGE_CHAINS[source].walletFamily === "evm"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isRecipientForAddress(value: unknown, address: Address): boolean {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40,64}$/.test(value)) return false;
  const actual = value.slice(2).toLowerCase().padStart(64, "0");
  const expected = address.slice(2).toLowerCase().padStart(64, "0");
  return actual === expected;
}

function isZeroBytes32(value: unknown): boolean {
  return typeof value === "string" && /^0x0{64}$/i.test(value);
}

function isStandardFinality(value: unknown): boolean {
  return typeof value === "string" && /^\d+$/.test(value) && BigInt(value) >= 2_000n;
}
