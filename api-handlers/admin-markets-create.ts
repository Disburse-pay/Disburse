import {
  assertMethod,
  readJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import { HttpError } from "../server/http.js";
import { randomUUID } from "node:crypto";
import { isAddress, type Address } from "viem";
import { createMarket } from "../server/markets/admin.js";
import { insertMarket } from "../server/markets/repo.js";

/**
 * POST /api/admin-markets-create
 *
 * Admin-only. Deploys a new Market via MarketFactory and inserts the
 * off-chain row. The admin key is matched against ADMIN_API_KEY in env via
 * the `x-admin-key` header.
 *
 * Request body:
 *   {
 *     question: string,
 *     closesAt: ISO-8601 timestamp,
 *     description?: string,
 *     category?: string,
 *     metadataUri?: string,
 *     createdBy?: 0x...
 *   }
 *
 * Response: { market: Market, txHash, blockNumber }
 */
export default async function handler(
  request: ApiRequest & { headers?: Record<string, string | string[] | undefined> },
  response: ApiResponse
) {
  try {
    assertMethod(request, "POST");
    assertAdminKey(request);

    const body = readJsonBody(request);
    const question = body.question;
    const closesAtIso = body.closesAt;
    if (typeof question !== "string" || !question.trim()) {
      throw new HttpError(400, "question is required");
    }
    if (typeof closesAtIso !== "string" || isNaN(Date.parse(closesAtIso))) {
      throw new HttpError(400, "closesAt must be a valid ISO-8601 timestamp");
    }
    const closesAt = new Date(closesAtIso);
    if (closesAt.getTime() <= Date.now() + 60_000) {
      throw new HttpError(400, "closesAt must be at least 60 seconds in the future");
    }

    const description = optionalString(body.description);
    const category = optionalString(body.category) ?? "General";
    const metadataUri = optionalString(body.metadataUri);
    const createdBy = optionalAddress(body.createdBy);

    // Generate UUID up front so the on-chain bytes32 (keccak256 of UUID) is
    // deterministic from the chosen id. Insert row only after on-chain
    // deployment succeeds so we never have a dangling DB market with no
    // contract.
    const marketId = randomUUID();

    const deployed = await createMarket({
      marketId,
      closesAt,
      metadataUri,
    });

    const market = await insertMarket({
      id: marketId,
      onchainAddress: deployed.marketAddress,
      question: question.trim(),
      description,
      category,
      closesAt: closesAt.toISOString(),
      metadataUri,
      createdBy,
    });

    sendJson(response, 200, {
      market,
      onchainMarketId: deployed.onchainMarketId,
      txHash: deployed.txHash,
      blockNumber: deployed.blockNumber,
    });
  } catch (error) {
    sendError(response, error);
  }
}

function assertAdminKey(request: ApiRequest & { headers?: Record<string, string | string[] | undefined> }) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    throw new HttpError(503, "ADMIN_API_KEY is not configured");
  }
  const headerVal = request.headers?.["x-admin-key"] ?? request.headers?.["X-Admin-Key"];
  const provided = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (provided !== expected) {
    throw new HttpError(401, "Invalid admin key");
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function optionalAddress(value: unknown): Address | undefined {
  if (typeof value === "string" && isAddress(value)) return value;
  return undefined;
}
