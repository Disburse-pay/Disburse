/**
 * @disburse/psp-verify
 *
 * Standalone verifier for Disburse Portable Settlement Proofs (PSP).
 * Zero Disburse infrastructure dependency — verify any PSP offline with
 * just a JSON blob and an issuer address.
 *
 * Usage:
 *   import { verify, verifyJson } from "@disburse/psp-verify";
 *   const result = await verify(pspDocument);
 *   // result.ok === true if valid
 *
 * CLI:
 *   npx psp-verify proof.json --issuer 0x...
 */

export { buildDomainSeparator, canonicalBytes, computeDigest, deterministicStringify, extractCore } from "./canonical.js";
export { verify, verifyJson } from "./verify.js";
export { verifyPspSignature } from "./sign.js";
export { verifyOnline, type VerifyOnlineOptions, type VerifyOnlineResult } from "./online.js";
export type {
  NetworkMode,
  PspCore,
  PspInvoice,
  PspIssuer,
  PspLinkedDocument,
  PspSettlement,
  PspSettlementEvent,
  PspSignature,
  PspSignatureAlgorithm,
  PspSource,
  PspV1,
  PspVerifyResult,
  PspVersion,
} from "./types.js";
