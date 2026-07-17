import type { Address } from "viem";
import { buildIdClaimTypedData, ID_CLAIM_TTL_SECONDS, isValidHandle, normalizeHandle } from "./ids";
import type { EthereumProvider } from "./onchain";

export type DisburseId = {
  handle: string;
  address: Address;
  claimedAt: string;
};

type ApiErrorBody = { error?: string };

/**
 * True when the text reads as a Disburse ID rather than an address: an
 * optional leading @ followed by a plausible handle. Used by recipient
 * inputs to offer resolution without touching 0x input.
 */
export function looksLikeHandleInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return false;
  }
  return isValidHandle(normalizeHandle(trimmed.replace(/^@/, "")));
}

export function handleFromInput(value: string): string {
  return normalizeHandle(value.trim().replace(/^@/, ""));
}

export async function resolveIdByHandle(handle: string): Promise<DisburseId | undefined> {
  return requestJson<DisburseId>(`/api/ids?handle=${encodeURIComponent(handleFromInput(handle))}`, {
    method: "GET"
  });
}

export async function lookupIdByAddress(address: Address): Promise<DisburseId | undefined> {
  const result = await requestJson<{ handle: string | null; address: Address; claimedAt?: string }>(
    `/api/ids?address=${encodeURIComponent(address)}`,
    { method: "GET" }
  );
  if (!result || result.handle === null) {
    return undefined;
  }
  return result as DisburseId;
}

/**
 * Claim a handle for the connected wallet: signs the EIP-712 claim with
 * eth_signTypedData_v4 and registers it with the API. Throws with a
 * user-presentable message on rejection or conflict.
 */
export async function claimDisburseId(
  provider: EthereumProvider,
  account: Address,
  handleInput: string
): Promise<DisburseId> {
  const handle = handleFromInput(handleInput);
  if (!isValidHandle(handle)) {
    throw new Error("Names are 3-16 characters: a-z, 0-9, underscore.");
  }

  const expiresAt = Math.floor(Date.now() / 1000) + Math.floor(ID_CLAIM_TTL_SECONDS / 2);
  const typedData = buildIdClaimTypedData({ handle, wallet: account, expiresAt: BigInt(expiresAt) });

  // eth_signTypedData_v4 wants the EIP712Domain type spelled out and a JSON
  // string payload; bigint is not JSON-serializable, so expiresAt travels as
  // a decimal string (identical hash for uint256).
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
    message: { ...typedData.message, expiresAt: expiresAt.toString() }
  };

  const signature = (await provider.request({
    method: "eth_signTypedData_v4",
    params: [account, JSON.stringify(payload)]
  })) as string;

  const claimed = await requestJson<DisburseId>("/api/ids", {
    method: "POST",
    body: JSON.stringify({ handle, address: account, expiresAt, signature })
  });
  if (!claimed) {
    throw new Error("The Disburse ID service is unavailable right now.");
  }
  return claimed;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T | undefined> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });
  } catch {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (response.status === 404) {
      return undefined;
    }
    throw new Error(`Unexpected response from ${url}.`);
  }

  const body = (await response.json()) as T | ApiErrorBody;
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    const error =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed: ${response.status}`;
    throw new Error(error);
  }

  return body as T;
}
