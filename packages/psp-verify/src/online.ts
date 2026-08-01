/**
 * PspVerifier v2 online verification.
 *
 * Verification mode is mandatory. Direct-payment verification is reported as
 * trusted-issuer signature verification with settlement explicitly unchecked;
 * it is never presented as a full settlement proof.
 */

import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  type Address,
} from "viem";
import { buildPspClaimFields, validateClaimDescriptor } from "./claim.js";
import { verifySelfConsistency } from "./verify.js";
import type { PspOnchainClaimMode, PspV1 } from "./types.js";

const PSP_FIELDS_COMPONENTS = [
  { name: "documentDigest", type: "bytes32" },
  { name: "networkMode", type: "string" },
  { name: "verificationMode", type: "string" },
  { name: "settlementContract", type: "address" },
  { name: "settlementRegistryVersion", type: "uint64" },
  { name: "settlementId", type: "bytes32" },
  { name: "invoicePayer", type: "address" },
  { name: "invoiceRecipient", type: "address" },
  { name: "invoiceToken", type: "string" },
  { name: "invoiceAmount", type: "string" },
  { name: "requestId", type: "string" },
  { name: "settlementChainId", type: "uint256" },
  { name: "settlementTxHash", type: "bytes32" },
] as const;

const PSP_VERIFIER_ABI = [
  {
    name: "verifyDirectClaim",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "fields",
        type: "tuple",
        components: PSP_FIELDS_COMPONENTS,
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "recoveredSigner", type: "address" },
    ],
  },
  {
    name: "verifySettlementClaim",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "fields",
        type: "tuple",
        components: PSP_FIELDS_COMPONENTS,
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "recoveredSigner", type: "address" },
    ],
  },
  {
    name: "trustedIssuers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export type VerifyOnlineOptions = {
  /** RPC URL for the verifier chain. */
  rpcUrl: string;
  /** Deployed PspVerifier v2 address obtained from trusted configuration. */
  verifierAddress: Address;
  /**
   * Mandatory proof scope. Cross-chain PSPs require `settlement`; direct PSPs
   * require `direct-signature-only`.
   */
  mode: PspOnchainClaimMode;
};

export type VerifyOnlineResult = {
  ok: boolean;
  mode: PspOnchainClaimMode;
  verificationLevel:
    | "trusted_issuer_and_settlement"
    | "trusted_issuer_signature_only"
    | "failed";
  issuerStatus: "trusted" | "untrusted" | "unknown";
  settlementStatus: "confirmed" | "not_checked" | "unconfirmed" | "unknown";
  reason?: string;
  recoveredSigner?: Address;
};

function failure(
  mode: PspOnchainClaimMode,
  reason: string,
  extras: Partial<VerifyOnlineResult> = {}
): VerifyOnlineResult {
  return {
    ok: false,
    mode,
    verificationLevel: "failed",
    issuerStatus: "unknown",
    settlementStatus: mode === "settlement" ? "unknown" : "not_checked",
    reason,
    ...extras,
  };
}

/**
 * Verify a PSP against a PspVerifier v2 registry.
 *
 * The PSP must contain a matching EIP-712 onchainClaim. Legacy PSPs without
 * that claim can still be verified offline against a trusted issuer, but
 * cannot be represented as a full on-chain verification.
 */
export async function verifyOnline(
  psp: PspV1,
  options: VerifyOnlineOptions
): Promise<VerifyOnlineResult> {
  const mode = options.mode;
  if (mode !== "settlement" && mode !== "direct-signature-only") {
    return failure(mode, "An explicit supported verification mode is required");
  }
  if (
    !isAddress(options.verifierAddress) ||
    getAddress(options.verifierAddress) === zeroAddress
  ) {
    return failure(mode, "verifierAddress must be a non-zero EVM address");
  }
  if (typeof options.rpcUrl !== "string" || !options.rpcUrl.trim()) {
    return failure(mode, "rpcUrl is required");
  }

  const consistency = await verifySelfConsistency(psp);
  if (!consistency.selfConsistent) {
    return failure(mode, consistency.reason);
  }

  const claim = psp.onchainClaim;
  if (!claim) {
    return failure(
      mode,
      "PSP has no PspVerifier v2 EIP-712 claim; settlement was not verified"
    );
  }
  if (claim.mode !== mode) {
    return failure(
      mode,
      `Verification mode mismatch: requested ${mode}, claim is ${claim.mode}`
    );
  }
  if (
    getAddress(claim.verifier) !== getAddress(options.verifierAddress)
  ) {
    return failure(
      mode,
      `Verifier mismatch: claim targets ${claim.verifier}, configured verifier is ${options.verifierAddress}`
    );
  }

  try {
    validateClaimDescriptor(psp, {
      verifierAddress: options.verifierAddress,
      chainId: claim.chainId,
      mode,
      settlementRegistryVersion: claim.settlementRegistryVersion,
    });

    const client = createPublicClient({
      transport: http(options.rpcUrl, { timeout: 15_000 }),
    });
    const rpcChainId = await client.getChainId();
    if (rpcChainId !== claim.chainId) {
      return failure(
        mode,
        `RPC chainId ${rpcChainId} does not match claim chainId ${claim.chainId}`
      );
    }

    const fields = buildPspClaimFields(
      psp,
      mode,
      claim.settlementRegistryVersion
    );
    const functionName =
      mode === "settlement"
        ? "verifySettlementClaim"
        : "verifyDirectClaim";
    const [ok, recoveredSigner] = (await client.readContract({
      address: getAddress(options.verifierAddress),
      abi: PSP_VERIFIER_ABI,
      functionName,
      args: [fields, claim.signature],
    })) as [boolean, Address];

    if (ok) {
      return {
        ok: true,
        mode,
        verificationLevel:
          mode === "settlement"
            ? "trusted_issuer_and_settlement"
            : "trusted_issuer_signature_only",
        issuerStatus: "trusted",
        settlementStatus:
          mode === "settlement" ? "confirmed" : "not_checked",
        recoveredSigner,
      };
    }

    const issuerTrusted = (await client.readContract({
      address: getAddress(options.verifierAddress),
      abi: PSP_VERIFIER_ABI,
      functionName: "trustedIssuers",
      args: [recoveredSigner],
    })) as boolean;

    return failure(
      mode,
      issuerTrusted
        ? mode === "settlement"
          ? "Trusted issuer claim was valid, but the registered settlement was not confirmed"
          : "Direct claim mode or signature did not match"
        : `Recovered signer ${recoveredSigner} is not trusted by the verifier registry`,
      {
        recoveredSigner,
        issuerStatus: issuerTrusted ? "trusted" : "untrusted",
        settlementStatus:
          mode === "settlement" && issuerTrusted
            ? "unconfirmed"
            : mode === "direct-signature-only"
              ? "not_checked"
              : "unknown",
      }
    );
  } catch (error) {
    return failure(
      mode,
      `RPC or claim verification error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
