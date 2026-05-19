import {
  assertMethod,
  readJsonBody,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import { HttpError } from "../server/http.js";
import type { Hash } from "viem";
import { indexFills } from "../server/markets/fills.js";
import { getSupabaseAdmin } from "../server/supabase.js";

/**
 * /api/markets-fills
 *
 * POST { txHash } — Index every `Filled` event in the Exchange tx. Returns
 *   the decoded fills + insertedCount. Idempotent.
 *
 * GET ?marketId=<uuid>&limit=N — Recent fills for a market (price tape).
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method === "POST") {
      const body = readJsonBody(request);
      const txHash = readHash(body.txHash);
      const result = await indexFills(txHash);
      // Serialize bigints as strings.
      sendJson(response, 200, {
        ...result,
        fills: result.fills.map((f) => ({
          orderHash: f.orderHash,
          maker: f.maker,
          taker: f.taker,
          market: f.market,
          outcome: f.outcome,
          side: f.side,
          price: f.price.toString(),
          fillSize: f.fillSize.toString(),
          totalUsdc: f.totalUsdc.toString(),
        })),
      });
      return;
    }

    assertMethod(request, "GET");
    const marketId = readQueryString(request, "marketId");
    if (!marketId) {
      throw new HttpError(400, "Provide marketId");
    }
    const limit = Math.min(parseInt(readQueryString(request, "limit") ?? "100", 10) || 100, 500);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("market_fills")
      .select(
        "id,market_id,order_hash,taker,maker,outcome,side,price,size,total_usdc,tx_hash,block_number,filled_at"
      )
      .eq("market_id", marketId)
      .order("filled_at", { ascending: false })
      .limit(limit);
    if (error) throw new HttpError(500, error.message);

    sendJson(response, 200, {
      fills: (data ?? []).map((row: any) => ({
        id: String(row.id),
        marketId: row.market_id,
        orderHash: row.order_hash,
        taker: row.taker,
        maker: row.maker,
        outcome: row.outcome,
        side: row.side,
        price: String(row.price),
        size: String(row.size),
        totalUsdc: String(row.total_usdc),
        txHash: row.tx_hash,
        blockNumber: row.block_number,
        filledAt: row.filled_at,
      })),
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
