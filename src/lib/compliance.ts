/**
 * Compliance Module — Settlement Proofs, UBL Invoices, Receipt Fingerprints
 *
 * Bridges the gap between onchain payment data and real-world accounting requirements.
 * Produces structured exports that satisfy tax reporting, auditing, and regulatory needs.
 */

import type { Address, Hash } from "viem";
import type { PaymentRequest, Receipt } from "./payments";
import type { SettlementAttestation } from "./attestation";

// ---------- Types ----------

export type SettlementProof = {
  version: 1;
  type: "settlement_proof";
  requestId: string;
  fingerprint: string;
  request: {
    id: string;
    recipient: Address;
    token: string;
    amount: string;
    label: string;
    note?: string;
    invoiceDate?: string;
    createdAt: string;
    expiresAt?: string;
  };
  receipt: {
    txHash: Hash;
    from: Address;
    to: Address;
    token: string;
    amount: string;
    blockNumber: string;
    confirmedAt: string;
    explorerUrl: string;
    chainId?: number;
    sourceChainId?: number;
    sourceTxHash?: Hash;
  };
  attestation?: {
    uid: string;
    fingerprint: string;
    attester: string;
    createdAt: string;
  };
  metadata: {
    generatedAt: string;
    generatedBy: "disburse";
    networkName: string;
    networkChainId: number;
  };
};

// ---------- Settlement Proof ----------

/**
 * Generate a structured settlement proof from a verified payment.
 * This is the primary compliance export — a machine-readable JSON document
 * that proves a specific invoice was paid and verified onchain.
 */
export function generateSettlementProof(
  request: PaymentRequest,
  receipt: Receipt,
  attestation?: SettlementAttestation
): SettlementProof {
  return {
    version: 1,
    type: "settlement_proof",
    requestId: request.id,
    fingerprint: attestation?.fingerprint ?? "",
    request: {
      id: request.id,
      recipient: request.recipient,
      token: request.token,
      amount: request.amount,
      label: request.label,
      note: request.note,
      invoiceDate: request.invoiceDate,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    },
    receipt: {
      txHash: receipt.txHash,
      from: receipt.from,
      to: receipt.to,
      token: receipt.token,
      amount: receipt.amount,
      blockNumber: receipt.blockNumber,
      confirmedAt: receipt.confirmedAt,
      explorerUrl: receipt.explorerUrl,
      chainId: receipt.chainId,
      sourceChainId: receipt.sourceChainId,
      sourceTxHash: receipt.sourceTxHash,
    },
    attestation: attestation
      ? {
          uid: attestation.uid,
          fingerprint: attestation.fingerprint,
          attester: attestation.attester,
          createdAt: attestation.createdAt,
        }
      : undefined,
    metadata: {
      generatedAt: new Date().toISOString(),
      generatedBy: "disburse",
      networkName: "Arc Testnet",
      networkChainId: receipt.chainId ?? 5_042_002,
    },
  };
}

/**
 * Export settlement proof as a downloadable JSON string.
 */
export function exportSettlementProofJson(proof: SettlementProof): string {
  return JSON.stringify(proof, null, 2);
}

/**
 * Validate a settlement proof's structural integrity.
 */
export function validateSettlementProof(proof: SettlementProof): boolean {
  return (
    proof.version === 1 &&
    proof.type === "settlement_proof" &&
    Boolean(proof.requestId) &&
    Boolean(proof.receipt.txHash) &&
    Boolean(proof.receipt.from) &&
    Boolean(proof.receipt.to) &&
    Boolean(proof.receipt.amount) &&
    Boolean(proof.receipt.blockNumber) &&
    Boolean(proof.receipt.confirmedAt)
  );
}

// ---------- Receipt Fingerprint ----------

/**
 * Generate a SHA-256 fingerprint for a receipt.
 * Used for tamper-evidence and deduplication.
 */
export async function generateReceiptFingerprint(receipt: Receipt): Promise<string> {
  const canonical = [
    receipt.requestId,
    receipt.txHash.toLowerCase(),
    receipt.from.toLowerCase(),
    receipt.to.toLowerCase(),
    receipt.amount,
    receipt.blockNumber,
    receipt.confirmedAt,
  ].join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- UBL Invoice Export ----------

/**
 * Generate a UBL 2.1 compliant invoice XML from a verified payment.
 * UBL (Universal Business Language) is the EU e-invoicing standard.
 */
export function generateUBLInvoice(
  request: PaymentRequest,
  receipt: Receipt
): string {
  const issueDate = request.invoiceDate ?? request.createdAt.slice(0, 10);
  const dueDate = request.expiresAt?.slice(0, 10) ?? issueDate;
  const currencyCode = request.token === "EURC" ? "EUR" : "USD";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>${escapeXml(request.id)}</cbc:ID>
  <cbc:IssueDate>${escapeXml(issueDate)}</cbc:IssueDate>
  <cbc:DueDate>${escapeXml(dueDate)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>${escapeXml(request.note ?? "")}</cbc:Note>
  <cbc:DocumentCurrencyCode>${currencyCode}</cbc:DocumentCurrencyCode>

  <!-- Settlement Reference -->
  <cac:AdditionalDocumentReference>
    <cbc:ID>SETTLEMENT_TX</cbc:ID>
    <cbc:DocumentDescription>${escapeXml(receipt.txHash)}</cbc:DocumentDescription>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>SETTLEMENT_BLOCK</cbc:ID>
    <cbc:DocumentDescription>${escapeXml(receipt.blockNumber)}</cbc:DocumentDescription>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>SETTLEMENT_EXPLORER</cbc:ID>
    <cbc:DocumentDescription>${escapeXml(receipt.explorerUrl)}</cbc:DocumentDescription>
  </cac:AdditionalDocumentReference>

  <!-- Payer -->
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="ETH_ADDRESS">${escapeXml(receipt.from)}</cbc:ID>
      </cac:PartyIdentification>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <!-- Payee -->
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="ETH_ADDRESS">${escapeXml(receipt.to)}</cbc:ID>
      </cac:PartyIdentification>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <!-- Payment Means -->
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>ZZZ</cbc:PaymentMeansCode>
    <cbc:InstructionNote>Blockchain settlement via ${escapeXml(request.token)} on Arc Testnet (chain ${receipt.chainId ?? 5042002})</cbc:InstructionNote>
    <cbc:PaymentID>${escapeXml(receipt.txHash)}</cbc:PaymentID>
  </cac:PaymentMeans>

  <!-- Monetary Total -->
  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="${currencyCode}">${escapeXml(request.amount)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  <!-- Line Item -->
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currencyCode}">${escapeXml(request.amount)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(request.label)}</cbc:Name>
      <cbc:Description>${escapeXml(request.note ?? request.label)}</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currencyCode}">${escapeXml(request.amount)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------- Download Helpers ----------

export function downloadSettlementProof(proof: SettlementProof): void {
  const json = exportSettlementProofJson(proof);
  downloadFile(json, `disburse-settlement-${proof.requestId.slice(0, 8)}.json`, "application/json");
}

export function downloadUBLInvoice(request: PaymentRequest, receipt: Receipt): void {
  const xml = generateUBLInvoice(request, receipt);
  downloadFile(xml, `disburse-invoice-${request.id.slice(0, 8)}.xml`, "application/xml");
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
