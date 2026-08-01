/**
 * PspVerifier v2 EIP-712 claim construction.
 *
 * The Solidity verifier cannot reconstruct canonical PSP JSON. Instead, the
 * issuer signs both the canonical document digest and every field consumed by
 * the contract. The EIP-712 domain prevents replay across chains or verifier
 * deployments.
 */

import {
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  isAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import type { PspOnchainClaimMode, PspV1 } from "./types";

export const PSP_CLAIM_DOMAIN_NAME = "Disburse PSP Verifier";
export const PSP_CLAIM_DOMAIN_VERSION = "2";
export const PSP_CLAIM_TYPE_STRING =
  "PspFields(bytes32 documentDigest,string networkMode,string verificationMode,address settlementContract,uint64 settlementRegistryVersion,bytes32 settlementId,address invoicePayer,address invoiceRecipient,string invoiceToken,string invoiceAmount,string requestId,uint256 settlementChainId,bytes32 settlementTxHash)";
export const PSP_CLAIM_TYPEHASH = keccak256(
  stringToHex(PSP_CLAIM_TYPE_STRING)
);

export const PSP_CLAIM_TYPES = {
  PspFields: [
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
  ],
} as const;

export type PspClaimFields = {
  documentDigest: Hash;
  networkMode: string;
  verificationMode: PspOnchainClaimMode;
  settlementContract: Address;
  settlementRegistryVersion: bigint;
  settlementId: Hash;
  invoicePayer: Address;
  invoiceRecipient: Address;
  invoiceToken: string;
  invoiceAmount: string;
  requestId: string;
  settlementChainId: bigint;
  settlementTxHash: Hash;
};

export type PspClaimDescriptor = {
  verifierAddress: Address;
  chainId: number;
  mode: PspOnchainClaimMode;
  settlementRegistryVersion?: number;
};

export function validateClaimDescriptor(
  psp: PspV1,
  descriptor: PspClaimDescriptor
): { verifierAddress: Address; settlementRegistryVersion: number } {
  if (
    !isAddress(descriptor.verifierAddress) ||
    getAddress(descriptor.verifierAddress) === zeroAddress
  ) {
    throw new Error("Verifier address must be a non-zero EVM address");
  }
  if (!Number.isSafeInteger(descriptor.chainId) || descriptor.chainId <= 0) {
    throw new Error("Verifier chainId must be a positive safe integer");
  }
  if (descriptor.chainId !== psp.settlement.chainId) {
    throw new Error(
      `Verifier chainId ${descriptor.chainId} does not match settlement chainId ${psp.settlement.chainId}`
    );
  }
  if (!psp.invoice) {
    throw new Error("PspVerifier v2 claims currently support payment PSPs only");
  }

  const registryVersion = descriptor.settlementRegistryVersion ?? 0;
  if (descriptor.mode === "settlement") {
    if (!psp.source) {
      throw new Error(
        "Settlement mode requires a cross-chain PSP; use direct-signature-only for a direct payment"
      );
    }
    if (!Number.isSafeInteger(registryVersion) || registryVersion <= 0) {
      throw new Error("Settlement mode requires a positive settlement registry version");
    }
  } else if (descriptor.mode === "direct-signature-only") {
    if (psp.source) {
      throw new Error(
        "Cross-chain PSPs cannot be downgraded to direct-signature-only verification"
      );
    }
    if (registryVersion !== 0) {
      throw new Error("Direct-signature-only claims must use registry version zero");
    }
  } else {
    throw new Error(`Unsupported PSP claim mode: ${String(descriptor.mode)}`);
  }

  return {
    verifierAddress: getAddress(descriptor.verifierAddress),
    settlementRegistryVersion: registryVersion,
  };
}

export function buildPspClaimFields(
  psp: PspV1,
  mode: PspOnchainClaimMode,
  settlementRegistryVersion: number
): PspClaimFields {
  if (!psp.invoice) {
    throw new Error("PspVerifier v2 claims currently support payment PSPs only");
  }

  return {
    documentDigest: psp.digest as Hash,
    networkMode: psp.networkMode,
    verificationMode: mode,
    settlementContract: getAddress(psp.settlement.settlementEvent.contract),
    settlementRegistryVersion: BigInt(settlementRegistryVersion),
    settlementId: psp.settlement.settlementEvent.settlementId as Hash,
    invoicePayer: getAddress(psp.invoice.payer),
    invoiceRecipient: getAddress(psp.invoice.recipient),
    invoiceToken: psp.invoice.token,
    invoiceAmount: psp.invoice.amount,
    requestId: psp.invoice.requestId,
    settlementChainId: BigInt(psp.settlement.chainId),
    settlementTxHash: psp.settlement.txHash,
  };
}

export function buildPspClaimTypedData(
  psp: PspV1,
  descriptor: PspClaimDescriptor
) {
  const validated = validateClaimDescriptor(psp, descriptor);
  return {
    domain: {
      name: PSP_CLAIM_DOMAIN_NAME,
      version: PSP_CLAIM_DOMAIN_VERSION,
      chainId: descriptor.chainId,
      verifyingContract: validated.verifierAddress,
    },
    types: PSP_CLAIM_TYPES,
    primaryType: "PspFields" as const,
    message: buildPspClaimFields(
      psp,
      descriptor.mode,
      validated.settlementRegistryVersion
    ),
  };
}

export function computePspClaimDigest(
  psp: PspV1,
  descriptor: PspClaimDescriptor
): Hash {
  return hashTypedData(buildPspClaimTypedData(psp, descriptor));
}

/**
 * Independently compute the EIP-712 domain separator exposed by PspVerifier
 * v2. Issuance uses this to reject the old verifier or a misconfigured chain.
 */
export function computePspClaimDomainSeparator(
  chainId: number,
  verifierAddress: Address
): Hash {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Verifier chainId must be a positive safe integer");
  }
  if (
    !isAddress(verifierAddress) ||
    getAddress(verifierAddress) === zeroAddress
  ) {
    throw new Error("Verifier address must be a non-zero EVM address");
  }
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
      [
        keccak256(
          stringToHex(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
          )
        ),
        keccak256(stringToHex(PSP_CLAIM_DOMAIN_NAME)),
        keccak256(stringToHex(PSP_CLAIM_DOMAIN_VERSION)),
        BigInt(chainId),
        getAddress(verifierAddress),
      ]
    )
  );
}
