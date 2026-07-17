import { ARC_CHAIN_ID } from "./arc.js";
import type { Address } from "viem";

/**
 * Disburse ID: a username bound to an Arc wallet address. Handles are public
 * payment destinations; the claim is authorized with an EIP-712 signature so
 * it cannot be replayed on another app, chain, or after expiry (unlike the
 * legacy plaintext personal_sign messages in this repo).
 */

export const HANDLE_REGEX = /^[a-z0-9_]{3,16}$/;

/** Claim signatures are only accepted within this window. */
export const ID_CLAIM_TTL_SECONDS = 10 * 60;

export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_REGEX.test(handle);
}

/**
 * Shared EIP-712 domain for Disburse signatures. Deliberately bound to the
 * app name and Arc chain id so a signature collected here verifies nowhere
 * else. Do not reuse this domain for Circle Gateway burn intents, which
 * define their own domain without a chainId.
 */
export const DISBURSE_TYPED_DOMAIN = {
  name: "Disburse",
  version: "1",
  chainId: ARC_CHAIN_ID
} as const;

export const ID_CLAIM_TYPES = {
  DisburseIdClaim: [
    { name: "handle", type: "string" },
    { name: "wallet", type: "address" },
    { name: "expiresAt", type: "uint256" }
  ]
} as const;

export type IdClaimMessage = {
  handle: string;
  wallet: Address;
  expiresAt: bigint;
};

/**
 * Inbox access signatures act as a short-lived bearer credential for reading
 * and updating the wallet's notification inbox. They authorize nothing else:
 * no funds movement, no claims, no writes to other users.
 */
export const INBOX_ACCESS_TTL_SECONDS = 24 * 60 * 60;

export const INBOX_ACCESS_TYPES = {
  DisburseInboxAccess: [
    { name: "wallet", type: "address" },
    { name: "expiresAt", type: "uint256" }
  ]
} as const;

export type InboxAccessMessage = {
  wallet: Address;
  expiresAt: bigint;
};

export function buildInboxAccessTypedData(message: InboxAccessMessage) {
  return {
    domain: DISBURSE_TYPED_DOMAIN,
    types: INBOX_ACCESS_TYPES,
    primaryType: "DisburseInboxAccess",
    message
  } as const;
}

/**
 * Typed data for claiming a handle. Pass the result to
 * walletClient.signTypedData (client) or verifyTypedData (server).
 */
export function buildIdClaimTypedData(message: IdClaimMessage) {
  return {
    domain: DISBURSE_TYPED_DOMAIN,
    types: ID_CLAIM_TYPES,
    primaryType: "DisburseIdClaim",
    message
  } as const;
}
