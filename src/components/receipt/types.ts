import type { PaymentRequest, Receipt } from "../../lib/payments";

export type ReceiptCallbacks = {
  onCopy?: (value: string) => void;
  onCopyFingerprint?: (value: string) => void;
  onExportPdf?: () => void;
  onExportUbl?: () => void;
  onExportJson?: () => void;
};

export type ReceiptAttestation = {
  uid?: string;
  fingerprint?: string;
};

export type ReceiptData = {
  request: PaymentRequest;
  receipt?: Receipt;
  attestation?: ReceiptAttestation;
} & ReceiptCallbacks;
