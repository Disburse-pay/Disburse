import {
  assertMethod,
  readJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import { HttpError } from "../server/http.js";
import type { Hash } from "viem";
import { indexClaim } from "../server/markets/claims.js";

/**
 * POST /api/markets-claims
 *
 * Index a market claim transaction:
 *   1. Fetches the Arc receipt, decodes MarketClaimed, persists the row.
 *   2. Triggers PSP issuance (gated on ENABLE_PSP=1 + signing key).
 *
 * Idempotent on `tx_hash`: re-POSTing the same fields returns the cached
 * claim with its psp_uid.
 *
 * Request body: { marketId: <uuid>, txHash: 0x... }
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");
    const body = readJsonBody(request);

    const marketId = body.marketId;
    if (typeof marketId !== "string" || !marketId) {
      throw new HttpError(400, "Provide marketId (uuid)");
    }
    const txHash = readHash(body.txHash);

    const { claim, pspUid, isNew } = await indexClaim({ marketId, txHash });

    sendJson(response, 200, {
      claim: {
        ...claim,
        sharesMicros: String(claim.sharesMicros),
        payoutMicros: String(claim.payoutMicros),
      },
      pspUid,
      isNew,
    });
  } catch (error) {
    sendError(response, error);
  }
}

function readHash(value: unknown): Hash {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new HttpError(400, "txHash must be a 32-byte hex string");
  }
  return value as Hash;
}
