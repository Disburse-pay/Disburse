/**
 * Wire-shape helpers for the lending API handlers.
 *
 * Supabase returns Postgres NUMERIC columns as JS Numbers, and the default
 * `String()` coercion of a very large Number produces scientific notation
 * (e.g. 76580063818000000000000 → "7.6580063818e+22"). `BigInt(...)` on the
 * client then throws SyntaxError. Coerce through `BigInt(Math.round(Number))`
 * so the wire is always a plain integer string parseable by BigInt.
 */

export function toIntString(v: unknown): string {
  if (v === null || v === undefined) return "0";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "0";
    return BigInt(Math.round(v)).toString();
  }
  if (typeof v === "string") {
    if (/^-?\d+$/.test(v)) return v;
    if (/[eE]/.test(v)) return BigInt(Math.round(Number(v))).toString();
    return v;
  }
  return String(v);
}

export function toIntStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return toIntString(v);
}
