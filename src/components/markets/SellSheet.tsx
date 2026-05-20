import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import {
  fetchMarketDetail,
  indexFillsTx,
  MarketsApiError,
  type RawOpenOrder
} from "../../lib/markets/api";
import { deriveTakerLimitPrice, planTakerFills, takeOrder } from "../../lib/markets/onchain";
import { microsToUsdcString, type Outcome } from "../../lib/markets/types";

const PRICE_SCALE = 1_000_000n;
/** 5% downward slippage tolerance for market sells — matches TradePanel. */
const SELL_SLIPPAGE_BPS = 500n;

type Props = {
  marketId: string;
  marketAddress: Address;
  outcome: Outcome;
  sharesOwnedMicros: number;
  /** Called after a successful fill so the parent can refresh positions. */
  onSold?: () => void;
  /** Called when the user dismisses the sheet. */
  onClose: () => void;
};

type SubmitState =
  | { kind: "idle" }
  | { kind: "loadingBook" }
  | { kind: "filling" }
  | { kind: "indexing" }
  | { kind: "filled"; txHash: string; sizeMicros: number; totalMicros: number }
  | { kind: "error"; message: string };

/**
 * Inline sell sheet expanded from a PositionCard. Walks the live orderbook
 * and submits a single `Exchange.fillOrders` against the best bids. Limit
 * sells aren't exposed here — power users can still post a signed SELL
 * order via the market-detail page if/when we re-add that surface, but for
 * the default "I want to exit my position" flow, market-only is enough.
 *
 * Pricing display matches TradePanel's economics box (Total / If wins /
 * Potential profit) but inverts the framing: "If wins" becomes "If holding"
 * (what you'd have collected by waiting to redeem instead of selling now),
 * and the diff is the user's opportunity cost vs. holding.
 */
export default function SellSheet({
  marketId,
  marketAddress,
  outcome,
  sharesOwnedMicros,
  onSold,
  onClose
}: Props) {
  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();
  const maxShares = sharesOwnedMicros;
  const [sizeStr, setSizeStr] = useState<string>(() =>
    (maxShares / 1_000_000).toFixed(2)
  );
  const [rawOrders, setRawOrders] = useState<RawOpenOrder[]>([]);
  const [submit, setSubmit] = useState<SubmitState>({ kind: "loadingBook" });

  // Fetch the orderbook on mount. Without it we can't plan the sweep, so we
  // gate the Sell button on this load completing.
  useEffect(() => {
    let cancelled = false;
    fetchMarketDetail(marketId)
      .then(({ rawOrders }) => {
        if (cancelled) return;
        setRawOrders(rawOrders);
        setSubmit({ kind: "idle" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof MarketsApiError
            ? `Failed to load orderbook (${err.status}): ${err.message}`
            : err instanceof Error
              ? err.message
              : "Unknown error";
        setSubmit({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [marketId]);

  const sizeMicros = useMemo(() => parseUsdToMicros(sizeStr), [sizeStr]);
  const sizeOk =
    sizeMicros !== undefined &&
    sizeMicros > 0 &&
    sizeMicros <= maxShares;

  // Plan the sweep against current bids so we can preview the proceeds.
  const plan = useMemo(() => {
    if (!sizeOk || !account || rawOrders.length === 0) return undefined;
    const limit = deriveTakerLimitPrice({
      rawOrders,
      takerAddress: account,
      outcome,
      intent: "SELL",
      slippageBps: SELL_SLIPPAGE_BPS
    });
    return planTakerFills({
      rawOrders,
      takerAddress: account,
      outcome,
      intent: "SELL",
      sizeMicros: BigInt(sizeMicros!),
      limitPriceMicros: limit
    });
  }, [sizeOk, sizeMicros, account, rawOrders, outcome]);

  const hasLiquidity = (plan?.length ?? 0) > 0;
  const sweptSize = plan?.reduce((acc, p) => acc + p.fillSize, 0n) ?? 0n;
  const proceedsMicros = plan?.reduce(
    (acc, p) => acc + (BigInt(p.order.price) * p.fillSize) / PRICE_SCALE,
    0n
  ) ?? 0n;
  // If you waited until resolution and won, every share is worth $1. If
  // you waited and lost, every share is worth $0. Showing "If wins" gives
  // the user the upper-bound opportunity cost of selling now.
  const heldIfWinsMicros = sweptSize; // 1 share = $1 = 1e6 micros
  const diffMicros = Number(proceedsMicros) - Number(heldIfWinsMicros);

  const submitting = submit.kind === "filling" || submit.kind === "indexing";
  const canSubmit = sizeOk && hasLiquidity && !submitting && account !== undefined;

  async function handleSell() {
    if (!canSubmit || !account) return;
    setSubmit({ kind: "filling" });

    try {
      const provider = await wallet.getEthereumProvider();
      if (!provider) {
        throw new Error("Wallet provider not available. Reconnect and try again.");
      }

      // Re-fetch a fresh orderbook to avoid filling against stale/expired
      // orders that would cause on-chain reverts.
      let freshOrders: RawOpenOrder[];
      try {
        const detail = await fetchMarketDetail(marketId);
        freshOrders = detail.rawOrders;
      } catch {
        freshOrders = rawOrders;
      }

      const limit = deriveTakerLimitPrice({
        rawOrders: freshOrders,
        takerAddress: account,
        outcome,
        intent: "SELL",
        slippageBps: SELL_SLIPPAGE_BPS
      });

      const result = await takeOrder(provider, {
        taker: account,
        market: marketAddress,
        outcome,
        intent: "SELL",
        sizeMicros: BigInt(sizeMicros!),
        limitPriceMicros: limit,
        rawOrders: freshOrders
      });

      setSubmit({ kind: "indexing" });
      try {
        await indexFillsTx(result.txHash);
      } catch {
        // Indexer failures are non-fatal — the on-chain tx is the source of
        // truth. The realtime channel + cron will pick it up later.
      }

      setSubmit({
        kind: "filled",
        txHash: result.txHash,
        sizeMicros: Number(result.filledSizeMicros),
        totalMicros: Number(result.totalUsdcMicros)
      });
      onSold?.();
    } catch (err) {
      const raw =
        err instanceof MarketsApiError
          ? `Sell failed (${err.status}): ${err.message}`
          : err instanceof Error
            ? err.message
            : "Sell failed";
      const message = raw.includes("Retry with a fresh orderbook")
        ? "Some orders expired before your sell was mined. Try again."
        : raw;
      setSubmit({ kind: "error", message });
    }
  }

  return (
    <div className="mt-3 rounded-md border border-[var(--line)] bg-[var(--input-bg)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
          Sell {outcome} at market
        </p>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] hover:text-[var(--ink)]"
        >
          Close
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-baseline justify-between">
          <label className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Size
          </label>
          <button
            type="button"
            onClick={() => setSizeStr((maxShares / 1_000_000).toString())}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Max {microsToUsdcString(maxShares)}
          </button>
        </div>
        <div
          className={cn(
            "flex items-center rounded-md border bg-[var(--paper)] px-3 py-2",
            sizeStr !== "" && !sizeOk
              ? "border-[var(--red-text)]"
              : "border-[var(--line)] focus-within:border-[var(--ink)]"
          )}
        >
          <input
            type="text"
            inputMode="decimal"
            value={sizeStr}
            onChange={(e) => setSizeStr(e.target.value)}
            className="flex-1 bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
            placeholder="0.00"
          />
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {outcome}
          </span>
        </div>
      </div>

      <div className="space-y-1 rounded-md border border-[var(--line-soft)] bg-[var(--paper)] px-3 py-2.5">
        <Line label="You receive" value={`$${microsToUsdcString(Number(proceedsMicros))}`} />
        <Line
          label={`If ${outcome} wins (held to resolve)`}
          value={`$${microsToUsdcString(Number(heldIfWinsMicros))}`}
        />
        <Line
          label="Vs. holding"
          value={`${diffMicros >= 0 ? "+" : ""}$${microsToUsdcString(diffMicros)}`}
          accent={diffMicros >= 0 ? "green" : "red"}
        />
      </div>

      <button
        type="button"
        onClick={handleSell}
        disabled={!canSubmit}
        className={cn(
          "mt-3 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors",
          canSubmit
            ? "bg-[var(--ink)] text-[var(--canvas)] hover:opacity-90"
            : "cursor-not-allowed bg-[var(--line-soft)] text-[var(--muted)]"
        )}
      >
        {submit.kind === "loadingBook" ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading book…
          </>
        ) : submit.kind === "filling" ? (
          "Filling on-chain…"
        ) : submit.kind === "indexing" ? (
          "Indexing…"
        ) : (
          `Sell ${outcome}`
        )}
      </button>

      {sizeOk && !hasLiquidity && submit.kind === "idle" && (
        <p className="mt-3 rounded-md border border-[var(--yellow-text)]/40 bg-[var(--yellow-text)]/5 px-2 py-1.5 text-[11px] text-[var(--yellow-text)]">
          No matching bids on {outcome} at the current slippage. Try a smaller
          size or wait for a maker to post bids.
        </p>
      )}
      {submit.kind === "filled" && (
        <p className="mt-3 break-all font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--green-text)]">
          Sold · {microsToUsdcString(submit.sizeMicros)} {outcome} for $
          {microsToUsdcString(submit.totalMicros)} · {submit.txHash.slice(0, 10)}…
        </p>
      )}
      {submit.kind === "error" && (
        <p className="mt-3 rounded-md border border-[var(--red-text)]/40 bg-[var(--red-text)]/5 px-2 py-1.5 text-[11px] text-[var(--red-text)]">
          {submit.message}
        </p>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: "green" | "red";
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[12px] font-medium",
          accent === "green" && "text-[var(--green-text)]",
          accent === "red" && "text-[var(--red-text)]",
          !accent && "text-[var(--ink)]"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function parseUsdToMicros(str: string): number | undefined {
  if (!str.trim()) return undefined;
  const n = Number(str);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const micros = Math.round(n * Number(PRICE_SCALE));
  return Number.isSafeInteger(micros) ? micros : undefined;
}
