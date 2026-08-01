import type { Address } from "viem";
import {
  buildHistoryAccessTypedData,
  DEFAULT_HISTORY_LIMIT,
  HISTORY_AUTH_TTL_SECONDS
} from "./historyAuthorization";
import type { EthereumProvider } from "./onchain";
import type { PaymentRequest, Receipt } from "./payments";

export type WalletHistoryPayload = {
  requests: PaymentRequest[];
  receipts: Receipt[];
  hasMore: boolean;
};

type HistoryAuthorization = {
  wallet: Address;
  limit: number;
  expiresAt: number;
  signature: string;
};

const inMemoryAuthorizations = new Map<string, HistoryAuthorization>();

export async function fetchWalletHistory(
  provider: EthereumProvider,
  wallet: Address,
  limit = DEFAULT_HISTORY_LIMIT
): Promise<WalletHistoryPayload> {
  const authorization = await getHistoryAuthorization(provider, wallet, limit);
  let response: Response;
  try {
    response = await fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(authorization)
    });
  } catch {
    throw new Error("Payment history is temporarily unavailable.");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Payment history returned an unexpected response.");
  }
  const payload = (await response.json()) as Partial<WalletHistoryPayload> & { error?: string };
  if (response.status === 401) {
    inMemoryAuthorizations.delete(historyAuthorizationKey(wallet, limit));
  }
  if (!response.ok) {
    throw new Error(payload.error ?? `Payment history request failed: ${response.status}`);
  }
  if (!Array.isArray(payload.requests) || !Array.isArray(payload.receipts)) {
    throw new Error("Payment history returned an invalid ledger.");
  }
  return {
    requests: payload.requests,
    receipts: payload.receipts,
    hasMore: payload.hasMore === true
  };
}

export function clearHistoryAuthorization(wallet?: Address): void {
  if (!wallet) {
    inMemoryAuthorizations.clear();
    return;
  }
  const prefix = `${wallet.toLowerCase()}:`;
  for (const key of inMemoryAuthorizations.keys()) {
    if (key.startsWith(prefix)) {
      inMemoryAuthorizations.delete(key);
    }
  }
}

async function getHistoryAuthorization(
  provider: EthereumProvider,
  wallet: Address,
  limit: number
): Promise<HistoryAuthorization> {
  const key = historyAuthorizationKey(wallet, limit);
  const cached = inMemoryAuthorizations.get(key);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 30) {
    return cached;
  }

  const expiresAt = now + HISTORY_AUTH_TTL_SECONDS;
  const typedData = buildHistoryAccessTypedData({
    wallet,
    limit,
    expiresAt: BigInt(expiresAt)
  });
  const signature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [
      wallet,
      JSON.stringify({
        ...typedData,
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" }
          ],
          ...typedData.types
        }
      }, (_key, value) => typeof value === "bigint" ? value.toString() : value)
    ]
  });
  if (typeof signature !== "string" || !/^0x(?:[a-fA-F0-9]{2}){64,2048}$/.test(signature)) {
    throw new Error("Wallet did not return a valid history authorization signature.");
  }
  const authorization = { wallet, limit, expiresAt, signature };
  inMemoryAuthorizations.set(key, authorization);
  return authorization;
}

function historyAuthorizationKey(wallet: Address, limit: number): string {
  return `${wallet.toLowerCase()}:${limit}`;
}
