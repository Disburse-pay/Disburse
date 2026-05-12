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
import type { PspV1 } from "../src/lib/psp/types.js";
import type { Address } from "viem";

// ---------- Types ----------

export type StatementQuery = {
  /** Filter by recipient address */
  recipient?: string;
  /** Filter by payer address (counterparty) */
  payer?: string;
  /** Start date (ISO-8601, inclusive) */
  from?: string;
  /** End date (ISO-8601, inclusive) */
  to?: string;
  /** Token filter */
  token?: "USDC" | "EURC";
  /** Network mode filter */
  networkMode?: "testnet" | "mainnet";
  /** Max results (default 100) */
  limit?: number;
};

export type StatementBundle = {
  id: string;
  query: StatementQuery;
  summary: StatementSummary;
  proofs: PspV1[];
  generatedAt: string;
};

export type StatementSummary = {
  totalProofs: number;
  totalAmount: string;
  token: string;
  period: { from: string; to: string };
  recipients: string[];
  payers: string[];
  networkMode: string;
};

// ---------- Public API ----------

/**
 * Generate a statement bundle for the given query parameters.
 */
export async function generateStatement(query: StatementQuery): Promise<StatementBundle> {
  const supabase = getSupabaseAdmin();

  // Build the query
  let dbQuery = supabase
    .from("psp_documents")
    .select("document, created_at")
    .eq("network_mode", query.networkMode || "testnet")
    .order("created_at", { ascending: true });

  if (query.from) {
    dbQuery = dbQuery.gte("created_at", query.from);
  }
  if (query.to) {
    dbQuery = dbQuery.lte("created_at", query.to);
  }

  const limit = Math.min(query.limit || 100, 500);
  dbQuery = dbQuery.limit(limit);

  const { data, error } = await dbQuery;
  if (error) throw new HttpError(500, error.message);

  // Filter by recipient/payer/token in application layer (JSONB fields)
  let proofs: PspV1[] = (data || []).map((row) => row.document as unknown as PspV1);

  if (query.recipient) {
    const addr = query.recipient.toLowerCase();
    proofs = proofs.filter((p) => p.invoice.recipient.toLowerCase() === addr);
  }

  if (query.payer) {
    const addr = query.payer.toLowerCase();
    proofs = proofs.filter((p) => p.invoice.payer.toLowerCase() === addr);
  }

  if (query.token) {
    proofs = proofs.filter((p) => p.invoice.token === query.token);
  }

  // Compute summary
  const totalAmount = proofs
    .reduce((sum, p) => sum + parseFloat(p.invoice.amount || "0"), 0)
    .toFixed(2);

  const recipients = [...new Set(proofs.map((p) => p.invoice.recipient.toLowerCase()))];
  const payers = [...new Set(proofs.map((p) => p.invoice.payer.toLowerCase()))];

  const summary: StatementSummary = {
    totalProofs: proofs.length,
    totalAmount,
    token: query.token || "USDC",
    period: {
      from: query.from || (proofs[0]?.createdAt ?? new Date().toISOString()),
      to: query.to || (proofs[proofs.length - 1]?.createdAt ?? new Date().toISOString())
    },
    recipients,
    payers,
    networkMode: query.networkMode || "testnet"
  };

  return {
    id: `stmt:${Date.now().toString(36)}`,
    query,
    summary,
    proofs,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Generate a counterparty-grouped statement showing activity between
 * two specific addresses over a period.
 */
export async function generateCounterpartyStatement(
  recipient: string,
  payer: string,
  from?: string,
  to?: string
): Promise<StatementBundle> {
  return generateStatement({
    recipient,
    payer,
    from: from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    to: to || new Date().toISOString(),
    networkMode: "testnet"
  });
}
