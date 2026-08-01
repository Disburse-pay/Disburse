/**
 * @disburse/psp-verify
 *
 * Standalone verifier for Disburse Portable Settlement Proofs (PSP).
 * Zero Disburse infrastructure dependency — verify any PSP offline with
 * just a JSON blob and an issuer address.
 *
 * Usage:
 *   import { verify, verifyJson } from "@disburse/psp-verify";
 *   const result = await verify(pspDocument, {
 *     expectedIssuer: independentlyTrustedIssuer,
 *   });
 *   // result.ok === true only for the supplied trusted issuer
 *
 * CLI:
 *   npx psp-verify proof.json --issuer 0x...
 */

export { buildDomainSeparator, canonicalBytes, computeDigest, deterministicStringify, extractCore } from "./canonical.js";
export {
  buildPspClaimFields,
  buildPspClaimTypedData,
  computePspClaimDigest,
  computePspClaimDomainSeparator,
  PSP_CLAIM_DOMAIN_NAME,
  PSP_CLAIM_DOMAIN_VERSION,
  PSP_CLAIM_TYPE_STRING,
  PSP_CLAIM_TYPEHASH,
  PSP_CLAIM_TYPES,
  type PspClaimDescriptor,
  type PspClaimFields,
} from "./claim.js";
export {
  verify,
  verifyJson,
  verifySelfConsistency,
  verifySelfConsistencyJson,
  type VerifyOptions,
} from "./verify.js";
export {
  attachPspOnchainClaim,
  buildSignedPsp,
  getIssuerAccount,
  signPsp,
  signPspOnchainClaim,
} from "./sign.js";
export { verifyOnline, type VerifyOnlineOptions, type VerifyOnlineResult } from "./online.js";
export type {
  NetworkMode,
  PspCore,
  PspInvoice,
  PspIssuer,
  PspLinkedDocument,
  PspOnchainClaim,
  PspOnchainClaimMode,
  PspSelfConsistencyResult,
  PspSettlement,
  PspSettlementEvent,
  PspSignature,
  PspSignatureAlgorithm,
  PspSource,
  PspV1,
  PspVerifyFields,
  PspVerifyResult,
  PspVersion,
} from "./types.js";
