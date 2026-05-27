import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchLendingPoolSnapshot,
  fetchLendingTvlHistory,
  type TvlPoint,
  type TvlWindow,
} from "../../lib/lending/api";
import { USDC_DECIMALS } from "../../lib/lending/types";

/**
 * TvlChart — Total Value Locked over time for the lending pool.
 *
 * Loads `/api/lending-tvl-history` for the selected window. TVL = cash +
 * total borrows, both in USDC at 6 decimals. The chart re-fetches on window
 * change and polls every 60s for fresh tail data.
 *
 * Monochrome — area filled with a black-on-white (or white-on-black) gradient,
 * ink-colored stroke, no chromatic accents.
 */

const WINDOWS: Array<{ key: TvlWindow; label: string }> = [
  { key: "1d", label: "1D" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "all", label: "ALL" },
];

function toUsd(usdc6: bigint): number {
  return Number(usdc6) / 10 ** USDC_DECIMALS;
}

function compactUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function formatTick(timestamp: number, window: TvlWindow): string {
  const d = new Date(timestamp);
  if (window === "1d") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function TvlChart() {
  const [window, setWindow] = useState<TvlWindow>("7d");
  const [points, setPoints] = useState<TvlPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    async function load() {
      try {
        // History first; if it comes back empty (snapshot table just primed,
        // or the indexer hasn't backfilled yet) fall through to the live pool
        // snapshot so the chart never shows an unhelpful empty state.
        const pts = await fetchLendingTvlHistory(window);
        if (cancelled) return;
        if (pts.length === 0) {
          const snap = await fetchLendingPoolSnapshot();
          if (cancelled) return;
          if (snap) {
            const tvl = snap.cashUsdc + snap.totalBorrowsUsdc;
            const observedMs = new Date(snap.observedAt).getTime();
            // Two identical points so recharts has a domain — chart renders
            // as a flat line at the current TVL until history accumulates.
            setPoints([
              { t: new Date(observedMs - 60_000).toISOString(), tvl },
              { t: new Date(observedMs).toISOString(), tvl },
            ]);
          } else {
            setPoints([]);
          }
        } else {
          setPoints(pts);
        }
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [window]);

  const data = useMemo(() => {
    if (!points) return [];
    return points.map((p) => ({
      t: new Date(p.t).getTime(),
      tvl: toUsd(p.tvl),
    }));
  }, [points]);

  const latest = data.length > 0 ? data[data.length - 1].tvl : null;
  const first = data.length > 0 ? data[0].tvl : null;
  const delta = latest !== null && first !== null ? latest - first : null;
  const deltaPct = delta !== null && first && first !== 0 ? (delta / first) * 100 : null;

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5">
      {/* Header — TVL headline + delta + window pills */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Total value locked
          </p>
          <div className="flex items-baseline gap-3">
            <span className="text-[24px] font-semibold tabular-nums tracking-tight text-[var(--ink)]">
              {latest !== null ? compactUsd(latest) : "—"}
            </span>
            {delta !== null && deltaPct !== null && (
              <span className="text-[12px] font-medium tabular-nums text-[var(--muted)]">
                {delta >= 0 ? "+" : ""}
                {compactUsd(delta)}
                <span className="ml-1.5 text-[var(--ink-soft)]">
                  ({deltaPct >= 0 ? "+" : ""}
                  {deltaPct.toFixed(2)}%)
                </span>
                <span className="ml-1.5 uppercase tracking-wider text-[var(--muted-soft)]">
                  · {window}
                </span>
              </span>
            )}
          </div>
        </div>

        <div aria-label="TVL window" className="flex gap-0">
          {WINDOWS.map((w, idx) => {
            const active = w.key === window;
            return (
              <button
                key={w.key}
                aria-pressed={active}
                type="button"
                onClick={() => setWindow(w.key)}
                className={
                  "min-w-[36px] border px-3 py-1 text-[11px] font-semibold uppercase tabular-nums tracking-wider transition-colors " +
                  (active
                    ? "z-10 border-[var(--ink)] bg-[var(--ink)] text-[color:var(--primary-text)]"
                    : "border-[var(--line)] bg-transparent text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]") +
                  (idx === 0 ? " rounded-l-md" : "") +
                  (idx === WINDOWS.length - 1 ? " rounded-r-md" : "") +
                  (idx > 0 ? " -ml-px" : "")
                }
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div className="h-[220px] w-full md:h-[260px]">
        {loading && !points ? (
          <div className="flex h-full items-center justify-center text-[12px] text-[var(--muted)]">
            Loading TVL history…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-[12px] text-[var(--muted)]">
            TVL history unavailable: {error}
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-[var(--line)] text-[12px] text-[var(--muted)]">
            TVL data is unavailable right now.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="tvlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ink)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--ink)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line-soft)" strokeDasharray="3 4" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                stroke="var(--muted)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatTick(v, window)}
                minTickGap={48}
              />
              <YAxis
                stroke="var(--muted)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={compactUsd}
                width={56}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "var(--ink)",
                  padding: "8px 10px",
                }}
                labelStyle={{ color: "var(--muted)", marginBottom: 4 }}
                labelFormatter={(v) =>
                  new Date(Number(v)).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                formatter={(v) => [compactUsd(Number(v ?? 0)), "TVL"]}
              />
              <Area
                type="monotone"
                dataKey="tvl"
                stroke="var(--ink)"
                strokeWidth={1.5}
                fill="url(#tvlFill)"
                dot={false}
                activeDot={{ r: 3, fill: "var(--ink)", stroke: "var(--paper)", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <p className="mt-3 text-[11px] text-[var(--muted-soft)]">
        TVL = USDC available to borrow + USDC currently borrowed. Snapshots indexed every 5 minutes.
      </p>
    </div>
  );
}
