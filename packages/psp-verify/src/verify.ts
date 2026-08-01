/**
 * PSP verification (offline).
 *
 * Trusted verification requires an issuer address obtained independently from
 * the PSP. Checking a signature against the issuer embedded in the same
 * document proves self-consistency only and is exposed under an explicitly
 * named API.
 */

import {
  getAddress,
  isAddress,
  isHash,
  zeroAddress,
  zeroHash,
  type Address,
} from "viem";
import { computeDigest, extractCore } from "./canonical.js";
import { verifyPspSignature } from "./sign.js";
import type {
  PspSelfConsistencyResult,
  PspV1,
  PspVerifyFields,
  PspVerifyResult,
} from "./types.js";

export type VerifyOptions = {
  /** Independently obtained trust root. Never copy this from the PSP itself. */
  expectedIssuer: Address;
};

type StructureResult =
  | { ok: true; document: PspV1 }
  | { ok: false; reason: string };

type ConsistencyCheck =
  | { ok: true; fields: PspVerifyFields }
  | { ok: false; reason: string };

const PSP_TOP_LEVEL_FIELDS = new Set([
  "version",
  "networkMode",
  "issuer",
  "invoice",
  "settlement",
  "source",
  "linkedDocuments",
  "digest",
  "signature",
  "uid",
  "createdAt",
  "onchainClaim"
]);

function validDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function validPositiveChainId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validDecimalInteger(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function validNonZeroAddress(value: unknown): value is Address {
  return (
    typeof value === "string" &&
    isAddress(value) &&
    getAddress(value) !== zeroAddress
  );
}

function validSignature(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value);
}

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || !value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validateStructure(psp: unknown): StructureResult {
  if (typeof psp !== "object" || psp === null || Array.isArray(psp)) {
    return { ok: false, reason: "PSP must be a non-null object" };
  }

  const doc = psp as Record<string, unknown>;
  const unknownField = Object.keys(doc).find((field) => !PSP_TOP_LEVEL_FIELDS.has(field));
  if (unknownField) {
    return { ok: false, reason: `Unsupported PSP field: ${unknownField}` };
  }

  if (doc.version !== 1) {
    return { ok: false, reason: `Unsupported version: ${String(doc.version)}` };
  }
  if (doc.networkMode !== "testnet" && doc.networkMode !== "mainnet") {
    return {
      ok: false,
      reason: `Invalid networkMode: ${String(doc.networkMode)}`,
    };
  }
  if (typeof doc.uid !== "string" || !/^psp:[0-9a-f]{16}$/.test(doc.uid)) {
    return {
      ok: false,
      reason: "Missing or invalid uid (expected psp: plus 16 lowercase hex characters)",
    };
  }
  if (typeof doc.digest !== "string" || !isHash(doc.digest)) {
    return {
      ok: false,
      reason: "Missing or invalid digest (must be a 32-byte hex hash)",
    };
  }

  const signature = doc.signature as Record<string, unknown> | undefined;
  if (
    !signature ||
    signature.alg !== "secp256k1-keccak256" ||
    !validSignature(signature.value)
  ) {
    return {
      ok: false,
      reason: "Missing or invalid signature (must be a 65-byte secp256k1 signature)",
    };
  }
  if (!validDateTime(doc.createdAt)) {
    return { ok: false, reason: "Missing or invalid createdAt timestamp" };
  }

  const issuer = doc.issuer as Record<string, unknown> | undefined;
  if (
    !issuer ||
    typeof issuer.name !== "string" ||
    !issuer.name.trim() ||
    issuer.name.trim() !== issuer.name
  ) {
    return { ok: false, reason: "Issuer name must be a non-empty trimmed string" };
  }
  if (!validHttpUrl(issuer.url)) {
    return { ok: false, reason: "Issuer url must be an absolute HTTP(S) URL" };
  }
  if (!validNonZeroAddress(issuer.publicKey)) {
    return { ok: false, reason: "Issuer publicKey must be a non-zero EVM address" };
  }

  const invoice = doc.invoice as Record<string, unknown> | undefined;
  if (!invoice) {
    return { ok: false, reason: "Missing invoice object" };
  }
  if (typeof invoice.requestId !== "string" || !invoice.requestId) {
    return { ok: false, reason: "Missing invoice.requestId" };
  }
  if (!validNonZeroAddress(invoice.payer)) {
    return { ok: false, reason: "Invalid invoice.payer address" };
  }
  if (!validNonZeroAddress(invoice.recipient)) {
    return { ok: false, reason: "Invalid invoice.recipient address" };
  }
  if (typeof invoice.token !== "string" || !invoice.token.trim()) {
    return { ok: false, reason: "Missing invoice.token" };
  }
  if (typeof invoice.amount !== "string" || !invoice.amount.trim()) {
    return { ok: false, reason: "Missing invoice.amount" };
  }
  if (typeof invoice.label !== "string") {
    return { ok: false, reason: "Missing invoice.label" };
  }

  const settlement = doc.settlement as Record<string, unknown> | undefined;
  if (!settlement) {
    return { ok: false, reason: "Missing settlement object" };
  }
  if (!validPositiveChainId(settlement.chainId)) {
    return { ok: false, reason: "settlement.chainId must be a positive safe integer" };
  }
  if (
    typeof settlement.txHash !== "string" ||
    !isHash(settlement.txHash) ||
    settlement.txHash.toLowerCase() === zeroHash
  ) {
    return { ok: false, reason: "Invalid settlement.txHash" };
  }
  if (!validDecimalInteger(settlement.blockNumber)) {
    return {
      ok: false,
      reason: "settlement.blockNumber must be a non-negative decimal integer string",
    };
  }
  if (!validDateTime(settlement.settledAt)) {
    return { ok: false, reason: "Missing or invalid settlement.settledAt timestamp" };
  }

  const event = settlement.settlementEvent as
    | Record<string, unknown>
    | undefined;
  if (!event) {
    return { ok: false, reason: "Missing settlement.settlementEvent" };
  }
  if (!validNonZeroAddress(event.contract)) {
    return { ok: false, reason: "Invalid settlementEvent.contract" };
  }
  if (
    typeof event.settlementId !== "string" ||
    !isHash(event.settlementId) ||
    event.settlementId.toLowerCase() === zeroHash
  ) {
    return {
      ok: false,
      reason: "settlementEvent.settlementId must be a non-zero 32-byte hash",
    };
  }
  if (typeof event.eventTopic !== "string" || !isHash(event.eventTopic)) {
    return {
      ok: false,
      reason: "settlementEvent.eventTopic must be a 32-byte hash",
    };
  }
  if (
    !Number.isSafeInteger(event.logIndex) ||
    (event.logIndex as number) < 0
  ) {
    return {
      ok: false,
      reason: "settlementEvent.logIndex must be a non-negative safe integer",
    };
  }

  if (doc.source !== undefined) {
    if (
      typeof doc.source !== "object" ||
      doc.source === null ||
      Array.isArray(doc.source)
    ) {
      return { ok: false, reason: "Invalid source object" };
    }
    const source = doc.source as Record<string, unknown>;
    if (!validPositiveChainId(source.chainId)) {
      return { ok: false, reason: "source.chainId must be a positive safe integer" };
    }
    if (typeof source.txHash !== "string" || !isHash(source.txHash)) {
      return { ok: false, reason: "Invalid source.txHash" };
    }
    if (!validDecimalInteger(source.blockNumber)) {
      return { ok: false, reason: "Invalid source.blockNumber" };
    }
    if (!validNonZeroAddress(source.payer)) {
      return { ok: false, reason: "Invalid source.payer" };
    }
    if (!validNonZeroAddress(source.token)) {
      return { ok: false, reason: "Invalid source.token" };
    }
    if (typeof source.amount !== "string" || !source.amount) {
      return { ok: false, reason: "Invalid source.amount" };
    }
    if (
      source.polymerProofDigest !== undefined &&
      (typeof source.polymerProofDigest !== "string" ||
        !isHash(source.polymerProofDigest))
    ) {
      return { ok: false, reason: "Invalid source.polymerProofDigest" };
    }
  }

  if (doc.onchainClaim !== undefined) {
    if (
      typeof doc.onchainClaim !== "object" ||
      doc.onchainClaim === null ||
      Array.isArray(doc.onchainClaim)
    ) {
      return { ok: false, reason: "Invalid onchainClaim object" };
    }
    const claim = doc.onchainClaim as Record<string, unknown>;
    if (claim.version !== 1 || claim.scheme !== "eip712") {
      return { ok: false, reason: "Unsupported onchainClaim version or scheme" };
    }
    if (
      claim.mode !== "settlement" &&
      claim.mode !== "direct-signature-only"
    ) {
      return { ok: false, reason: "Invalid onchainClaim.mode" };
    }
    if (!validNonZeroAddress(claim.verifier)) {
      return { ok: false, reason: "Invalid onchainClaim.verifier" };
    }
    if (!validPositiveChainId(claim.chainId)) {
      return { ok: false, reason: "Invalid onchainClaim.chainId" };
    }
    if (
      !Number.isSafeInteger(claim.settlementRegistryVersion) ||
      (claim.settlementRegistryVersion as number) < 0
    ) {
      return {
        ok: false,
        reason: "Invalid onchainClaim.settlementRegistryVersion",
      };
    }
    if (
      (claim.mode === "settlement" &&
        (claim.settlementRegistryVersion as number) <= 0) ||
      (claim.mode === "direct-signature-only" &&
        claim.settlementRegistryVersion !== 0)
    ) {
      return {
        ok: false,
        reason: "onchainClaim mode and settlement registry version are inconsistent",
      };
    }
    if (!validSignature(claim.signature)) {
      return { ok: false, reason: "Invalid onchainClaim.signature" };
    }
  }

  return { ok: true, document: psp as PspV1 };
}

function extractVerifiedFields(doc: PspV1): PspVerifyFields {
  return {
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
  };
}

async function checkSelfConsistency(psp: unknown): Promise<ConsistencyCheck> {
  const structure = validateStructure(psp);
  if (!structure.ok) {
    return structure;
  }

  const doc = structure.document;
  try {
    const expectedDigest = computeDigest(extractCore(doc));
    if (expectedDigest.toLowerCase() !== doc.digest.toLowerCase()) {
      return {
        ok: false,
        reason: `Digest mismatch: computed ${expectedDigest}, document claims ${doc.digest}`,
      };
    }

    const expectedUid = `psp:${expectedDigest.slice(2, 18)}`;
    if (doc.uid !== expectedUid) {
      return {
        ok: false,
        reason: `UID mismatch: expected ${expectedUid}, document claims ${doc.uid}`,
      };
    }

    const signature = await verifyPspSignature(doc);
    if (!signature.ok) {
      return {
        ok: false,
        reason: signature.reason ?? "Signature verification failed",
      };
    }

    return { ok: true, fields: extractVerifiedFields(doc) };
  } catch (error) {
    return {
      ok: false,
      reason: `Verification error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Verify structure, digest, UID, and signature against an independently
 * supplied trusted issuer. This makes no network calls and does not assert
 * settlement existence.
 */
export async function verify(
  psp: unknown,
  options: VerifyOptions
): Promise<PspVerifyResult> {
  if (
    !options ||
    !validNonZeroAddress(options.expectedIssuer)
  ) {
    return {
      ok: false,
      trust: "not_established",
      settlementStatus: "not_checked",
      reason:
        "A non-zero expectedIssuer obtained independently from the PSP is required",
    };
  }

  const consistency = await checkSelfConsistency(psp);
  if (!consistency.ok) {
    return {
      ok: false,
      trust: "not_established",
      settlementStatus: "not_checked",
      reason: consistency.reason,
    };
  }

  if (
    consistency.fields.issuer.toLowerCase() !==
    getAddress(options.expectedIssuer).toLowerCase()
  ) {
    return {
      ok: false,
      trust: "not_established",
      settlementStatus: "not_checked",
      reason: `Issuer mismatch: expected ${getAddress(
        options.expectedIssuer
      )}, got ${consistency.fields.issuer}`,
    };
  }

  return {
    ok: true,
    trust: "trusted_issuer",
    settlementStatus: "not_checked",
    fields: consistency.fields,
  };
}

/**
 * Explicitly check only whether the PSP is internally self-consistent.
 *
 * This is not trusted verification: an attacker can create a PSP and put
 * their own issuer key in it.
 */
export async function verifySelfConsistency(
  psp: unknown
): Promise<PspSelfConsistencyResult> {
  const result = await checkSelfConsistency(psp);
  if (!result.ok) {
    return {
      selfConsistent: false,
      trust: "untrusted_self_consistency_only",
      reason: result.reason,
    };
  }
  return {
    selfConsistent: true,
    trust: "untrusted_self_consistency_only",
    fields: result.fields,
  };
}

export async function verifyJson(
  json: string,
  options: VerifyOptions
): Promise<PspVerifyResult> {
  try {
    return verify(JSON.parse(json), options);
  } catch (error) {
    return {
      ok: false,
      trust: "not_established",
      settlementStatus: "not_checked",
      reason: `JSON parse error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export async function verifySelfConsistencyJson(
  json: string
): Promise<PspSelfConsistencyResult> {
  try {
    return verifySelfConsistency(JSON.parse(json));
  } catch (error) {
    return {
      selfConsistent: false,
      trust: "untrusted_self_consistency_only",
      reason: `JSON parse error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
