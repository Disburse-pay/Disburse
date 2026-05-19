import { useMemo } from "react";
import { cn } from "../../lib/utils";
import {
  microsToShares,
  microsToUsdcString,
  type Orderbook,
  type Outcome
} from "../../lib/markets/types";

type Props = {
  orderbook: Orderbook;
  outcome: Outcome;
  onOutcomeChange: (next: Outcome) => void;
};

const VISIBLE_LEVELS = 6;

export default function OrderbookDepth({ orderbook, outcome, onOutcomeChange }: Props) {
  const { bids, asks } = orderbook;

  // Cumulative size for the depth bars — biggest cumulative size at the
  // shallowest level for that side anchors the bar width.
  const { bidRows, askRows, maxCum } = useMemo(() => {
    let bidCum = 0;
    const bidRows = bids.slice(0, VISIBLE_LEVELS).map((b) => {
      bidCum += b.sizeMicros;
      return { ...b, cum: bidCum };
    });
    let askCum = 0;
    const askRows = asks.slice(0, VISIBLE_LEVELS).map((a) => {
      askCum += a.sizeMicros;
      return { ...a, cum: askCum };
    });
    const max = Math.max(bidCum, askCum, 1);
    return { bidRows, askRows, maxCum: max };
  }, [bids, asks]);

  const bestBid = bids[0]?.priceMicros;
  const bestAsk = asks[0]?.priceMicros;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : undefined;

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
          Orderbook
        </p>
        <div className="inline-flex rounded-md border border-[var(--line)] p-0.5">
          {(["YES", "NO"] as Outcome[]).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onOutcomeChange(o)}
              className={cn(
                "rounded px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
                outcome === o
                  ? o === "YES"
                    ? "bg-[var(--green-text)]/15 text-[var(--green-text)]"
                    : "bg-[var(--red-text)]/15 text-[var(--red-text)]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              )}
            >
              {o}
            </button>
          ))}
        </div>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-3 gap-2 border-b border-[var(--line-soft)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted-soft)]">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (descending top→down so best ask sits closest to the spread) */}
      <div className="px-2 py-2">
        {askRows.slice().reverse().map((row) => (
          <DepthRow
            key={`ask-${row.priceMicros}`}
            priceMicros={row.priceMicros}
            sizeMicros={row.sizeMicros}
            cumMicros={row.cum}
            maxCumMicros={maxCum}
            side="ask"
          />
        ))}
      </div>

      {/* Spread */}
      <div className="flex items-center justify-between border-y border-[var(--line-soft)] bg-[var(--input-bg)] px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
          Spread
        </span>
        <span className="font-mono text-[11px] text-[var(--ink)]">
          {spread !== undefined ? `$${microsToUsdcString(spread)}` : "—"}
        </span>
      </div>

      {/* Bids */}
      <div className="px-2 py-2">
        {bidRows.map((row) => (
          <DepthRow
            key={`bid-${row.priceMicros}`}
            priceMicros={row.priceMicros}
            sizeMicros={row.sizeMicros}
            cumMicros={row.cum}
            maxCumMicros={maxCum}
            side="bid"
          />
        ))}
      </div>
    </div>
  );
}

function DepthRow({
  priceMicros,
  sizeMicros,
  cumMicros,
  maxCumMicros,
  side
}: {
  priceMicros: number;
  sizeMicros: number;
  cumMicros: number;
  maxCumMicros: number;
  side: "bid" | "ask";
}) {
  const pct = Math.min(100, (cumMicros / maxCumMicros) * 100);
  return (
    <div className="relative grid grid-cols-3 gap-2 px-2 py-1 font-mono text-[11px]">
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0",
          side === "bid"
            ? "right-0 bg-[var(--green-text)]/8"
            : "right-0 bg-[var(--red-text)]/8"
        )}
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      />
      <span
        className={cn(
          "relative",
          side === "bid" ? "text-[var(--green-text)]" : "text-[var(--red-text)]"
        )}
      >
        ${microsToUsdcString(priceMicros)}
      </span>
      <span className="relative text-right text-[var(--ink)]">{microsToShares(sizeMicros)}</span>
      <span className="relative text-right text-[var(--muted)]">{microsToShares(cumMicros)}</span>
    </div>
  );
}
