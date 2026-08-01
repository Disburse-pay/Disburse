import type { Address, Hash } from "viem";
import { buildInboxAccessTypedData, INBOX_ACCESS_TTL_SECONDS } from "./ids";
import type { EthereumProvider } from "./onchain";
import type { PaymentRequest, PaymentToken } from "./payments";

export type InboxAuth = {
  wallet: Address;
  expiresAt: number;
  signature: string;
};

export type InboxNotification = {
  id: string;
  kind: "payment_request" | "payment_received";
  requestId: string | null;
  payload: {
    request?: PaymentRequest;
    fromHandle?: string;
    requestId?: string;
    amount?: string;
    token?: PaymentToken;
    label?: string;
    payer?: Address;
    txHash?: Hash;
  };
  status: "unread" | "read" | "ignored";
  createdAt: string;
};

export type InboxPayload = {
  handle: string | null;
  unreadCount: number;
  notifications: InboxNotification[];
};

const AUTH_STORAGE_PREFIX = "disburse.inboxAuth.";
const inMemoryInboxAuthorizations = new Map<string, InboxAuth>();

/**
 * Return memory-only inbox access for the wallet if it is still valid. Inbox
 * bearer credentials never survive a reload or move through browser storage.
 */
export function readCachedInboxAuth(wallet: Address): InboxAuth | undefined {
  const key = wallet.toLowerCase();
  try {
    // Remove credentials written by older releases as soon as this wallet is
    // observed. This is cleanup only; the value is never read or trusted.
    window.localStorage.removeItem(AUTH_STORAGE_PREFIX + key);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
  const parsed = inMemoryInboxAuthorizations.get(key);
  if (
    !parsed ||
    typeof parsed.expiresAt !== "number" ||
    typeof parsed.signature !== "string" ||
    parsed.expiresAt <= Math.floor(Date.now() / 1000) + 60
  ) {
    inMemoryInboxAuthorizations.delete(key);
    return undefined;
  }
  return { ...parsed, wallet };
}

/** Sign a fresh inbox-access credential and retain it only for this page session. */
export async function requestInboxAuth(provider: EthereumProvider, wallet: Address): Promise<InboxAuth> {
  const expiresAt = Math.floor(Date.now() / 1000) + INBOX_ACCESS_TTL_SECONDS;
  const typedData = buildInboxAccessTypedData({ wallet, expiresAt: BigInt(expiresAt) });

  const payload = {
    domain: typedData.domain,
    primaryType: typedData.primaryType,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }
      ],
      ...typedData.types
    },
    message: { wallet, expiresAt: expiresAt.toString() }
  };

  const signature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [wallet, JSON.stringify(payload)]
  });
  if (
    typeof signature !== "string" ||
    !/^0x(?:[a-fA-F0-9]{2}){64,2048}$/.test(signature)
  ) {
    throw new Error("Wallet did not return a valid inbox authorization signature.");
  }

  const auth: InboxAuth = { wallet, expiresAt, signature };
  inMemoryInboxAuthorizations.set(wallet.toLowerCase(), auth);
  return auth;
}

export function clearInboxAuth(wallet?: Address): void {
  if (!wallet) {
    inMemoryInboxAuthorizations.clear();
    return;
  }
  inMemoryInboxAuthorizations.delete(wallet.toLowerCase());
  try {
    window.localStorage.removeItem(AUTH_STORAGE_PREFIX + wallet.toLowerCase());
  } catch {
    // Ignore storage failures.
  }
}

export async function fetchInbox(auth: InboxAuth): Promise<InboxPayload | undefined> {
  return postInbox(auth, { action: "list" });
}

export async function markInboxRead(auth: InboxAuth): Promise<InboxPayload | undefined> {
  return postInbox(auth, { action: "read" });
}

export async function ignoreInboxNotification(auth: InboxAuth, id: string): Promise<InboxPayload | undefined> {
  return postInbox(auth, { action: "ignore", id });
}

async function postInbox(
  auth: InboxAuth,
  body: Record<string, unknown>
): Promise<InboxPayload | undefined> {
  let response: Response;
  try {
    response = await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wallet: auth.wallet,
        expiresAt: auth.expiresAt,
        signature: auth.signature,
        ...body
      })
    });
  } catch {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined;
  }

  const payload = (await response.json()) as InboxPayload & { error?: string };
  if (response.status === 401) {
    clearInboxAuth(auth.wallet);
    throw new Error(payload.error ?? "Inbox access expired. Sign in to your inbox again.");
  }
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return payload;
}
