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

/**
 * Return cached inbox access for the wallet if it is still valid. The cached
 * signature is a bearer credential scoped to inbox reads and status updates
 * only; it cannot move funds or claim names.
 */
export function readCachedInboxAuth(wallet: Address): InboxAuth | undefined {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_PREFIX + wallet.toLowerCase());
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as InboxAuth;
    if (
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.signature !== "string" ||
      parsed.expiresAt <= Math.floor(Date.now() / 1000) + 60
    ) {
      return undefined;
    }
    return { ...parsed, wallet };
  } catch {
    return undefined;
  }
}

/** Sign a fresh 24h inbox-access credential and cache it for the wallet. */
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

  const signature = (await provider.request({
    method: "eth_signTypedData_v4",
    params: [wallet, JSON.stringify(payload)]
  })) as string;

  const auth: InboxAuth = { wallet, expiresAt, signature };
  try {
    window.localStorage.setItem(AUTH_STORAGE_PREFIX + wallet.toLowerCase(), JSON.stringify(auth));
  } catch {
    // Private mode: the credential just will not survive a reload.
  }
  return auth;
}

export function clearInboxAuth(wallet: Address): void {
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
