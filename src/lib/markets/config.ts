/**
 * Browser-side configuration for the markets module.
 *
 * The on-chain Exchange address is part of the EIP-712 domain that every
 * order signature commits to — the client MUST sign against the same address
 * the server verifies against. Vite exposes only `VITE_*`-prefixed env vars
 * to the browser, so a parallel `VITE_MARKETS_EXCHANGE` mirrors the server's
 * `MARKETS_EXCHANGE`.
 *
 * Failing loud here (per Rule 12) is the right move: a misconfigured
 * Exchange address would silently produce signatures that recover to a
 * different EIP-712 domain and get rejected at submit time.
 */

import type { Address } from "viem";
import { ARC_CHAIN_ID } from "../arc";

let cached: { exchangeAddress: Address; outcomeToken?: Address } | undefined;

export function getMarketsConfig(): { exchangeAddress: Address; outcomeToken?: Address; chainId: number } {
  if (!cached) {
    const raw = import.meta.env.VITE_MARKETS_EXCHANGE?.trim();
    if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
      throw new Error(
        "VITE_MARKETS_EXCHANGE is not configured. Add it to .env.local — must match the deployed Exchange address."
      );
    }
    const outcomeRaw = import.meta.env.VITE_MARKETS_OUTCOME_TOKEN?.trim();
    const outcomeToken =
      outcomeRaw && /^0x[0-9a-fA-F]{40}$/.test(outcomeRaw) ? (outcomeRaw as Address) : undefined;
    cached = { exchangeAddress: raw as Address, outcomeToken };
  }
  return { ...cached, chainId: ARC_CHAIN_ID };
}
