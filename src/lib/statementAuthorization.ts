import { getAddress, isAddress, type Address } from "viem";
import { DISBURSE_TYPED_DOMAIN } from "./ids.js";
import type { PaymentToken } from "./payments.js";

export const STATEMENT_AUTH_TTL_SECONDS = 5 * 60;
export const MAX_STATEMENT_PROOFS = 500;
export const DEFAULT_STATEMENT_PROOFS = 100;

export const STATEMENT_ACCESS_TYPES = {
  DisburseStatementAccess: [
    { name: "wallet", type: "address" },
    { name: "recipient", type: "string" },
    { name: "payer", type: "string" },
    { name: "from", type: "string" },
    { name: "to", type: "string" },
    { name: "token", type: "string" },
    { name: "networkMode", type: "string" },
    { name: "limit", type: "uint256" },
    { name: "expiresAt", type: "uint256" }
  ]
} as const;

export type StatementQuery = {
  recipient?: string;
  payer?: string;
  from?: string;
  to?: string;
  token?: "USDC" | "EURC";
  networkMode?: "testnet" | "mainnet";
  limit?: number;
};

export type NormalizedStatementQuery = {
  recipient?: Address;
  payer?: Address;
  from?: string;
  to?: string;
  token?: PaymentToken;
  networkMode: "testnet" | "mainnet";
  limit: number;
};

/**
 * Canonicalize all query fields before signing or verifying. In particular,
 * timestamps without an explicit timezone are rejected because a browser and
 * server in different timezones would otherwise hash different messages.
 */
export function normalizeStatementAuthorizationQuery(query: StatementQuery): NormalizedStatementQuery {
  const recipient = normalizeOptionalAddress(query.recipient, "recipient");
  const payer = normalizeOptionalAddress(query.payer, "payer");
  if (!recipient && !payer) {
    throw new Error("Provide at least one of: recipient, payer.");
  }

  const networkMode = query.networkMode ?? "testnet";
  if (networkMode !== "testnet" && networkMode !== "mainnet") {
    throw new Error('network_mode must be "testnet" or "mainnet".');
  }

  if (query.token !== undefined && query.token !== "USDC" && query.token !== "EURC") {
    throw new Error('token must be "USDC" or "EURC".');
  }

  const limit = query.limit ?? DEFAULT_STATEMENT_PROOFS;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_STATEMENT_PROOFS) {
    throw new Error(`limit must be an integer from 1 to ${MAX_STATEMENT_PROOFS}.`);
  }

  const from = normalizeOptionalTimestamp(query.from, "from");
  const to = normalizeOptionalTimestamp(query.to, "to", true);
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new Error("from must be earlier than or equal to to.");
  }

  return {
    recipient,
    payer,
    from,
    to,
    token: query.token,
    networkMode,
    limit
  };
}

export function buildStatementAccessTypedData(input: {
  wallet: Address;
  query: NormalizedStatementQuery;
  expiresAt: bigint;
}) {
  return {
    domain: DISBURSE_TYPED_DOMAIN,
    types: STATEMENT_ACCESS_TYPES,
    primaryType: "DisburseStatementAccess",
    message: {
      wallet: input.wallet,
      recipient: input.query.recipient?.toLowerCase() ?? "",
      payer: input.query.payer?.toLowerCase() ?? "",
      from: input.query.from ?? "",
      to: input.query.to ?? "",
      token: input.query.token ?? "",
      networkMode: input.query.networkMode,
      limit: BigInt(input.query.limit),
      expiresAt: input.expiresAt
    }
  } as const;
}

function normalizeOptionalAddress(value: unknown, field: string): Address | undefined {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return undefined;
  }
  if (typeof value !== "string" || !isAddress(value.trim())) {
    throw new Error(`${field} must be a valid wallet address.`);
  }
  return getAddress(value.trim());
}

function normalizeOptionalTimestamp(
  value: unknown,
  field: string,
  inclusiveDateEnd = false
): string | undefined {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a valid ISO-8601 date or timestamp.`);
  }
  const trimmed = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  if (!dateOnly && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) {
    throw new Error(`${field} timestamps must include a timezone.`);
  }
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${field} must be a valid ISO-8601 date or timestamp.`);
  }
  if (dateOnly) {
    const [year, month, day] = trimmed.split("-").map(Number);
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day
    ) {
      throw new Error(`${field} must be a valid calendar date.`);
    }
    if (inclusiveDateEnd) {
      parsed.setUTCHours(23, 59, 59, 999);
    }
  }
  return parsed.toISOString();
}
