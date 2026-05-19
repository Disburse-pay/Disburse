import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "../../lib/utils";
import { fetchMarkets, MarketsApiError } from "../../lib/markets/api";
import {
  microsToUsdcCompact,
  type Market,
  type MarketStatus
} from "../../lib/markets/types";
import type { NavigateHandler } from "../../lib/routing";
import MarketCard from "../../components/markets/MarketCard";

type Props = {
  onNavigate: NavigateHandler;
};

type StatusFilter = "open" | "resolved";

export default function MarketsListPage({ onNavigate }: Props) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | undefined>();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [category, setCategory] = useState<string>("All");
  const [query, setQuery] = useState<string>("");

  // Load markets once on mount. The list is small and changes infrequently
  // (admin-only creates) so we don't need realtime here — markets-detail
  // subscribes for orderbook activity.
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetchMarkets()
      .then((data) => {
        if (cancelled) return;
        setMarkets(data);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof MarketsApiError
            ? `Failed to load markets (${err.status}): ${err.message}`
            : err instanceof Error
              ? err.message
              : "Unknown error";
        setErrorMsg(message);
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Derive categories from loaded data so the chip list reflects reality.
  // Hard-coding would silently hide new categories created by admins.
  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const m of markets) seen.add(m.category);
    return ["All", ...Array.from(seen).sort()];
  }, [markets]);

  const filteredMarkets = useMemo(() => {
    return markets.filter((m) => {
      if (!matchesStatus(m.status, statusFilter)) return false;
      if (category !== "All" && m.category !== category) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        if (
          !m.question.toLowerCase().includes(q) &&
          !(m.description ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [markets, statusFilter, category, query]);

  const totalOpenVol = useMemo(
    () => markets.filter((m) => m.status === "open").reduce((acc, m) => acc + m.volumeMicros, 0),
    [markets]
  );
  const openCount = useMemo(() => markets.filter((m) => m.status === "open").length, [markets]);

  return (
    <div className="mx-auto max-w-[1180px] pb-16">
      {/* Hero */}
      <section className="border-b border-[var(--line)] pb-10">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
          Prediction markets
        </p>
        <h1 className="max-w-[24ch] text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-[var(--ink)]">
          Trade on outcomes. Settle in USDC. Get a signed receipt.
        </h1>
        <p className="mt-5 max-w-[66ch] text-[15px] leading-relaxed text-[var(--muted)]">
          Binary YES/NO markets settled on Arc Testnet. Every winning payout
          automatically emits a Portable Settlement Proof (PSP) — the same
          auditable, off-chain-verifiable receipt that powers Disburse payments.
        </p>

        <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--line-soft)] pt-6 sm:grid-cols-4">
          <Stat label="Markets" value={loadState === "ready" ? openCount.toString() : "—"} />
          <Stat label="Open volume" value={loadState === "ready" ? `$${microsToUsdcCompact(totalOpenVol)}` : "—"} />
          <Stat label="Resolution" value="Admin · v1" />
          <Stat label="Network" value="Arc Testnet" />
        </dl>
      </section>

      {/* Filters */}
      <section className="mt-10 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-[var(--line)] p-0.5">
          {(["open", "resolved"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
                statusFilter === s
                  ? "bg-[var(--ink)] text-[var(--canvas)]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="inline-flex flex-wrap gap-1">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-md border px-3 py-1 text-[12px] transition-colors",
                category === c
                  ? "border-[var(--ink)] text-[var(--ink)]"
                  : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="relative ml-auto w-full max-w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search markets…"
            className="w-full rounded-md border border-[var(--line)] bg-[var(--paper)] py-1.5 pl-9 pr-3 text-[12px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--ink)] focus:outline-none"
          />
        </div>
      </section>

      {/* Results */}
      <section className="mt-6">
        {loadState === "loading" && (
          <p className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[13px] text-[var(--muted)]">
            Loading markets…
          </p>
        )}
        {loadState === "error" && (
          <p className="rounded-lg border border-dashed border-[var(--red-text)]/40 bg-[var(--red-text)]/5 p-10 text-center text-[13px] text-[var(--red-text)]">
            {errorMsg}
          </p>
        )}
        {loadState === "ready" && filteredMarkets.length === 0 && (
          <p className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[13px] text-[var(--muted)]">
            No markets match these filters.
          </p>
        )}
        {loadState === "ready" && filteredMarkets.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredMarkets.map((m) => (
              <MarketCard key={m.id} market={m} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function matchesStatus(status: MarketStatus, filter: StatusFilter): boolean {
  if (filter === "open") return status === "open";
  return status === "resolved" || status === "closed";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="truncate text-[13px] font-medium text-[var(--ink)]">{value}</dd>
    </div>
  );
}

// Re-export the Market type signature used by the page (helper for downstream).
export type { Market };
