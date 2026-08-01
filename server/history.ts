import { getAddress, isAddress, type Address } from "viem";
import {
  buildHistoryAccessTypedData,
  DEFAULT_HISTORY_LIMIT,
  HISTORY_AUTH_TTL_SECONDS,
  MAX_HISTORY_LIMIT
} from "../src/lib/historyAuthorization.js";
import type { PaymentRequest, Receipt } from "../src/lib/payments.js";
import {
  rowToPaymentRequest,
  rowToReceipt,
  type PaymentReceiptRow,
  type PaymentRequestRow
} from "../src/lib/realtime.js";
import { HttpError } from "./http.js";
import { enforceRedisRateLimit } from "./rate-limit.js";
import {
  openNotificationRequestToken,
  paymentRequestCapabilityAssociatedData,
  type SealedRequestToken
} from "./notifications.js";
import { getSupabaseAdmin } from "./supabase.js";
import { readWalletSignature, verifyWalletTypedData } from "./wallet-auth.js";

type CapabilityRow = {
  request_id?: unknown;
  capability_envelope?: unknown;
};

type HistoryRpcResult = {
  requests?: unknown;
  receipts?: unknown;
  capabilities?: unknown;
  has_more?: unknown;
};

export type WalletHistory = {
  requests: PaymentRequest[];
  receipts: Receipt[];
  hasMore: boolean;
};

export async function readWalletHistory(body: Record<string, unknown>): Promise<WalletHistory> {
  const wallet = readWallet(body.wallet);
  const limit = readLimit(body.limit);
  const expiresAt = readExpiry(body.expiresAt);
  const signature = readWalletSignature(
    body.signature,
    401,
    "A valid history authorization signature is required."
  );
  assertFreshExpiry(expiresAt);

  const authorized = await verifyWalletTypedData({
    ...buildHistoryAccessTypedData({ wallet, limit, expiresAt }),
    address: wallet,
    signature
  });
  if (!authorized) {
    throw new HttpError(401, "History authorization signature does not match the wallet.");
  }
  await enforceRedisRateLimit("history", wallet);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("get_wallet_payment_history", {
    p_wallet: wallet.toLowerCase(),
    p_limit: limit
  });
  if (error) {
    throw new HttpError(503, "Payment history is temporarily unavailable.");
  }

  return normalizeWalletHistory(data, wallet);
}

export function normalizeWalletHistory(value: unknown, wallet: Address): WalletHistory {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(500, "Payment history returned an invalid response.");
  }
  const result = value as HistoryRpcResult;
  if (!Array.isArray(result.requests) || !Array.isArray(result.receipts)) {
    throw new HttpError(500, "Payment history returned an invalid ledger.");
  }

  let requests: PaymentRequest[];
  let receipts: Receipt[];
  try {
    requests = result.requests.map((row) => rowToPaymentRequest(row as PaymentRequestRow));
    receipts = result.receipts.map((row) => rowToReceipt(row as PaymentReceiptRow));
  } catch {
    throw new HttpError(500, "Payment history contains an invalid record.");
  }

  const walletLower = wallet.toLowerCase();
  const receiptByRequest = new Map(receipts.map((receipt) => [receipt.requestId, receipt]));
  requests = requests.filter((request) => {
    const receipt = receiptByRequest.get(request.id);
    return request.recipient.toLowerCase() === walletLower || receipt?.from.toLowerCase() === walletLower;
  });
  const visibleRequestIds = new Set(requests.map((request) => request.id));
  receipts = receipts.filter((receipt) => visibleRequestIds.has(receipt.requestId));

  const capabilityRows = Array.isArray(result.capabilities)
    ? (result.capabilities as CapabilityRow[])
    : [];
  const capabilityByRequest = new Map<string, string>();
  for (const row of capabilityRows) {
    if (
      typeof row.request_id !== "string"
      || !row.capability_envelope
      || typeof row.capability_envelope !== "object"
      || Array.isArray(row.capability_envelope)
    ) {
      continue;
    }
    try {
      const token = openNotificationRequestToken(
        row.capability_envelope as SealedRequestToken,
        paymentRequestCapabilityAssociatedData(wallet, row.request_id)
      );
      if (/^[0-9a-fA-F]{64}$/.test(token)) {
        capabilityByRequest.set(row.request_id, token.toLowerCase());
      }
    } catch {
      // A damaged or key-rotated envelope must never make the entire ledger
      // unavailable. The request remains visible but cannot act as a bearer.
    }
  }

  requests = requests.map((request) => {
    const token =
      request.recipient.toLowerCase() === walletLower
        ? capabilityByRequest.get(request.id)
        : undefined;
    return token ? { ...request, requestToken: token } : request;
  });

  return {
    requests,
    receipts,
    hasMore: result.has_more === true
  };
}

function readWallet(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value.trim())) {
    throw new HttpError(401, "A valid wallet is required for payment history.");
  }
  return getAddress(value.trim());
}

function readLimit(value: unknown): number {
  const limit = value === undefined ? DEFAULT_HISTORY_LIMIT : value;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_HISTORY_LIMIT) {
    throw new HttpError(400, `History limit must be an integer from 1 to ${MAX_HISTORY_LIMIT}.`);
  }
  return limit as number;
}

function readExpiry(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d{1,20}$/.test(value)) {
    return BigInt(value);
  }
  throw new HttpError(401, "History authorization expiry is invalid.");
}

function assertFreshExpiry(expiresAt: bigint): void {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (expiresAt <= now) {
    throw new HttpError(401, "History authorization has expired.");
  }
  if (expiresAt > now + BigInt(HISTORY_AUTH_TTL_SECONDS)) {
    throw new HttpError(401, `History authorization may be valid for at most ${HISTORY_AUTH_TTL_SECONDS} seconds.`);
  }
}
