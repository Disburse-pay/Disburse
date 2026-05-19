/**
 * Create a live Arc prediction market and insert its Supabase row.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/create-market.ts \
 *     --question "Will Arc mainnet launch by 2026-07-01?" \
 *     --closes-at "2026-07-01T00:00:00.000Z" \
 *     --category Crypto \
 *     --description "Resolves YES if Arc mainnet is publicly operational."
 *
 * For a short-lived smoke market:
 *   node --env-file=.env.local --import tsx scripts/create-market.ts \
 *     --question "Smoke market $(Get-Date -Format o)" \
 *     --close-in-minutes 8 \
 *     --category Smoke
 */

import process from "node:process";
import type { ApiResponse } from "../server/http.js";

type Args = {
  question?: string;
  closesAt?: string;
  closeInMinutes?: string;
  category?: string;
  description?: string;
  metadataUri?: string;
  createdBy?: string;
  help?: boolean;
};

function createResponse() {
  const state: {
    statusCode?: number;
    body?: unknown;
    headers: Record<string, string>;
    api: ApiResponse;
  } = {
    headers: {},
    api: undefined as unknown as ApiResponse,
  };
  state.api = {
    status: (code: number) => {
      state.statusCode = code;
      return state.api;
    },
    json: (body: unknown) => {
      state.body = body;
    },
    setHeader: (name: string, value: string) => {
      state.headers[name.toLowerCase()] = value;
    },
  };
  return state;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    i += 1;
    switch (key) {
      case "question":
        out.question = value;
        break;
      case "closes-at":
        out.closesAt = value;
        break;
      case "close-in-minutes":
        out.closeInMinutes = value;
        break;
      case "category":
        out.category = value;
        break;
      case "description":
        out.description = value;
        break;
      case "metadata-uri":
        out.metadataUri = value;
        break;
      case "created-by":
        out.createdBy = value;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return out;
}

function usage() {
  console.log(`Create a prediction market.

Required env:
  ADMIN_API_KEY
  SUPABASE_URL or VITE_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  MARKETS_FACTORY
  MARKETS_RELAYER_PRIVATE_KEY

Required flags:
  --question "Question?"
  --closes-at "2026-07-01T00:00:00.000Z"
    or --close-in-minutes 8

Optional flags:
  --category Crypto
  --description "Resolution criteria"
  --metadata-uri ipfs://...
  --created-by 0x...
`);
}

function resolveClosesAt(args: Args): string {
  if (args.closesAt && args.closeInMinutes) {
    throw new Error("Use either --closes-at or --close-in-minutes, not both.");
  }
  if (args.closesAt) {
    if (Number.isNaN(Date.parse(args.closesAt))) {
      throw new Error("--closes-at must be a valid ISO-8601 timestamp.");
    }
    return new Date(args.closesAt).toISOString();
  }
  if (args.closeInMinutes) {
    const minutes = Number(args.closeInMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error("--close-in-minutes must be a positive number.");
    }
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }
  throw new Error("Missing --closes-at or --close-in-minutes.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.question?.trim()) {
    throw new Error("Missing --question.");
  }

  const requiredEnv = [
    "ADMIN_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MARKETS_FACTORY",
    "MARKETS_RELAYER_PRIVATE_KEY",
  ];
  const missing = requiredEnv.filter((key) => !process.env[key]?.trim());
  if (!process.env.SUPABASE_URL?.trim() && !process.env.VITE_SUPABASE_URL?.trim()) {
    missing.push("SUPABASE_URL or VITE_SUPABASE_URL");
  }
  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(", ")}`);
  }

  const body = {
    question: args.question.trim(),
    closesAt: resolveClosesAt(args),
    category: args.category,
    description: args.description,
    metadataUri: args.metadataUri,
    createdBy: args.createdBy,
  };

  const handler = (await import("../api-handlers/admin-markets-create.js")).default;
  const response = createResponse();
  await handler(
    {
      method: "POST",
      headers: { "x-admin-key": process.env.ADMIN_API_KEY },
      body,
    },
    response.api
  );

  if (response.statusCode !== 200) {
    throw new Error(`create market failed: ${JSON.stringify(response.body)}`);
  }

  const result = response.body as {
    market: { id: string; onchainAddress: string; closesAt: string; question: string };
    onchainMarketId: string;
    txHash: string;
    blockNumber: string;
  };

  console.log(JSON.stringify(result, null, 2));
  console.log("");
  console.log(`MARKETS_SMOKE_MARKET_ID=${result.market.id}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
