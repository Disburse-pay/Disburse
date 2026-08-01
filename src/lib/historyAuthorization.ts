import type { Address } from "viem";
import { DISBURSE_TYPED_DOMAIN } from "./ids.js";

export const HISTORY_AUTH_TTL_SECONDS = 5 * 60;
export const DEFAULT_HISTORY_LIMIT = 200;
export const MAX_HISTORY_LIMIT = 500;

export const HISTORY_ACCESS_TYPES = {
  DisburseHistoryAccess: [
    { name: "wallet", type: "address" },
    { name: "limit", type: "uint256" },
    { name: "expiresAt", type: "uint256" }
  ]
} as const;

export function buildHistoryAccessTypedData(input: {
  wallet: Address;
  limit: number;
  expiresAt: bigint;
}) {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_HISTORY_LIMIT) {
    throw new Error(`History limit must be an integer from 1 to ${MAX_HISTORY_LIMIT}.`);
  }
  return {
    domain: DISBURSE_TYPED_DOMAIN,
    types: HISTORY_ACCESS_TYPES,
    primaryType: "DisburseHistoryAccess",
    message: {
      wallet: input.wallet,
      limit: BigInt(input.limit),
      expiresAt: input.expiresAt
    }
  } as const;
}
