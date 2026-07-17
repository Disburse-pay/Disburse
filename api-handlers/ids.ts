import { assertMethod, HttpError, readJsonBody, readQueryString, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { getSupabaseAdmin } from "../server/supabase.js";
import {
  buildIdClaimTypedData,
  ID_CLAIM_TTL_SECONDS,
  isValidHandle,
  normalizeHandle
} from "../src/lib/ids.js";
import { getAddress, isAddress, verifyTypedData, type Address, type Hex } from "viem";

/**
 * /api/ids — Disburse ID directory.
 *
 * GET ?handle=<name>      -> 200 { handle, address, claimedAt } | 404
 * GET ?address=0x...      -> 200 { handle: string | null, address }
 * POST { handle, address, expiresAt, signature }
 *   Claims a handle for a wallet. The wallet signs EIP-712 typed data
 *   (domain { name: "Disburse", version: "1", chainId: 5042002 },
 *   DisburseIdClaim { handle, wallet, expiresAt }) so the claim cannot be
 *   replayed on another app or chain, and expires after a short window.
 *   Claims are immutable: one handle per address, first come first served.
 *   Re-posting the identical pair is idempotent.
 *
 * Public endpoint; handles are payment destinations by design.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method === "GET") {
      await handleResolve(request, response);
      return;
    }
    assertMethod(request, "POST");
    await handleClaim(request, response);
  } catch (error) {
    sendError(response, error);
  }
}

type IdRow = { handle: string; address: string; claimed_at: string };

async function handleResolve(request: ApiRequest, response: ApiResponse) {
  const handleInput = readQueryString(request, "handle");
  const addressInput = readQueryString(request, "address");

  if (handleInput) {
    const handle = normalizeHandle(handleInput);
    if (!isValidHandle(handle)) {
      throw new HttpError(400, "handle must be 3-16 characters: a-z, 0-9, underscore.");
    }
    const row = await findByHandle(handle);
    if (!row) {
      sendJson(response, 404, { error: `No Disburse ID named "${handle}".` });
      return;
    }
    sendJson(response, 200, toPublicId(row));
    return;
  }

  if (addressInput) {
    if (!isAddress(addressInput)) {
      throw new HttpError(400, "address must be a valid 0x address.");
    }
    const row = await findByAddress(addressInput);
    sendJson(response, 200, row ? toPublicId(row) : { handle: null, address: getAddress(addressInput) });
    return;
  }

  throw new HttpError(400, "Provide a handle or address query parameter.");
}

async function handleClaim(request: ApiRequest, response: ApiResponse) {
  const body = readJsonBody(request);

  const handle = normalizeHandle(typeof body.handle === "string" ? body.handle : "");
  if (!isValidHandle(handle)) {
    throw new HttpError(422, "handle must be 3-16 characters: a-z, 0-9, underscore.");
  }

  const addressInput = typeof body.address === "string" ? body.address.trim() : "";
  if (!isAddress(addressInput)) {
    throw new HttpError(400, "address must be a valid 0x address.");
  }
  const wallet = getAddress(addressInput);

  const expiresAtRaw = body.expiresAt;
  const expiresAt =
    typeof expiresAtRaw === "number" && Number.isSafeInteger(expiresAtRaw) && expiresAtRaw > 0
      ? BigInt(expiresAtRaw)
      : typeof expiresAtRaw === "string" && /^\d+$/.test(expiresAtRaw)
        ? BigInt(expiresAtRaw)
        : undefined;
  if (expiresAt === undefined) {
    throw new HttpError(400, "expiresAt must be a unix timestamp in seconds.");
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (expiresAt <= nowSeconds) {
    throw new HttpError(401, "Claim signature has expired. Sign a fresh claim.");
  }
  if (expiresAt > nowSeconds + BigInt(ID_CLAIM_TTL_SECONDS)) {
    throw new HttpError(400, `expiresAt may be at most ${ID_CLAIM_TTL_SECONDS} seconds in the future.`);
  }

  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new HttpError(400, "signature must be a valid 65-byte hex signature.");
  }

  const verified = await verifyTypedData({
    ...buildIdClaimTypedData({ handle, wallet, expiresAt }),
    address: wallet,
    signature: signature as Hex
  }).catch(() => false);
  if (!verified) {
    throw new HttpError(401, "Signature does not match the wallet.");
  }

  const addressLower = wallet.toLowerCase();

  const existingByHandle = await findByHandle(handle);
  if (existingByHandle) {
    if (existingByHandle.address === addressLower) {
      sendJson(response, 200, toPublicId(existingByHandle));
      return;
    }
    throw new HttpError(409, "That name is already claimed. Pick another.");
  }

  const existingByAddress = await findByAddress(wallet);
  if (existingByAddress) {
    throw new HttpError(409, `This wallet already owns the name "${existingByAddress.handle}".`);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("disburse_ids")
    .insert({ handle, address: addressLower })
    .select("handle, address, claimed_at")
    .single();

  if (error) {
    // Unique violation from a concurrent claim: report it as taken.
    if (error.code === "23505") {
      throw new HttpError(409, "That name is already claimed. Pick another.");
    }
    throw new HttpError(500, `Failed to claim Disburse ID: ${error.message}`);
  }

  sendJson(response, 200, toPublicId(data as IdRow));
}

async function findByHandle(handle: string): Promise<IdRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("disburse_ids")
    .select("handle, address, claimed_at")
    .eq("handle", handle)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, `Failed to resolve Disburse ID: ${error.message}`);
  }
  return (data as IdRow | null) ?? null;
}

async function findByAddress(address: string): Promise<IdRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("disburse_ids")
    .select("handle, address, claimed_at")
    .eq("address", address.toLowerCase())
    .maybeSingle();
  if (error) {
    throw new HttpError(500, `Failed to resolve Disburse ID: ${error.message}`);
  }
  return (data as IdRow | null) ?? null;
}

function toPublicId(row: IdRow): { handle: string; address: Address; claimedAt: string } {
  return {
    handle: row.handle,
    address: getAddress(row.address),
    claimedAt: row.claimed_at
  };
}
