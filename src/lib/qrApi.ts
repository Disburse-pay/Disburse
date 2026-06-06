import type { Hash } from "viem";
import type { PaymentSourceChainId } from "./crosschain";
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
};

export type QrConfirmationPayload = QrStatusPayload & {
  status: "paid" | "failed" | "open";
};

export async function createRemoteQrRequest(input: QrFormStateInput): Promise<PaymentRequest | undefined> {
  const payload = await requestJson<QrStatusPayload>("/api/qr-requests", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload?.request;
}

export async function fetchRemoteQrStatus(requestId: string): Promise<QrStatusPayload | undefined> {
  return requestJson<QrStatusPayload>(`/api/qr-status?id=${encodeURIComponent(requestId)}`, {
    method: "GET"
  });
}

export async function recordRemoteQrSubmission(
  requestId: string,
  txHash: Hash,
  submittedAt?: string,
  sourceChainId?: PaymentSourceChainId
): Promise<QrStatusPayload | undefined> {
  return requestJson<QrStatusPayload>("/api/qr-submissions", {
    method: "POST",
    body: JSON.stringify({ id: requestId, txHash, submittedAt, sourceChainId })
  });
}

export async function confirmRemoteQrPayment(
  requestId: string,
  txHash: Hash,
  sourceChainId?: PaymentSourceChainId
): Promise<QrConfirmationPayload | undefined> {
  return requestJson<QrConfirmationPayload>("/api/qr-confirmations", {
    method: "POST",
    body: JSON.stringify({ id: requestId, txHash, sourceChainId })
  });
}

export async function settleRemoteQrPayment(requestId: string): Promise<{ settled: boolean } | undefined> {
  return requestJson<{ settled: boolean }>("/api/qr-settle", {
    method: "POST",
    body: JSON.stringify({ id: requestId })
  });
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
  const isJson = contentType.includes("application/json");

  if (!isJson) {
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
