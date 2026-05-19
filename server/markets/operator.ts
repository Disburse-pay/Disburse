import { randomUUID } from "node:crypto";
import type { Outcome } from "../../src/lib/markets/types.js";
import type { Market } from "../../src/lib/markets/types.js";
import { HttpError } from "../http.js";
import { createMarket, getRelayerAddress, resolveMarket } from "./admin.js";
import { insertMarket, listMarkets, setMarketResolved } from "./repo.js";

const OPERATOR_KIND = "disburse.crypto-30m-v1";
const DEFAULT_SYMBOLS = ["BTC", "ETH"] as const;
const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_MAX_ACTIONS = 1;

type OperatorMetadata = {
  kind: typeof OPERATOR_KIND;
  symbol: string;
  pair: string;
  startPriceUsd: string;
  startPriceAt: string;
  durationMinutes: number;
  priceSource: string;
};

type OperatorAction =
  | {
      type: "resolved";
      marketId: string;
      symbol: string;
      startPriceUsd: string;
      closePriceUsd: string;
      winningOutcome: Outcome;
      txHash: string;
    }
  | {
      type: "created";
      marketId: string;
      symbol: string;
      startPriceUsd: string;
      closesAt: string;
      txHash: string;
    }
  | {
      type: "noop";
      reason: string;
    };

export async function runMarketsOperator(now = new Date()): Promise<{
  checkedAt: string;
  actions: OperatorAction[];
}> {
  const symbols = readSymbols();
  const durationMinutes = readPositiveNumberEnv(
    "MARKETS_OPERATOR_DURATION_MINUTES",
    DEFAULT_DURATION_MINUTES
  );
  const maxActions = Math.max(
    1,
    Math.floor(readPositiveNumberEnv("MARKETS_OPERATOR_MAX_ACTIONS", DEFAULT_MAX_ACTIONS))
  );
  const actions: OperatorAction[] = [];

  const markets = await listMarkets({ limit: 500 });

  for (const market of markets) {
    if (actions.length >= maxActions) break;
    const metadata = readOperatorMetadata(market);
    if (!metadata) continue;
    if (market.status === "resolved") continue;
    if (new Date(market.closesAt).getTime() > now.getTime()) continue;

    const closePrice = await fetchUsdPrice(metadata.symbol);
    const winningOutcome: Outcome =
      closePrice > Number(metadata.startPriceUsd) ? "YES" : "NO";
    const resolved = await resolveMarket({
      marketId: market.id,
      marketAddress: market.onchainAddress,
      winningOutcome,
    });
    await setMarketResolved(
      market.id,
      resolved.winningOutcome,
      getRelayerAddress(),
      resolved.txHash,
      resolved.resolvedAt
    );
    actions.push({
      type: "resolved",
      marketId: market.id,
      symbol: metadata.symbol,
      startPriceUsd: metadata.startPriceUsd,
      closePriceUsd: formatPrice(closePrice),
      winningOutcome: resolved.winningOutcome,
      txHash: resolved.txHash,
    });
  }

  const refreshedMarkets = actions.some((action) => action.type === "resolved")
    ? await listMarkets({ limit: 500 })
    : markets;

  for (const symbol of symbols) {
    if (actions.length >= maxActions) break;
    const hasLiveMarket = refreshedMarkets.some((market) => {
      const metadata = readOperatorMetadata(market);
      return (
        metadata?.symbol === symbol &&
        market.status !== "resolved" &&
        new Date(market.closesAt).getTime() > now.getTime()
      );
    });
    if (hasLiveMarket) continue;

    const startPrice = await fetchUsdPrice(symbol);
    const startPriceAt = now.toISOString();
    const closesAt = new Date(now.getTime() + durationMinutes * 60_000);
    const metadata: OperatorMetadata = {
      kind: OPERATOR_KIND,
      symbol,
      pair: `${symbol}-USD`,
      startPriceUsd: formatPrice(startPrice),
      startPriceAt,
      durationMinutes,
      priceSource: priceSourceName(symbol),
    };
    const marketId = randomUUID();
    const deployed = await createMarket({
      marketId,
      closesAt,
      metadataUri: encodeMetadataUri(metadata),
    });
    const market = await insertMarket({
      id: marketId,
      onchainAddress: deployed.marketAddress,
      question: `${symbol} 30m: will ${symbol}/USD be up at close?`,
      description:
        `Automated MVP 30-minute market. YES resolves if ${symbol}/USD is higher ` +
        `than ${metadata.startPriceUsd} at close; NO resolves if lower or equal. ` +
        `Price source: ${metadata.priceSource}. Start: ${metadata.startPriceAt}.`,
      category: "Crypto",
      closesAt: closesAt.toISOString(),
      metadataUri: encodeMetadataUri(metadata),
    });
    actions.push({
      type: "created",
      marketId: market.id,
      symbol,
      startPriceUsd: metadata.startPriceUsd,
      closesAt: market.closesAt,
      txHash: deployed.txHash,
    });
  }

  if (!actions.length) {
    actions.push({ type: "noop", reason: "BTC/ETH markets already live; none due for resolution." });
  }

  return {
    checkedAt: now.toISOString(),
    actions,
  };
}

function readOperatorMetadata(market: Market): OperatorMetadata | undefined {
  const raw = market.metadataUri;
  if (!raw?.startsWith("data:application/json;base64,")) return undefined;
  try {
    const json = Buffer.from(raw.slice("data:application/json;base64,".length), "base64").toString("utf8");
    const parsed = JSON.parse(json) as Partial<OperatorMetadata>;
    if (
      parsed.kind !== OPERATOR_KIND ||
      typeof parsed.symbol !== "string" ||
      typeof parsed.startPriceUsd !== "string" ||
      typeof parsed.priceSource !== "string"
    ) {
      return undefined;
    }
    return parsed as OperatorMetadata;
  } catch {
    return undefined;
  }
}

function encodeMetadataUri(metadata: OperatorMetadata): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;
}

async function fetchUsdPrice(symbol: string): Promise<number> {
  const url =
    process.env[`MARKETS_OPERATOR_${symbol}_PRICE_URL`]?.trim() ??
    `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new HttpError(502, `Price source failed for ${symbol}: HTTP ${response.status}`);
  }
  const body = (await response.json()) as unknown;
  const amount = readAmount(body);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(502, `Price source returned invalid ${symbol} price`);
  }
  return amount;
}

function readAmount(body: unknown): number {
  if (body && typeof body === "object") {
    const data = "data" in body ? (body as { data?: unknown }).data : undefined;
    if (data && typeof data === "object" && "amount" in data) {
      return Number((data as { amount?: unknown }).amount);
    }
    if ("price" in body) {
      return Number((body as { price?: unknown }).price);
    }
  }
  return NaN;
}

function readSymbols(): string[] {
  const raw = process.env.MARKETS_OPERATOR_SYMBOLS?.trim();
  if (!raw) return [...DEFAULT_SYMBOLS];
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return symbols.length ? symbols : [...DEFAULT_SYMBOLS];
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function priceSourceName(symbol: string): string {
  return process.env[`MARKETS_OPERATOR_${symbol}_PRICE_URL`]?.trim() ?? "Coinbase spot";
}

function formatPrice(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "");
}
