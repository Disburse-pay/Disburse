/**
 * Attestation Engine — Verifiable Settlement Receipts (VSR)
 *
 * Creates structured, verifiable attestation records for settled payments.
 * When EAS (Ethereum Attestation Service) is available on Arc or Base Sepolia,
 * these can be submitted onchain. Until then, they serve as locally-verifiable
 * settlement proofs with cryptographic fingerprints.
 */

import type { Address, Hash } from "viem";
import type { PaymentRequest, Receipt } from "./payments";

// ---------- Types ----------

export type AttestationSchema = {
  requestId: string;
  recipient: Address;
  payer: Address;
  token: string;
  amount: string;
  txHash: Hash;
  blockNumber: string;
  settledAt: string;
  chainId: number;
  invoiceLabel: string;
  invoiceDate?: string;
  note?: string;
  sourceChainId?: number;
  sourceTxHash?: Hash;
};

export type SettlementAttestation = {
  uid: string;
  schema: AttestationSchema;
  fingerprint: string;
  createdAt: string;
  version: 1;
  attester: "local" | "eas";
  easUid?: string;
  easUrl?: string;
};

// EAS Schema Registry UID (Base Sepolia — registered for Disburse)
export const EAS_SCHEMA_UID =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
export const EAS_BASE_SEPOLIA_URL = "https://base-sepolia.easscan.org";

// ---------- Core ----------

/**
 * Build a structured attestation schema from a verified payment.
 */
export function buildAttestationSchema(
  request: PaymentRequest,
  receipt: Receipt
): AttestationSchema {
  return {
    requestId: request.id,
    recipient: receipt.to,
    payer: receipt.from,
    token: request.token,
    amount: request.amount,
    txHash: receipt.txHash,
    blockNumber: receipt.blockNumber,
    settledAt: receipt.confirmedAt,
    chainId: receipt.chainId ?? 5_042_002,
    invoiceLabel: request.label,
    invoiceDate: request.invoiceDate,
    note: request.note,
    sourceChainId: receipt.sourceChainId,
    sourceTxHash: receipt.sourceTxHash,
  };
}

/**
 * Generate a deterministic fingerprint for a settlement attestation.
 * SHA-256 of canonical fields ensures tamper-evidence.
 */
export async function generateAttestationFingerprint(
  schema: AttestationSchema
): Promise<string> {
  const canonical = [
    schema.requestId,
    schema.recipient.toLowerCase(),
    schema.payer.toLowerCase(),
    schema.token,
    schema.amount,
    schema.txHash.toLowerCase(),
    schema.blockNumber,
    schema.settledAt,
    String(schema.chainId),
  ].join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create a local settlement attestation.
 * Returns a structured attestation object with a cryptographic fingerprint.
 */
export async function createSettlementAttestation(
  request: PaymentRequest,
  receipt: Receipt
): Promise<SettlementAttestation> {
  const schema = buildAttestationSchema(request, receipt);
  const fingerprint = await generateAttestationFingerprint(schema);
  const uid = `vsr:${fingerprint.slice(0, 16)}`;

  return {
    uid,
    schema,
    fingerprint,
    createdAt: new Date().toISOString(),
    version: 1,
    attester: "local",
  };
}

/**
 * Validate a settlement attestation's fingerprint against its schema.
 */
export async function validateAttestation(
  attestation: SettlementAttestation
): Promise<boolean> {
  const expected = await generateAttestationFingerprint(attestation.schema);
  return expected === attestation.fingerprint;
}

/**
 * Serialize attestation to a portable JSON string.
 */
export function exportAttestation(attestation: SettlementAttestation): string {
  return JSON.stringify(attestation, null, 2);
}

/**
 * Parse and validate an attestation from JSON.
 */
export function importAttestation(json: string): SettlementAttestation {
  const parsed = JSON.parse(json) as SettlementAttestation;
  if (parsed.version !== 1 || !parsed.uid || !parsed.fingerprint || !parsed.schema) {
    throw new Error("Invalid attestation format.");
  }
  return parsed;
}
