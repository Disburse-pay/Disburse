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

/**
 * Market-claim block for PSPs that prove a prediction-market payout.
 *
 * Exactly one of `invoice` or `marketClaim` is present on a PSP core. Verifiers
 * MUST ignore unknown fields per spec §2.3, so v1.0 verifiers continue to
 * read v1.1 PSPs without error — they just won't surface the market context.
 */
export type PspMarketClaim = {
  /** Off-chain market UUID */
  marketId: string;
  /** Market contract address on Arc */
  onchainMarket: Address;
  /** Denormalized question text so the PSP is self-describing offline */
  question: string;
  /** Which outcome the claimant held (and won) */
  outcome: "YES" | "NO";
  /** Resolved winning outcome (will equal `outcome` for a successful claim) */
  winningOutcome: "YES" | "NO";
  /** Shares redeemed (1e6 fixed-point, stringified) */
  sharesRedeemed: string;
  /** USDC paid out (human-readable, e.g. "5.00") */
  payoutAmount: string;
  /** When the market was resolved (ISO-8601) */
  resolvedAt: string;
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
  /**
   * Payment-invoice context. Present for payment PSPs (the original v1 shape).
   * Made optional in v1.1 — market-claim PSPs use `marketClaim` instead. Exactly
   * one of `invoice` or `marketClaim` MUST be set on a valid PSP.
   */
  invoice?: PspInvoice;
  /**
   * Market-claim context for prediction-market payout PSPs. Added in v1.1.
   * Mutually exclusive with `invoice`.
   */
  marketClaim?: PspMarketClaim;
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

/**
 * Verifier output shape. The discriminator `kind` lets consumers branch on
 * payment vs market-claim PSPs; invoice-only and marketClaim-only fields are
 * each optional. Always-present fields (chain id, tx hash, issuer, network)
 * are non-optional so callers can rely on them without narrowing.
 */
export type PspVerifyFields = {
  /** Which PSP variant verified successfully */
  kind: "payment" | "market_claim";
  /** Settlement chain ID (always present) */
  settlementChainId: number;
  /** Settlement tx hash on Arc (always present) */
  settlementTxHash: Hash;
  /** Recovered issuer address (always present) */
  issuer: Address;
  /** Network mode (always present) */
  networkMode: NetworkMode;
  // Invoice-only fields (kind === "payment"):
  requestId?: string;
  payer?: Address;
  recipient?: Address;
  token?: string;
  amount?: string;
  // Market-claim-only fields (kind === "market_claim"):
  marketId?: string;
  onchainMarket?: Address;
  question?: string;
  outcome?: "YES" | "NO";
  payoutAmount?: string;
};

export type PspVerifyResult = {
  ok: boolean;
  reason?: string;
  fields?: PspVerifyFields;
};
