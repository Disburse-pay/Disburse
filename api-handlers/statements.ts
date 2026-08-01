import {
  assertMethod,
  HttpError,
  readHeaderString,
  readJsonBody,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../server/http.js";
import {
  authorizeStatementQuery,
  generateStatement,
  type StatementAccessCredential,
  type StatementQuery
} from "../server/statements.js";
import { enforceRedisRateLimit } from "../server/rate-limit.js";

/**
 * Statement Bundle API
 *
 * Every request requires a short-lived EIP-712 authorization in the
 * x-disburse-wallet, x-disburse-expires-at, and x-disburse-signature headers.
 * The authorizing wallet must be one of the requested statement parties.
 *
 * POST /api/statements — Generate a statement bundle
 *
 * Request body:
 * {
 *   recipient?: "0x...",     // filter by recipient
 *   payer?: "0x...",         // filter by payer/counterparty
 *   from?: "2025-05-01",    // start date (inclusive)
 *   to?: "2025-05-31",      // end date (inclusive)
 *   token?: "USDC",         // token filter
 *   network_mode?: "testnet" // network filter
 * }
 *
 * Response: StatementBundle with summary + array of PSP proofs
 *
 * GET /api/statements?recipient=0x...&payer=0x...&from=...&to=...
 *   Same as POST but with query params (convenience for simple queries)
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method === "GET") {
      const query: StatementQuery = {
        recipient: readQueryString(request, "recipient") || undefined,
        payer: readQueryString(request, "payer") || undefined,
        from: readQueryString(request, "from") || undefined,
        to: readQueryString(request, "to") || undefined,
        token: (readQueryString(request, "token") as "USDC" | "EURC") || undefined,
        networkMode: (readQueryString(request, "network_mode") as "testnet" | "mainnet") || "testnet",
        limit: readOptionalLimit(readQueryString(request, "limit"))
      };

      const auth = await authorizeStatementQuery(readStatementCredential(request), query);
      await enforceRedisRateLimit("statements", auth.wallet);
      const bundle = await generateStatement(auth.query, auth.wallet);
      sendJson(response, 200, bundle);
      return;
    }

    assertMethod(request, "POST");
    const body = readJsonBody(request);

    const query: StatementQuery = {
      recipient: (body.recipient as string) || undefined,
      payer: (body.payer as string) || undefined,
      from: (body.from as string) || undefined,
      to: (body.to as string) || undefined,
      token: (body.token as "USDC" | "EURC") || undefined,
      networkMode: (body.network_mode as "testnet" | "mainnet") || "testnet",
      limit: typeof body.limit === "number" ? body.limit : undefined
    };

    const auth = await authorizeStatementQuery(readStatementCredential(request), query);
    await enforceRedisRateLimit("statements", auth.wallet);
    const bundle = await generateStatement(auth.query, auth.wallet);
    sendJson(response, 200, bundle);
  } catch (error) {
    sendError(response, error);
  }
}

function readStatementCredential(request: ApiRequest): StatementAccessCredential {
  const wallet = readHeaderString(request, "x-disburse-wallet")?.trim();
  const expiresAt = readHeaderString(request, "x-disburse-expires-at")?.trim();
  const signature = readHeaderString(request, "x-disburse-signature")?.trim();
  if (!wallet || !expiresAt || !signature) {
    throw new HttpError(401, "Statement authorization headers are required.");
  }
  return { wallet, expiresAt, signature };
}

function readOptionalLimit(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) {
    throw new HttpError(400, "limit must be a positive integer.");
  }
  return Number(value);
}
