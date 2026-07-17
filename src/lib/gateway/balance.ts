import { parseUnits, type Address } from "viem";
import { TOKENS } from "../arc.js";
import { ARC_GATEWAY_DOMAIN, GATEWAY_API_URL } from "./types.js";

/**
 * Unified Gateway USDC balance for a depositor.
 *
 * `available` is USDC base units (6 decimals); `formatted` is Circle's own
 * decimal string. /v1/balances returns a DECIMAL string ("1.000000"), not
 * base units — BigInt() on it throws, so parseUnits is load-bearing here.
 */
export type GatewayBalance = {
  available: bigint;
  formatted: string;
};

type BalancesResponse = {
  balances?: Array<{ domain?: number; depositor?: string; balance?: string }>;
};

export async function fetchGatewayBalance(
  depositor: Address,
  domains: number[] = [ARC_GATEWAY_DOMAIN]
): Promise<GatewayBalance> {
  const response = await fetch(`${GATEWAY_API_URL}/balances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: "USDC",
      sources: domains.map((domain) => ({ domain, depositor }))
    })
  });

  if (!response.ok) {
    throw new Error(`Gateway balance lookup failed (${response.status}).`);
  }

  const data = (await response.json()) as BalancesResponse;
  const total = (data.balances ?? []).reduce(
    (sum, entry) => sum + parseGatewayDecimal(entry.balance),
    0n
  );

  return { available: total, formatted: formatBaseUnits(total) };
}

/** Parse Circle's decimal balance string into USDC base units. */
export function parseGatewayDecimal(balance: string | undefined): bigint {
  if (!balance || !/^\d+(\.\d+)?$/.test(balance)) {
    return 0n;
  }
  return parseUnits(balance, TOKENS.USDC.decimals);
}

function formatBaseUnits(value: bigint): string {
  const decimals = TOKENS.USDC.decimals;
  const whole = value / 10n ** BigInt(decimals);
  const frac = (value % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return `${whole}.${frac}`;
}
