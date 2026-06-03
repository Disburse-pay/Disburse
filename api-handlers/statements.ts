import { assertMethod, readJsonBody, readQueryString, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { generateStatement, type StatementQuery } from "../server/statements.js";

/**
 * Statement Bundle API
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
        networkMode: (readQueryString(request, "network_mode") as "testnet" | "mainnet") || "testnet"
      };

      if (!query.recipient && !query.payer) {
        sendJson(response, 400, {
          error: "Provide at least one of: recipient, payer (address filter required)."
        });
        return;
      }

      const bundle = await generateStatement(query);
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

    if (!query.recipient && !query.payer) {
      sendJson(response, 400, {
        error: "Provide at least one of: recipient, payer (address filter required)."
      });
      return;
    }

    const bundle = await generateStatement(query);
    sendJson(response, 200, bundle);
  } catch (error) {
    sendError(response, error);
  }
}
