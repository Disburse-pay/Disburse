/**
 * PSP Canonicalization
 *
 * Produces a deterministic byte representation of a PspCore document suitable
 * for hashing and signing. The canonical form is:
 *
 *   domain_separator || deterministic_json(PspCore)
 *
 * Domain separator: "DISBURSE-PSP-v1\n" + networkMode + "\n"
 *
 * Deterministic JSON: keys sorted lexicographically at every depth, no
 * whitespace, undefined/null fields omitted, addresses lowercased, hex
 * values lowercased with 0x prefix.
 */

import { keccak256, type Hex } from "viem";
import type { PspCore } from "./types.js";

// ---------- Domain separator ----------

const PSP_DOMAIN_PREFIX = "DISBURSE-PSP-v1\n";

export function buildDomainSeparator(networkMode: string): string {
  return `${PSP_DOMAIN_PREFIX}${networkMode}\n`;
}

// ---------- Normalization ----------

/**
 * Normalize a value for canonical JSON encoding.
 * - Strings that look like EVM addresses → lowercased checksummed-then-lower
 * - Strings that look like hex (0x…) → lowercased
 * - Everything else passes through unchanged
 */
function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined; // will be omitted in JSON
  }

  if (typeof value === "string") {
    // Hex values (addresses, hashes, signatures): lowercase
    if (/^0x[0-9a-fA-F]+$/.test(value)) {
      return value.toLowerCase();
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue).filter((v) => v !== undefined);
  }

  if (typeof value === "object") {
    return normalizeObject(value as Record<string, unknown>);
  }

  return value;
}

function normalizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const normalized = normalizeValue(obj[key]);
    if (normalized !== undefined) {
      result[key] = normalized;
    }
  }
  return result;
}

// ---------- Deterministic stringify ----------

/**
 * JSON.stringify with sorted keys at every depth. Does not emit undefined or
 * null fields. Arrays preserve order.
 */
export function deterministicStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => deterministicStringify(item))
      .filter((s) => s !== "");
    return `[${items.join(",")}]`;
  }

  if (typeof value === "object") {
    const entries: string[] = [];
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined || v === null) continue;
      const serialized = deterministicStringify(v);
      if (serialized === "") continue;
      entries.push(`${JSON.stringify(key)}:${serialized}`);
    }
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

// ---------- Core extraction ----------

/**
 * Extract the signable core from a PspCore (or a full PspV1 that has extra fields).
 * Removes digest, signature, uid, createdAt — only core fields remain.
 *
 * v1.1: a PSP carries either `invoice` (payment) or `marketClaim` (market
 * payout) but not both. Each is included only when present so the canonical
 * bytes match whatever shape was signed.
 */
export function extractCore(psp: PspCore & Record<string, unknown>): PspCore {
  const core: PspCore = {
    version: psp.version,
    networkMode: psp.networkMode,
    issuer: psp.issuer,
    settlement: psp.settlement,
  };

  if (psp.invoice) {
    core.invoice = psp.invoice;
  }

  if (psp.marketClaim) {
    core.marketClaim = psp.marketClaim;
  }

  if (psp.source) {
    core.source = psp.source;
  }

  if (psp.linkedDocuments && psp.linkedDocuments.length > 0) {
    core.linkedDocuments = psp.linkedDocuments;
  }

  return core;
}

// ---------- Canonical bytes ----------

/**
 * Produce the canonical byte representation of a PSP core document.
 * Returns a Uint8Array of: domain_separator || deterministic_json(normalized_core)
 */
export function canonicalBytes(core: PspCore): Uint8Array {
  const domain = buildDomainSeparator(core.networkMode);
  const normalized = normalizeValue(core) as Record<string, unknown>;
  const json = deterministicStringify(normalized);
  const full = domain + json;
  return new TextEncoder().encode(full);
}

/**
 * Compute the keccak256 digest of the canonical PSP bytes.
 */
export function computeDigest(core: PspCore): Hex {
  const bytes = canonicalBytes(core);
  return keccak256(bytes);
}
