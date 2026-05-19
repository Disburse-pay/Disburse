/**
 * End-to-end smoke test for an existing markets deployment.
 *
 * Hits the real Supabase project and Arc Testnet using .env.local. This probe
 * intentionally refuses to create a market: set MARKETS_SMOKE_MARKET_ID to an
 * already-open market that closes within MARKETS_SMOKE_MAX_WAIT_MS.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/smoke-markets.ts
 */

import process from "node:process";
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ApiResponse } from "../server/http";
import { ARC_MIN_GAS_PRICE, arcTestnet, TOKENS } from "../src/lib/arc.js";
import { createServerArcPublicClient } from "../server/markets/rpc.js";
import { verify } from "../packages/psp-verify/src/verify.js";

const DEFAULT_AMOUNT_MICROS = 1_000_000n;
const DEFAULT_MAX_WAIT_MS = 10 * 60_000;
const POST_CLOSE_GRACE_MS = 2_000;

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
]);

const MARKET_ABI = parseAbi([
  "function mintComplete(uint256 amount) external",
  "function claim(uint256 amount) external returns (bytes32)",
  "function resolved() external view returns (bool)",
  "function closesAt() external view returns (uint64)",
  "function status() external view returns (uint8)",
]);

type Probe = (label: string, fn: () => Promise<void>) => Promise<void>;

let failures = 0;
const run: Probe = async (label, fn) => {
  process.stdout.write(`> ${label} ... `);
  try {
    await fn();
    console.log("OK");
  } catch (err) {
    failures += 1;
    console.log("FAIL");
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    throw err;
  }
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

async function main() {
  normalizeEnvAliases();
  assertEnv();

  const marketId = readRequired("MARKETS_SMOKE_MARKET_ID");
  const amount = readBigintEnv("MARKETS_SMOKE_AMOUNT_MICROS", DEFAULT_AMOUNT_MICROS);
  const maxWaitMs = Number(readBigintEnv("MARKETS_SMOKE_MAX_WAIT_MS", BigInt(DEFAULT_MAX_WAIT_MS)));
  const winningOutcome = readWinningOutcome();
  const traderKey = readTraderKey();
  const trader = privateKeyToAccount(traderKey);
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const collateral = getAddress(process.env.MARKETS_COLLATERAL_ADDRESS ?? TOKENS.USDC.address);

  let marketAddress: Address | undefined;
  let closesAtIso: string | undefined;
  let claimTxHash: Hash | undefined;
  let pspUid: string | undefined;
  let pspDocument: unknown;

  await run("GET /api/markets-detail?id=<smoke>", async () => {
    const handler = (await import("../api-handlers/markets-detail.js")).default;
    const r = createResponse();
    await handler({ method: "GET", query: { id: marketId } }, r.api);
    if (r.statusCode !== 200) {
      throw new Error(`status ${r.statusCode}: ${JSON.stringify(r.body)}`);
    }

    const body = r.body as {
      market: {
        id: string;
        onchainAddress: Address;
        closesAt: string;
        status: string;
        winningOutcome?: string;
      };
    };
    if (body.market.id !== marketId) {
      throw new Error(`detail returned wrong market ${body.market.id}`);
    }
    if (body.market.status !== "open" || body.market.winningOutcome) {
      throw new Error(`market must be open/unresolved; got status=${body.market.status}`);
    }

    const waitMs = new Date(body.market.closesAt).getTime() - Date.now();
    if (waitMs <= 0) {
      throw new Error(`market already closed at ${body.market.closesAt}`);
    }
    if (waitMs > maxWaitMs) {
      throw new Error(
        `market closes at ${body.market.closesAt}, beyond MARKETS_SMOKE_MAX_WAIT_MS=${maxWaitMs}`
      );
    }

    marketAddress = getAddress(body.market.onchainAddress);
    closesAtIso = body.market.closesAt;
    console.log(`  market ${marketId} @ ${marketAddress}, closes ${closesAtIso}`);
  });

  if (!marketAddress || !closesAtIso) {
    finish();
    return;
  }

  await run("Read on-chain market state", async () => {
    const [resolved, closesAt, status, balance] = await Promise.all([
      readContract<boolean>(client, {
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "resolved",
      }),
      readContract<bigint>(client, {
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "closesAt",
      }),
      readContract<number>(client, {
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "status",
      }),
      readContract<bigint>(client, {
        address: collateral,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [trader.address],
      }),
    ]);

    if (resolved) throw new Error("market is already resolved on-chain");
    if (status !== 0) throw new Error(`market status must be open (0), got ${status}`);
    if (balance < amount) {
      throw new Error(
        `trader ${trader.address} has ${formatUnits(balance, 6)} USDC, needs ${formatUnits(amount, 6)}`
      );
    }
    console.log(`  trader ${trader.address}, closesAt=${closesAt}`);
  });

  await run("Approve USDC to market", async () => {
    const allowance = await readContract<bigint>(client, {
      address: collateral,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [trader.address, marketAddress],
    });
    if (allowance >= amount) {
      console.log(`  existing allowance ${formatUnits(allowance, 6)} USDC`);
      return;
    }

    const txHash = await submitTraderTx({
      account: trader,
      to: collateral,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [marketAddress, amount],
      }),
    });
    console.log(`  tx ${txHash}`);
  });

  await run("Market.mintComplete", async () => {
    const txHash = await submitTraderTx({
      account: trader,
      to: marketAddress,
      data: encodeFunctionData({
        abi: MARKET_ABI,
        functionName: "mintComplete",
        args: [amount],
      }),
    });
    console.log(`  tx ${txHash}`);
  });

  await run("Wait until market close", async () => {
    const waitMs = new Date(closesAtIso).getTime() - Date.now() + POST_CLOSE_GRACE_MS;
    if (waitMs > 0) {
      console.log(`  sleeping ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  });

  await run("POST /api/admin-markets-resolve", async () => {
    const handler = (await import("../api-handlers/admin-markets-resolve.js")).default;
    const r = createResponse();
    await handler(
      {
        method: "POST",
        query: {},
        body: { marketId, winningOutcome },
        headers: { "x-admin-key": process.env.ADMIN_API_KEY },
      },
      r.api
    );
    if (r.statusCode !== 200) {
      throw new Error(`status ${r.statusCode}: ${JSON.stringify(r.body)}`);
    }
    const body = r.body as { txHash: Hash; resolvedAt: string };
    console.log(`  tx ${body.txHash}, resolvedAt=${body.resolvedAt}`);
  });

  await run("Market.claim", async () => {
    claimTxHash = await submitTraderTx({
      account: trader,
      to: marketAddress,
      data: encodeFunctionData({
        abi: MARKET_ABI,
        functionName: "claim",
        args: [amount],
      }),
    });
    console.log(`  tx ${claimTxHash}`);
  });

  if (!claimTxHash) {
    finish();
    return;
  }

  await run("POST /api/markets-claims", async () => {
    const handler = (await import("../api-handlers/markets-claims.js")).default;
    const r = createResponse();
    await handler(
      {
        method: "POST",
        query: {},
        body: { marketId, txHash: claimTxHash },
      },
      r.api
    );
    if (r.statusCode !== 200) {
      throw new Error(`status ${r.statusCode}: ${JSON.stringify(r.body)}`);
    }
    const body = r.body as { pspUid?: string; claim: { pspUid?: string } };
    pspUid = body.pspUid ?? body.claim.pspUid;
    if (!pspUid) throw new Error("claim indexed, but no PSP UID was returned");
    console.log(`  PSP ${pspUid}`);
  });

  if (!pspUid) {
    finish();
    return;
  }

  await run("GET /api/psp?uid=<claim PSP>", async () => {
    const handler = (await import("../api-handlers/psp.js")).default;
    const r = createResponse();
    await handler({ method: "GET", query: { uid: pspUid } }, r.api);
    if (r.statusCode !== 200) {
      throw new Error(`status ${r.statusCode}: ${JSON.stringify(r.body)}`);
    }
    pspDocument = r.body;
  });

  await run("Verify market-claim PSP offline", async () => {
    const result = await verify(pspDocument);
    if (!result.ok) {
      throw new Error(result.reason ?? "PSP verification failed");
    }
    if (result.fields?.kind !== "market_claim") {
      throw new Error(`expected market_claim PSP, got ${result.fields?.kind ?? "unknown"}`);
    }
    if (result.fields.marketId !== marketId) {
      throw new Error(`PSP market mismatch: ${result.fields.marketId}`);
    }
  });

  finish({
    marketId,
    marketAddress,
    claimTxHash,
    pspUid,
  });
}

async function submitTraderTx(input: {
  account: ReturnType<typeof privateKeyToAccount>;
  to: Address;
  data: Hex;
}): Promise<Hash> {
  const client = createServerArcPublicClient({ timeoutMs: 15_000 });
  const gas = await client.estimateGas({
    account: input.account.address,
    to: input.to,
    data: input.data,
  });
  const gasPrice = await client.getGasPrice();
  const serializedTransaction = await input.account.signTransaction({
    chainId: arcTestnet.id,
    to: input.to,
    data: input.data,
    gas,
    gasPrice: gasPrice > ARC_MIN_GAS_PRICE ? gasPrice : ARC_MIN_GAS_PRICE,
    nonce: await client.getTransactionCount({
      address: input.account.address,
      blockTag: "pending",
    }),
    type: "legacy",
  });
  const hash = await client.sendRawTransaction({ serializedTransaction });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  if (receipt.status !== "success") {
    throw new Error(`transaction reverted: ${hash}`);
  }
  return hash;
}

async function readContract<T>(
  client: ReturnType<typeof createServerArcPublicClient>,
  input: Record<string, unknown>
): Promise<T> {
  return (client as unknown as { readContract: (args: unknown) => Promise<T> }).readContract(input);
}

function normalizeEnvAliases() {
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
}

function assertEnv() {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MARKETS_FACTORY",
    "MARKETS_RELAYER_PRIVATE_KEY",
    "ADMIN_API_KEY",
    "MARKETS_SMOKE_MARKET_ID",
    "DISBURSE_PSP_SIGNING_KEY",
  ];
  for (const key of required) {
    readRequired(key);
  }
  if (process.env.ENABLE_PSP !== "1") {
    throw new Error("ENABLE_PSP=1 is required for the market-claim PSP smoke probe");
  }
}

function readRequired(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing env: ${key}`);
  return value;
}

function readTraderKey(): Hex {
  const key =
    process.env.MARKETS_SMOKE_TRADER_PRIVATE_KEY?.trim() ??
    process.env.MARKETS_RELAYER_PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("MARKETS_SMOKE_TRADER_PRIVATE_KEY or MARKETS_RELAYER_PRIVATE_KEY must be a private key");
  }
  return key as Hex;
}

function readWinningOutcome(): "YES" | "NO" {
  const value = process.env.MARKETS_SMOKE_WINNING_OUTCOME?.trim().toUpperCase();
  if (!value) return "YES";
  if (value !== "YES" && value !== "NO") {
    throw new Error("MARKETS_SMOKE_WINNING_OUTCOME must be YES or NO");
  }
  return value;
}

function readBigintEnv(key: string, fallback: bigint): bigint {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return BigInt(raw);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finish(details?: {
  marketId: string;
  marketAddress: Address;
  claimTxHash: Hash;
  pspUid: string;
}) {
  console.log("");
  if (failures > 0) {
    console.error(`Smoke probe failed: ${failures} probe(s) failed.`);
    process.exit(1);
  }
  if (details) {
    console.log("Smoke probe passed.");
    console.log(`  market: ${details.marketId} @ ${details.marketAddress}`);
    console.log(`  claim:  ${details.claimTxHash}`);
    console.log(`  PSP:    ${details.pspUid}`);
  } else {
    console.log("Smoke probe stopped before completion.");
  }
}

main().catch((err) => {
  console.error("Smoke probe failed:", err);
  process.exit(1);
});
