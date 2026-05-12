/**
 * PSP Online Verification
 *
 * Calls the on-chain PspVerifier contract to confirm:
 * 1. Signature was produced by the registered issuer
 * 2. Referenced settlement exists on Arc
 *
 * Requires network access (RPC call). For offline-only verification,
 * use verify() or verifyJson() instead.
 */

import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { computeDigest, extractCore } from "./canonical.js";
import type { PspV1 } from "./types.js";

// ─── ABI (minimal, only what we need) ────────────────────────────────────────

const PSP_VERIFIER_ABI = [
  {
    name: "verify",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "digest", type: "bytes32" },
      { name: "signature", type: "bytes" },
      {
        name: "fields",
        type: "tuple",
        components: [
          { name: "networkMode", type: "string" },
          { name: "settlementId", type: "bytes32" },
          { name: "invoicePayer", type: "address" },
          { name: "invoiceRecipient", type: "address" },
          { name: "invoiceToken", type: "string" },
          { name: "invoiceAmount", type: "string" },
          { name: "requestId", type: "string" },
          { name: "settlementChainId", type: "uint256" },
          { name: "settlementTxHash", type: "bytes32" },
        ],
      },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "recoveredSigner", type: "address" },
    ],
  },
  {
    name: "verifySignatureOnly",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "digest", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "recoveredSigner", type: "address" },
    ],
  },
  {
    name: "issuer",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type VerifyOnlineOptions = {
  /** RPC URL for Arc Testnet */
  rpcUrl: string;
  /** Deployed PspVerifier contract address */
  verifierAddress: Address;
  /** If true, only verify signature (skip settlement check). Default: false */
  signatureOnly?: boolean;
};

export type VerifyOnlineResult = {
  ok: boolean;
  reason?: string;
  recoveredSigner?: Address;
  registeredIssuer?: Address;
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Verify a PSP on-chain using the PspVerifier contract.
 *
 * This calls the Arc Testnet RPC to:
 * 1. Check the signature matches the registered issuer
 * 2. Confirm the referenced settlement exists (unless signatureOnly=true)
 */
export async function verifyOnline(
  psp: PspV1,
  options: VerifyOnlineOptions
): Promise<VerifyOnlineResult> {
  const { rpcUrl, verifierAddress, signatureOnly = false } = options;

  try {
    const client = createPublicClient({
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    // Get the registered issuer for reference
    const registeredIssuer = await client.readContract({
      address: verifierAddress,
      abi: PSP_VERIFIER_ABI,
      functionName: "issuer",
    }) as Address;

    // Compute digest from the PSP core
    const core = extractCore(psp);
    const digest = computeDigest(core);

    if (digest.toLowerCase() !== psp.digest.toLowerCase()) {
      return {
        ok: false,
        reason: `Digest mismatch: computed ${digest}, document claims ${psp.digest}`,
        registeredIssuer,
      };
    }

    if (signatureOnly) {
      const [ok, recoveredSigner] = await client.readContract({
        address: verifierAddress,
        abi: PSP_VERIFIER_ABI,
        functionName: "verifySignatureOnly",
        args: [digest as Hex, psp.signature.value],
      }) as [boolean, Address];

      return {
        ok,
        recoveredSigner,
        registeredIssuer,
        reason: ok ? undefined : `Signer ${recoveredSigner} does not match registered issuer ${registeredIssuer}`,
      };
    }

    // Full verification with settlement check
    const settlementId = psp.settlement.settlementEvent.settlementId as Hex;
    const fields = {
      networkMode: psp.networkMode,
      settlementId,
      invoicePayer: psp.invoice.payer,
      invoiceRecipient: psp.invoice.recipient,
      invoiceToken: psp.invoice.token,
      invoiceAmount: psp.invoice.amount,
      requestId: psp.invoice.requestId,
      settlementChainId: BigInt(psp.settlement.chainId),
      settlementTxHash: psp.settlement.txHash as Hex,
    };

    const [ok, recoveredSigner] = await client.readContract({
      address: verifierAddress,
      abi: PSP_VERIFIER_ABI,
      functionName: "verify",
      args: [digest as Hex, psp.signature.value, fields],
    }) as [boolean, Address];

    return {
      ok,
      recoveredSigner,
      registeredIssuer,
      reason: ok ? undefined : `On-chain verification failed. Signer: ${recoveredSigner}, Issuer: ${registeredIssuer}`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `RPC error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
