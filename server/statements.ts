/**
 * Statement Bundles
 *
 * Aggregates PSPs per counterparty over a time period into exportable
 * statement documents. Supports JSON bundle and summary PDF.
 *
 * Use cases:
 * - Monthly reconciliation: "All payments between me and counterparty X"
 * - Tax reporting: "All USDC received in Q2 2025"
 * - Audit bundle: "Prove all settlements for this period"
 */

import { getSupabaseAdmin } from "./supabase.js";
import { HttpError } from "./http.js";
import { formatTokenAmount, parseTokenAmount, type PaymentToken } from "../src/lib/payments.js";
import type { PspInvoice, PspV1 } from "../src/lib/psp/types.js";
import { getAddress, isAddress, type Address } from "viem";
import {
  buildStatementAccessTypedData,
  normalizeStatementAuthorizationQuery,
  STATEMENT_AUTH_TTL_SECONDS,
  type NormalizedStatementQuery,
  type StatementQuery
} from "../src/lib/statementAuthorization.js";
import { readWalletSignature, verifyWalletTypedData } from "./wallet-auth.js";

export {
  buildStatementAccessTypedData,
  MAX_STATEMENT_PROOFS,
  STATEMENT_AUTH_TTL_SECONDS
} from "../src/lib/statementAuthorization.js";
export type { NormalizedStatementQuery, StatementQuery } from "../src/lib/statementAuthorization.js";

const STATEMENT_PAGE_SIZE = 500;

// Statements are invoice-centric, so within this module a proof always has an
// `invoice` present.
type PaymentPsp = PspV1 & { invoice: PspInvoice };

// ---------- Types ----------

export type StatementBundle = {
  id: string;
  query: NormalizedStatementQuery;
  summary: StatementSummary;
  proofs: PspV1[];
  generatedAt: string;
};

export type StatementSummary = {
  totalProofs: number;
  totalAmount: string | null;
  token: PaymentToken | "MIXED";
  totals: Partial<Record<PaymentToken, string>>;
  period: { from: string; to: string };
  recipients: string[];
  payers: string[];
  networkMode: string;
};

export type StatementAccessCredential = {
  wallet: string;
  expiresAt: string;
  signature: string;
};

// ---------- Authorization and validation ----------

export function normalizeStatementQuery(query: StatementQuery): NormalizedStatementQuery {
  try {
    return normalizeStatementAuthorizationQuery(query);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid statement query.");
  }
}

export async function authorizeStatementQuery(
  credential: StatementAccessCredential,
  query: StatementQuery
): Promise<{ wallet: Address; query: NormalizedStatementQuery }> {
  if (!isAddress(credential.wallet)) {
    throw new HttpError(401, "A valid statement-owner wallet is required.");
  }
  const wallet = getAddress(credential.wallet);
  const expiresAt = readStatementExpiry(credential.expiresAt);
  assertFreshStatementAuthorization(expiresAt);

  const signature = readWalletSignature(
    credential.signature,
    401,
    "A valid statement authorization signature is required."
  );

  const normalized = normalizeStatementQuery(query);
  const walletLower = wallet.toLowerCase();
  if (
    normalized.recipient?.toLowerCase() !== walletLower &&
    normalized.payer?.toLowerCase() !== walletLower
  ) {
    throw new HttpError(403, "A statement must include its authorizing wallet as recipient or payer.");
  }

  const verified = await verifyWalletTypedData({
    ...buildStatementAccessTypedData({ wallet, query: normalized, expiresAt }),
    address: wallet,
    signature
  });
  if (!verified) {
    throw new HttpError(401, "Statement authorization signature does not match the query.");
  }

  return { wallet, query: normalized };
}

// ---------- Public API ----------

/**
 * Generate a statement bundle for the given query parameters.
 */
export async function generateStatement(
  query: NormalizedStatementQuery,
  authorizedWallet: Address
): Promise<StatementBundle> {
  const walletLower = getAddress(authorizedWallet).toLowerCase();
  if (query.recipient?.toLowerCase() !== walletLower && query.payer?.toLowerCase() !== walletLower) {
    throw new HttpError(403, "A statement must include its authorizing wallet as recipient or payer.");
  }

  const supabase = getSupabaseAdmin();
  const rows: Array<{ document: unknown; created_at: string }> = [];
  let expectedCount: number | undefined;

  for (let offset = 0; offset < query.limit; offset += STATEMENT_PAGE_SIZE) {
    const pageSize = Math.min(STATEMENT_PAGE_SIZE, query.limit - offset);
    let dbQuery = supabase
      .from("psp_documents")
      .select("document, created_at", { count: offset === 0 ? "exact" : undefined })
      .eq("network_mode", query.networkMode)
      .not("invoice_recipient", "is", null)
      .order("created_at", { ascending: true })
      .order("uid", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (query.recipient) {
      dbQuery = dbQuery.eq("invoice_recipient", query.recipient.toLowerCase());
    }
    if (query.payer) {
      dbQuery = dbQuery.eq("invoice_payer", query.payer.toLowerCase());
    }
    if (query.token) {
      dbQuery = dbQuery.eq("invoice_token", query.token);
    }
    if (query.from) {
      dbQuery = dbQuery.gte("created_at", query.from);
    }
    if (query.to) {
      dbQuery = dbQuery.lte("created_at", query.to);
    }

    const { data, error, count } = await dbQuery;
    if (error) throw new HttpError(500, "Failed to read settlement proofs for the statement.");
    if (offset === 0) {
      expectedCount = count ?? undefined;
      if (expectedCount !== undefined && expectedCount > query.limit) {
        throw new HttpError(
          422,
          `This query matches ${expectedCount} proofs, above the ${query.limit}-proof limit. Narrow the date range.`
        );
      }
    }

    const page = (data ?? []) as Array<{ document: unknown; created_at: string }>;
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  if (expectedCount !== undefined && rows.length !== expectedCount) {
    throw new HttpError(409, "The statement data changed while it was being generated. Retry the request.");
  }

  const proofs: PaymentPsp[] = rows
    .map((row) => row.document as PspV1)
    .filter((p): p is PaymentPsp => Boolean(p.invoice));

  const totalsInBaseUnits = new Map<PaymentToken, bigint>();
  for (const proof of proofs) {
    const token = proof.invoice.token;
    if (token !== "USDC" && token !== "EURC") {
      throw new HttpError(500, "A stored settlement proof contains an unsupported token.");
    }
    let amount: bigint;
    try {
      amount = parseTokenAmount(proof.invoice.amount, token);
    } catch {
      throw new HttpError(500, "A stored settlement proof contains an invalid amount.");
    }
    totalsInBaseUnits.set(token, (totalsInBaseUnits.get(token) ?? 0n) + amount);
  }

  const totals: Partial<Record<PaymentToken, string>> = {};
  for (const [token, amount] of totalsInBaseUnits) {
    totals[token] = formatTokenAmount(amount, token);
  }
  const tokens = [...totalsInBaseUnits.keys()];
  const summaryToken: PaymentToken | "MIXED" =
    query.token ?? (tokens.length <= 1 ? (tokens[0] ?? "USDC") : "MIXED");
  const totalAmount = summaryToken === "MIXED" ? null : (totals[summaryToken] ?? "0");

  const recipients = [...new Set(proofs.map((p) => p.invoice.recipient.toLowerCase()))];
  const payers = [...new Set(proofs.map((p) => p.invoice.payer.toLowerCase()))];

  const summary: StatementSummary = {
    totalProofs: proofs.length,
    totalAmount,
    token: summaryToken,
    totals,
    period: {
      // PSP v1 createdAt is unsigned envelope metadata. Settlement timestamps
      // are part of the signed core and are the only safe document-derived
      // fallback for statement periods.
      from: query.from || (proofs[0]?.settlement.settledAt ?? new Date().toISOString()),
      to: query.to || (proofs[proofs.length - 1]?.settlement.settledAt ?? new Date().toISOString())
    },
    recipients,
    payers,
    networkMode: query.networkMode
  };

  return {
    id: `stmt:${Date.now().toString(36)}`,
    query,
    summary,
    proofs,
    generatedAt: new Date().toISOString()
  };
}

function readStatementExpiry(value: string): bigint {
  if (!/^\d{1,20}$/.test(value)) {
    throw new HttpError(401, "Statement authorization expiry is invalid.");
  }
  return BigInt(value);
}

function assertFreshStatementAuthorization(expiresAt: bigint): void {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (expiresAt <= now) {
    throw new HttpError(401, "Statement authorization has expired.");
  }
  if (expiresAt > now + BigInt(STATEMENT_AUTH_TTL_SECONDS)) {
    throw new HttpError(
      401,
      `Statement authorization may be valid for at most ${STATEMENT_AUTH_TTL_SECONDS} seconds.`
    );
  }
}
