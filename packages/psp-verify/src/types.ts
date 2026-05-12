/**
 * Portable Settlement Proof (PSP) — Type definitions
 *
 * A PSP is a signed, content-addressed, independently verifiable proof that a
 * specific invoice was settled by a specific onchain transfer on Arc, optionally
 * via a Polymer-proved cross-chain source payment.
 */

import type { Address, Hash, Hex } from "viem";

// ---------- Primitives ----------

export type NetworkMode = "testnet" | "mainnet";

export type PspVersion = 1;

// ---------- Core document fields ----------

export type PspIssuer = {
  /** Human-readable issuer name */
  name: string;
  /** Issuer URL (e.g. https://disburse.app) */
  url: string;
  /** EVM address of the issuer key (secp256k1). Used for ecrecover verification. */
  publicKey: Address;
};

export type PspInvoice = {
  /** Payment request ID from Disburse */
  requestId: string;
  /** Invoice label / description */
  label: string;
  /** Invoice date (ISO-8601) */
  invoiceDate?: string;
  /** Optional note */
  note?: string;
  /** Payer address */
  payer: Address;
  /** Recipient address */
  recipient: Address;
  /** Token symbol (e.g. "USDC") */
  token: string;
  /** Amount as base-10 string (human-readable, e.g. "100.50") */
  amount: string;
};

export type PspSettlementEvent = {
  /** Settlement contract address on Arc */
  contract: Address;
  /** settlementId from QrPaymentSettled event (bytes32 hex) */
  settlementId: Hex;
  /** keccak256 of the event signature */
  eventTopic: Hex;
  /** Log index in the settlement transaction */
  logIndex: number;
};

export type PspSettlement = {
  /** Arc chain ID */
  chainId: number;
  /** Settlement transaction hash on Arc */
  txHash: Hash;
  /** Block number (decimal string) */
  blockNumber: string;
  /** ISO-8601 timestamp when settlement was confirmed */
  settledAt: string;
  /** Settlement event details (present for cross-chain; for direct transfers this captures the Transfer event equivalently) */
  settlementEvent: PspSettlementEvent;
};

export type PspSource = {
  /** Source chain ID */
  chainId: number;
  /** Source transaction hash */
  txHash: Hash;
  /** Block number on source chain (decimal string) */
  blockNumber: string;
  /** Payer address on source chain */
  payer: Address;
  /** Token address on source chain */
  token: Address;
  /** Amount in base units (decimal string) */
  amount: string;
  /** keccak256 of the Polymer proof bytes used to settle */
  polymerProofDigest?: Hex;
};

export type PspLinkedDocument = {
  /** Document kind */
  kind: "ubl" | "pdf" | "custom";
  /** SHA-256 or keccak256 digest of the document content */
  digest: Hex;
  /** Optional URI to retrieve the document */
  uri?: string;
};

// ---------- Signature ----------

export type PspSignatureAlgorithm = "secp256k1-keccak256";

export type PspSignature = {
  /** Signature algorithm */
  alg: PspSignatureAlgorithm;
  /** Hex-encoded compact recoverable signature (65 bytes) */
  value: Hex;
};

// ---------- Core (signable subset) ----------

/**
 * PspCore contains all fields that participate in canonicalization and signing.
 * The digest and signature are computed over the canonical encoding of PspCore.
 */
export type PspCore = {
  version: PspVersion;
  networkMode: NetworkMode;
  issuer: PspIssuer;
  invoice: PspInvoice;
  settlement: PspSettlement;
  /** Present only for cross-chain settlements */
  source?: PspSource;
  /** Linked documents (UBL, PDF, etc.) */
  linkedDocuments?: PspLinkedDocument[];
};

// ---------- Full PSP document ----------

/**
 * PspV1 is the complete Portable Settlement Proof document.
 * It extends PspCore with the computed/derived fields.
 */
export type PspV1 = PspCore & {
  /** keccak256 digest of the canonical bytes */
  digest: Hex;
  /** Issuer signature over the canonical bytes */
  signature: PspSignature;
  /** Unique identifier: `psp:<first-16-hex-of-digest>` */
  uid: string;
  /** ISO-8601 creation timestamp */
  createdAt: string;
};

// ---------- Verification result ----------

export type PspVerifyResult = {
  ok: boolean;
  reason?: string;
  fields?: {
    requestId: string;
    payer: Address;
    recipient: Address;
    token: string;
    amount: string;
    settlementChainId: number;
    settlementTxHash: Hash;
    issuer: Address;
    networkMode: NetworkMode;
  };
};
