import type { Hash } from "viem";
import type { PaymentRequest, PaymentToken } from "./payments";
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
};

export type CreatedQrRequest = {
  request: PaymentRequest;
  /** Handle that received an in-app payment request notification. */
  notified?: string;
};

export type QrConfirmationPayload = QrStatusPayload & {
  status: "paid" | "failed" | "open";
};

export async function createRemoteQrRequest(input: QrFormStateInput): Promise<CreatedQrRequest | undefined> {
  const payload = await requestJson<QrStatusPayload>(
    "/api/qr-requests",
    {
      method: "POST",
      body: JSON.stringify(input)
    },
    // An unknown notify name comes back as a JSON 404 the requester must see;
    // without notify, 404 keeps meaning "no API here" and we fall back local.
    { jsonNotFoundIsError: Boolean(input.notify) }
  );
  return payload ? { request: payload.request, notified: payload.notified } : undefined;
}

export async function fetchRemoteQrStatus(requestId: string): Promise<QrStatusPayload | undefined> {
  return requestJson<QrStatusPayload>(`/api/qr-status?id=${encodeURIComponent(requestId)}`, {
    method: "GET"
  });
}

export async function recordRemoteQrSubmission(
  requestId: string,
  txHash: Hash,
  submittedAt?: string
): Promise<QrStatusPayload | undefined> {
  return requestJson<QrStatusPayload>("/api/qr-submissions", {
    method: "POST",
    body: JSON.stringify({ id: requestId, txHash, submittedAt })
  });
}

export async function confirmRemoteQrPayment(
  requestId: string,
  txHash: Hash
): Promise<QrConfirmationPayload | undefined> {
  return requestJson<QrConfirmationPayload>("/api/qr-confirmations", {
    method: "POST",
    body: JSON.stringify({ id: requestId, txHash })
  });
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
