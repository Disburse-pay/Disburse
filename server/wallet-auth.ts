import {
  verifyTypedData as verifyEoaTypedData,
  type Hex,
  type TypedData,
  type VerifyTypedDataParameters
} from "viem";
import { publicClient } from "../src/lib/arc.js";
import { HttpError } from "./http.js";

export const MIN_WALLET_SIGNATURE_BYTES = 64;
export const MAX_WALLET_SIGNATURE_BYTES = 2_048;

/**
 * Parse a bounded opaque wallet signature. Smart-account signatures are not
 * necessarily 65 bytes, but accepting arbitrary strings would create an easy
 * memory/RPC-amplification input.
 */
export function readWalletSignature(
  value: unknown,
  statusCode = 401,
  message = "A valid wallet authorization signature is required."
): Hex {
  const signature = typeof value === "string" ? value.trim() : "";
  const byteLength = /^0x(?:[0-9a-fA-F]{2})+$/.test(signature) ? (signature.length - 2) / 2 : 0;
  if (byteLength < MIN_WALLET_SIGNATURE_BYTES || byteLength > MAX_WALLET_SIGNATURE_BYTES) {
    throw new HttpError(statusCode, message);
  }
  return signature as Hex;
}

/**
 * Verify EOAs locally first, then fall back to the Arc public action for
 * ERC-1271/6492/8010 smart-account signatures.
 */
export async function verifyWalletTypedData<
  const typedData extends TypedData | Record<string, unknown>,
  primaryType extends keyof typedData | "EIP712Domain"
>(parameters: VerifyTypedDataParameters<typedData, primaryType>): Promise<boolean> {
  const eoaVerified = await verifyEoaTypedData(parameters).catch(() => false);
  if (eoaVerified) {
    return true;
  }
  return publicClient
    .verifyTypedData(parameters as unknown as Parameters<typeof publicClient.verifyTypedData>[0])
    .catch(() => false);
}
