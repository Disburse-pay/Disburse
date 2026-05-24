/**
 * Browser-side wrappers around the /api/lending-* handlers.
 * Wire shapes use decimal strings; we convert to bigint at the boundary.
 */
import type {
  LendingEvent,
  LendingPoolSnapshot,
  LendingPosition,
} from "./types";

export class LendingApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "LendingApiError";
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    throw new LendingApiError(res.status, `${path} returned ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

function bn(v: string | null | undefined): bigint | null {
  return v ? BigInt(v) : null;
}

export async function fetchLendingPoolSnapshot(): Promise<LendingPoolSnapshot | null> {
  type Wire = {
    snapshot: null | {
      blockNumber: string;
      observedAt: string;
      cashUsdc: string;
      totalBorrowsUsdc: string;
      totalReservesUsdc: string;
      supplyIndex: string;
      borrowIndex: string;
      utilizationWad: string;
      borrowAprWad: string;
      supplyAprWad: string;
      btcPriceWad: string | null;
    };
  };
  const { snapshot } = await fetchJson<Wire>("/api/lending-pool-state");
  if (!snapshot) return null;
  return {
    blockNumber: BigInt(snapshot.blockNumber),
    observedAt: snapshot.observedAt,
    cashUsdc: BigInt(snapshot.cashUsdc),
    totalBorrowsUsdc: BigInt(snapshot.totalBorrowsUsdc),
    totalReservesUsdc: BigInt(snapshot.totalReservesUsdc),
    supplyIndex: BigInt(snapshot.supplyIndex),
    borrowIndex: BigInt(snapshot.borrowIndex),
    utilizationWad: BigInt(snapshot.utilizationWad),
    borrowAprWad: BigInt(snapshot.borrowAprWad),
    supplyAprWad: BigInt(snapshot.supplyAprWad),
    btcPriceWad: bn(snapshot.btcPriceWad),
  };
}

export async function fetchLendingPosition(address: string): Promise<LendingPosition | null> {
  type Wire = {
    position: null | {
      userAddress: string;
      collateralAmount: string;
      scaledBorrow: string;
      cachedDebtUsdc: string;
      cachedCollateralUsdc: string;
      cachedHealthFactor: string | null;
      isLiquidatable: boolean;
      lastUpdatedBlock: string | null;
      lastUpdatedAt: string;
    };
  };
  const { position } = await fetchJson<Wire>(
    `/api/lending-position?address=${encodeURIComponent(address)}`
  );
  if (!position) return null;
  return {
    userAddress: position.userAddress as `0x${string}`,
    collateralAmount: BigInt(position.collateralAmount),
    scaledBorrow: BigInt(position.scaledBorrow),
    cachedDebtUsdc: BigInt(position.cachedDebtUsdc),
    cachedCollateralUsdc: BigInt(position.cachedCollateralUsdc),
    cachedHealthFactor: bn(position.cachedHealthFactor),
    isLiquidatable: position.isLiquidatable,
    lastUpdatedBlock: bn(position.lastUpdatedBlock),
    lastUpdatedAt: position.lastUpdatedAt,
  };
}

export async function fetchLendingHistory(
  opts: { address?: string; limit?: number } = {}
): Promise<LendingEvent[]> {
  type Wire = {
    events: Array<{
      txHash: string;
      logIndex: number;
      blockNumber: string;
      blockTime: string;
      eventType: string;
      userAddress: string | null;
      relatedAddress: string | null;
      amountA: string | null;
      amountB: string | null;
      amountC: string | null;
    }>;
  };
  const params = new URLSearchParams();
  if (opts.address) params.set("address", opts.address);
  if (opts.limit) params.set("limit", String(opts.limit));
  const { events } = await fetchJson<Wire>(
    `/api/lending-history${params.toString() ? `?${params.toString()}` : ""}`
  );
  return events.map((e) => ({
    txHash: e.txHash as `0x${string}`,
    logIndex: e.logIndex,
    blockNumber: BigInt(e.blockNumber),
    blockTime: e.blockTime,
    eventType: e.eventType,
    userAddress: (e.userAddress as `0x${string}` | null) ?? null,
    relatedAddress: (e.relatedAddress as `0x${string}` | null) ?? null,
    amountA: bn(e.amountA),
    amountB: bn(e.amountB),
    amountC: bn(e.amountC),
  }));
}
