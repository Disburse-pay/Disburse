/**
 * PSP — Portable Settlement Proof
 *
 * Public API surface for the PSP library.
 */

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
} from "./types";

export {
  buildDomainSeparator,
  canonicalBytes,
  computeDigest,
  deterministicStringify,
  extractCore,
} from "./canonical";

export {
  buildSignedPsp,
  getIssuerAccount,
  signPsp,
  verifyPspSignature,
} from "./sign";

export { verify, verifyJson } from "./verify";
