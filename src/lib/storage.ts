import type { PaymentRequest, Receipt } from "./payments";

const RETIRED_BROWSER_LEDGER_KEYS = [
  "disburse.requests",
  "disburse.receipts",
  "arc-pay-desk.requests",
  "arc-pay-desk.receipts"
] as const;

export type ExportBundle = {
  exportedAt: string;
  requests: PaymentRequest[];
  receipts: Receipt[];
};

/**
 * Remove data and bearer credentials written by retired browser-ledger
 * releases. Canonical history is fetched with a wallet signature and remains
 * in memory only, so account B can never inherit account A's activity.
 */
export function clearBrowserLedgerCache(): void {
  try {
    const keys = [...RETIRED_BROWSER_LEDGER_KEYS];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (
        key?.startsWith("disburse.inboxAuth.")
        || key?.startsWith("disburse.pending-direct-transfer")
      ) {
        keys.push(key as (typeof keys)[number]);
      }
    }
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

export function upsertRequest(requests: PaymentRequest[], next: PaymentRequest): PaymentRequest[] {
  const index = requests.findIndex((request) => request.id === next.id);
  if (index === -1) {
    return [next, ...requests];
  }
  const copy = [...requests];
  copy[index] = next;
  return copy;
}

export function upsertReceipt(receipts: Receipt[], next: Receipt): Receipt[] {
  const index = receipts.findIndex(
    (receipt) => receipt.requestId === next.requestId || receipt.txHash === next.txHash
  );
  if (index === -1) {
    return [next, ...receipts];
  }
  const copy = [...receipts];
  copy[index] = next;
  return copy;
}

/** Download-only, non-secret reconciliation copy for the active wallet. */
export function buildExportBundle(requests: PaymentRequest[], receipts: Receipt[]): ExportBundle {
  return {
    exportedAt: new Date().toISOString(),
    requests: requests.map(({
      requestToken: _requestToken,
      paymentAuthorization: _paymentAuthorization,
      ...request
    }) => request),
    receipts
  };
}
