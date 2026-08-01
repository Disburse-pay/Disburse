import type { Hash, Hex } from "viem";
import { normalizeRequestToken, type PaymentRequest, type PaymentToken } from "./payments";
import type { QrStatusPayload } from "./realtime";

type ApiErrorBody = {
  error?: string;
};

export type QrFormStateInput = {
  recipient: string;
  token: PaymentToken;
  amount: string;
  label: string;
  note: string;
  invoiceDate: string;
  /** Disburse ID to notify in-app: "request payment from @name". */
  notify?: string;
  /** Required EIP-712 authorization fields for every server-created QR request. */
  wallet: `0x${string}`;
  expiresAt: string;
  signature: Hex;
};

export type CreatedQrRequest = {
  request: PaymentRequest;
  requestToken: string;
  /** Handle that received an in-app payment request notification. */
  notified?: string;
};

export type QrConfirmationPayload = QrStatusPayload & {
  status: "paid" | "failed" | "open";
};

export async function createRemoteQrRequest(input: QrFormStateInput): Promise<CreatedQrRequest | undefined> {
  const payload = await requestJson<QrStatusPayload & { requestToken?: string }>(
    "/api/qr-requests",
    {
      method: "POST",
      body: JSON.stringify(input)
    },
    // An unknown notify name comes back as a JSON 404 the requester must see.
    // A non-JSON 404 still means this API route is unavailable.
    { jsonNotFoundIsError: Boolean(input.notify) }
  );
  return payload
    ? {
        request: payload.request,
        requestToken: normalizeRequestToken(payload.requestToken ?? ""),
        notified: payload.notified
      }
    : undefined;
}

export async function fetchRemoteQrStatus(
  requestId: string,
  requestToken: string
): Promise<QrStatusPayload | undefined> {
  return requestJson<QrStatusPayload>(`/api/qr-status?id=${encodeURIComponent(requestId)}`, {
    method: "GET",
    headers: requestCapabilityHeader(requestToken)
  });
}

export async function recordRemoteQrSubmission(
  requestId: string,
  requestToken: string,
  txHash: Hash,
  authorization: Hex,
  payer: `0x${string}`,
  submittedAt?: string
): Promise<QrStatusPayload | undefined> {
  return requestJson<QrStatusPayload>("/api/qr-submissions", {
    method: "POST",
    headers: requestCapabilityHeader(requestToken),
    body: JSON.stringify({ id: requestId, txHash, authorization, payer, submittedAt })
  });
}

export async function confirmRemoteQrPayment(
  requestId: string,
  requestToken: string,
  txHash: Hash,
  authorization: Hex
): Promise<QrConfirmationPayload | undefined> {
  return requestJson<QrConfirmationPayload>("/api/qr-confirmations", {
    method: "POST",
    headers: requestCapabilityHeader(requestToken),
    body: JSON.stringify({ id: requestId, txHash, authorization })
  });
}

function requestCapabilityHeader(requestToken: string): Record<string, string> {
  return {
    "X-Disburse-Request-Token": normalizeRequestToken(requestToken)
  };
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: { jsonNotFoundIsError?: boolean } = {}
): Promise<T | undefined> {
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
  const isJson = contentType.includes("application/json");

  if (!isJson) {
    if (response.status === 404) {
      return undefined;
    }
    throw new Error(`Unexpected response from ${url}.`);
  }

  const body = (await response.json()) as T | ApiErrorBody;
  if (response.status === 404 && !options.jsonNotFoundIsError) {
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
