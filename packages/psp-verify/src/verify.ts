/**
 * PSP Verification (offline)
 *
 * Verifies the structural integrity and cryptographic validity of a PSP
 * document without any network calls. This module is designed to be
 * re-exported by the standalone `packages/psp-verify` npm package.
 *
 * Checks performed:
 * 1. Structural: version, required fields, field formats
 * 2. Digest: recompute canonical bytes → keccak256 matches claimed digest
 * 3. Signature: ecrecover matches claimed issuer publicKey
 */

import { isAddress, isHash, type Address } from "viem";
import { verifyPspSignature } from "./sign.js";
import { computeDigest, extractCore } from "./canonical.js";
import type { PspV1, PspVerifyResult } from "./types.js";

// ---------- Structural validation ----------

function validateStructure(psp: unknown): { ok: boolean; reason?: string } {
  if (typeof psp !== "object" || psp === null) {
    return { ok: false, reason: "PSP must be a non-null object" };
  }

  const doc = psp as Record<string, unknown>;

  // Version
  if (doc.version !== 1) {
    return { ok: false, reason: `Unsupported version: ${doc.version}` };
  }

  // Network mode
  if (doc.networkMode !== "testnet" && doc.networkMode !== "mainnet") {
    return { ok: false, reason: `Invalid networkMode: ${doc.networkMode}` };
  }

  // UID
  if (typeof doc.uid !== "string" || !doc.uid.startsWith("psp:")) {
    return { ok: false, reason: "Missing or invalid uid (must start with 'psp:')" };
  }

  // Digest
  if (typeof doc.digest !== "string" || !isHash(doc.digest)) {
    return { ok: false, reason: "Missing or invalid digest (must be a 32-byte hex hash)" };
  }

  // Signature
  const sig = doc.signature as Record<string, unknown> | undefined;
  if (!sig || sig.alg !== "secp256k1-keccak256" || typeof sig.value !== "string") {
    return { ok: false, reason: "Missing or invalid signature object" };
  }

  // CreatedAt
  if (typeof doc.createdAt !== "string" || isNaN(Date.parse(doc.createdAt))) {
    return { ok: false, reason: "Missing or invalid createdAt timestamp" };
  }

  // Issuer
  const issuer = doc.issuer as Record<string, unknown> | undefined;
  if (!issuer || typeof issuer.name !== "string" || typeof issuer.url !== "string") {
    return { ok: false, reason: "Missing or invalid issuer (name, url required)" };
  }
  if (typeof issuer.publicKey !== "string" || !isAddress(issuer.publicKey)) {
    return { ok: false, reason: "Issuer publicKey must be a valid EVM address" };
  }

  // Exactly one of invoice / marketClaim must be present (v1.1 contract).
  const invoice = doc.invoice as Record<string, unknown> | undefined;
  const marketClaim = doc.marketClaim as Record<string, unknown> | undefined;
  if (!invoice && !marketClaim) {
    return { ok: false, reason: "Missing invoice or marketClaim object" };
  }
  if (invoice && marketClaim) {
    return {
      ok: false,
      reason: "PSP must have exactly one of invoice or marketClaim, not both",
    };
  }

  if (invoice) {
    if (typeof invoice.requestId !== "string" || !invoice.requestId) {
      return { ok: false, reason: "Missing invoice.requestId" };
    }
    if (typeof invoice.payer !== "string" || !isAddress(invoice.payer)) {
      return { ok: false, reason: "Invalid invoice.payer address" };
    }
    if (typeof invoice.recipient !== "string" || !isAddress(invoice.recipient)) {
      return { ok: false, reason: "Invalid invoice.recipient address" };
    }
    if (typeof invoice.token !== "string" || !invoice.token) {
      return { ok: false, reason: "Missing invoice.token" };
    }
    if (typeof invoice.amount !== "string" || !invoice.amount) {
      return { ok: false, reason: "Missing invoice.amount" };
    }
    if (typeof invoice.label !== "string") {
      return { ok: false, reason: "Missing invoice.label" };
    }
  }

  if (marketClaim) {
    if (typeof marketClaim.marketId !== "string" || !marketClaim.marketId) {
      return { ok: false, reason: "Missing marketClaim.marketId" };
    }
    if (
      typeof marketClaim.onchainMarket !== "string" ||
      !isAddress(marketClaim.onchainMarket)
    ) {
      return { ok: false, reason: "Invalid marketClaim.onchainMarket address" };
    }
    if (typeof marketClaim.question !== "string" || !marketClaim.question) {
      return { ok: false, reason: "Missing marketClaim.question" };
    }
    if (marketClaim.outcome !== "YES" && marketClaim.outcome !== "NO") {
      return { ok: false, reason: "Invalid marketClaim.outcome (must be 'YES' or 'NO')" };
    }
    if (
      marketClaim.winningOutcome !== "YES" &&
      marketClaim.winningOutcome !== "NO"
    ) {
      return { ok: false, reason: "Invalid marketClaim.winningOutcome" };
    }
    if (
      typeof marketClaim.sharesRedeemed !== "string" ||
      !marketClaim.sharesRedeemed
    ) {
      return { ok: false, reason: "Missing marketClaim.sharesRedeemed" };
    }
    if (
      typeof marketClaim.payoutAmount !== "string" ||
      !marketClaim.payoutAmount
    ) {
      return { ok: false, reason: "Missing marketClaim.payoutAmount" };
    }
    if (
      typeof marketClaim.resolvedAt !== "string" ||
      isNaN(Date.parse(marketClaim.resolvedAt))
    ) {
      return { ok: false, reason: "Invalid marketClaim.resolvedAt timestamp" };
    }
  }

  // Settlement
  const settlement = doc.settlement as Record<string, unknown> | undefined;
  if (!settlement) {
    return { ok: false, reason: "Missing settlement object" };
  }
  if (typeof settlement.chainId !== "number") {
    return { ok: false, reason: "Missing settlement.chainId" };
  }
  if (typeof settlement.txHash !== "string" || !isHash(settlement.txHash)) {
    return { ok: false, reason: "Invalid settlement.txHash" };
  }
  if (typeof settlement.blockNumber !== "string") {
    return { ok: false, reason: "Missing settlement.blockNumber" };
  }
  if (typeof settlement.settledAt !== "string") {
    return { ok: false, reason: "Missing settlement.settledAt" };
  }

  const event = settlement.settlementEvent as Record<string, unknown> | undefined;
  if (!event) {
    return { ok: false, reason: "Missing settlement.settlementEvent" };
  }
  if (typeof event.contract !== "string" || !isAddress(event.contract)) {
    return { ok: false, reason: "Invalid settlementEvent.contract" };
  }
  if (typeof event.settlementId !== "string") {
    return { ok: false, reason: "Missing settlementEvent.settlementId" };
  }
  if (typeof event.eventTopic !== "string") {
    return { ok: false, reason: "Missing settlementEvent.eventTopic" };
  }
  if (typeof event.logIndex !== "number") {
    return { ok: false, reason: "Missing settlementEvent.logIndex" };
  }

  return { ok: true };
}

// ---------- Public API ----------

/**
 * Verify a PSP document offline.
 *
 * Performs structural validation, digest verification, and signature verification.
 * No network calls are made.
 *
 * Optionally pass `expectedIssuer` to additionally check that the issuer
 * address matches a known trusted issuer.
 */
export async function verify(
  psp: unknown,
  options?: { expectedIssuer?: Address }
): Promise<PspVerifyResult> {
  // Step 1: structural validation
  const structResult = validateStructure(psp);
  if (!structResult.ok) {
    return { ok: false, reason: structResult.reason };
  }

  const doc = psp as PspV1;

  // Step 2: check expected issuer if provided
  if (
    options?.expectedIssuer &&
    doc.issuer.publicKey.toLowerCase() !== options.expectedIssuer.toLowerCase()
  ) {
    return {
      ok: false,
      reason: `Issuer mismatch: expected ${options.expectedIssuer}, got ${doc.issuer.publicKey}`,
    };
  }

  // Step 3: digest verification
  const core = extractCore(doc);
  const expectedDigest = computeDigest(core);
  if (expectedDigest.toLowerCase() !== doc.digest.toLowerCase()) {
    return {
      ok: false,
      reason: `Digest mismatch: computed ${expectedDigest}, document claims ${doc.digest}`,
    };
  }

  // Step 4: UID check (derived from digest)
  const expectedUid = `psp:${expectedDigest.slice(2, 18)}`;
  if (doc.uid !== expectedUid) {
    return {
      ok: false,
      reason: `UID mismatch: expected ${expectedUid}, document claims ${doc.uid}`,
    };
  }

  // Step 5: signature verification
  const sigResult = await verifyPspSignature(doc);
  if (!sigResult.ok) {
    return { ok: false, reason: sigResult.reason };
  }

  // All checks passed. validateStructure guaranteed exactly one variant.
  if (doc.invoice) {
    return {
      ok: true,
      fields: {
        kind: "payment",
        requestId: doc.invoice.requestId,
        payer: doc.invoice.payer,
        recipient: doc.invoice.recipient,
        token: doc.invoice.token,
        amount: doc.invoice.amount,
        settlementChainId: doc.settlement.chainId,
        settlementTxHash: doc.settlement.txHash,
        issuer: doc.issuer.publicKey,
        networkMode: doc.networkMode,
      },
    };
  }

  const mc = doc.marketClaim!;
  return {
    ok: true,
    fields: {
      kind: "market_claim",
      marketId: mc.marketId,
      onchainMarket: mc.onchainMarket,
      question: mc.question,
      outcome: mc.outcome,
      payoutAmount: mc.payoutAmount,
      settlementChainId: doc.settlement.chainId,
      settlementTxHash: doc.settlement.txHash,
      issuer: doc.issuer.publicKey,
      networkMode: doc.networkMode,
    },
  };
}

/**
 * Parse a PSP from a JSON string and verify it.
 */
export async function verifyJson(
  json: string,
  options?: { expectedIssuer?: Address }
): Promise<PspVerifyResult> {
  try {
    const parsed = JSON.parse(json);
    return verify(parsed, options);
  } catch (error) {
    return {
      ok: false,
      reason: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
