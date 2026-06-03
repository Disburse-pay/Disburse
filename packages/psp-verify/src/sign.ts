/**
 * PSP Signing
 *
 * Signs and verifies PSP documents using secp256k1 + keccak256.
 * The signature is produced over the canonical bytes so it can be verified:
 * - Off-chain with this library
 * - On-chain with ecrecover in PspVerifier.sol
 *
 * Uses viem's signing primitives which produce EIP-191-style personal_sign
 * signatures. For PSP we use raw keccak256 signing (no prefix) so the
 * Solidity verifier can ecrecover without EIP-191 overhead.
 */

import {
  hashMessage,
  recoverAddress,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { computeDigest, extractCore } from "./canonical";
import type { PspCore, PspSignature, PspV1 } from "./types";

// ---------- Key management ----------

/**
 * Derive the issuer account from a private key hex string.
 */
export function getIssuerAccount(privateKey: Hex): PrivateKeyAccount {
  return privateKeyToAccount(privateKey);
}

// ---------- Signing ----------

export type SignResult = {
  digest: Hex;
  signature: PspSignature;
  issuerAddress: Address;
};

/**
 * Sign a PspCore document, producing the digest and signature.
 *
 * Uses EIP-191 personal_sign (hashMessage) so that:
 * - viem's signMessage / recoverMessageAddress work natively
 * - Solidity can verify with the standard "\x19Ethereum Signed Message:\n32" prefix
 */
export async function signPsp(
  core: PspCore,
  privateKey: Hex
): Promise<SignResult> {
  const account = getIssuerAccount(privateKey);
  const digest = computeDigest(core);

  // Sign the digest using EIP-191 personal_sign
  const signature = await account.signMessage({
    message: { raw: toBytes(digest) },
  });

  return {
    digest,
    signature: {
      alg: "secp256k1-keccak256",
      value: signature,
    },
    issuerAddress: account.address,
  };
}

/**
 * Build a complete PspV1 document from a PspCore by signing it.
 */
export async function buildSignedPsp(
  core: PspCore,
  privateKey: Hex
): Promise<PspV1> {
  const { digest, signature, issuerAddress } = await signPsp(core, privateKey);

  // Ensure the issuer publicKey matches the signing key
  if (core.issuer.publicKey.toLowerCase() !== issuerAddress.toLowerCase()) {
    throw new Error(
      `Issuer publicKey ${core.issuer.publicKey} does not match signing key address ${issuerAddress}`
    );
  }

  const uid = `psp:${digest.slice(2, 18)}`; // first 16 hex chars after 0x

  return {
    ...core,
    digest,
    signature,
    uid,
    createdAt: new Date().toISOString(),
  };
}

// ---------- Verification ----------

/**
 * Verify that a PSP signature was produced by the claimed issuer.
 * Returns true if the recovered signer matches psp.issuer.publicKey.
 */
export async function verifyPspSignature(
  psp: PspV1
): Promise<{ ok: boolean; recoveredAddress?: Address; reason?: string }> {
  try {
    const core = extractCore(psp);
    const expectedDigest = computeDigest(core);

    // Check digest matches
    if (expectedDigest.toLowerCase() !== psp.digest.toLowerCase()) {
      return {
        ok: false,
        reason: `Digest mismatch: computed ${expectedDigest}, document claims ${psp.digest}`,
      };
    }

    // Recover the signer from the EIP-191 signed digest
    const recoveredAddress = await recoverAddress({
      hash: hashMessage({ raw: toBytes(expectedDigest) }),
      signature: psp.signature.value,
    });

    if (
      recoveredAddress.toLowerCase() !== psp.issuer.publicKey.toLowerCase()
    ) {
      return {
        ok: false,
        recoveredAddress,
        reason: `Signature recovers to ${recoveredAddress}, but issuer claims ${psp.issuer.publicKey}`,
      };
    }

    return { ok: true, recoveredAddress };
  } catch (error) {
    return {
      ok: false,
      reason: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
