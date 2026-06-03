import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUpDown, Search, SearchX } from "lucide-react";
import { cn } from "../../lib/utils";
import { fetchMarkets, MarketsApiError } from "../../lib/markets/api";
import {
  microsToUsdcCompact,
  type Market,
  type MarketStatus
} from "../../lib/markets/types";
import type { NavigateHandler } from "../../lib/routing";
import MarketCard from "../../components/markets/MarketCard";
import AnimatedNumber from "../../components/ui/AnimatedNumber";

type Props = {
  onNavigate: NavigateHandler;
};

type StatusFilter = "open" | "resolved";

type SortKey = "trending" | "closing" | "newest";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "closing", label: "Closing soon" },
  { key: "newest", label: "Newest" }
];

export default function MarketsListPage({ onNavigate }: Props) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | undefined>();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [category, setCategory] = useState<string>("All");
  const [query, setQuery] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("trending");

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

  // Sort runs after filtering so the chosen order applies to whatever the
  // status/category/search filters leave behind. "Trending" (volume desc) is
  // the default because it surfaces the most active markets first.
  const sortedMarkets = useMemo(() => {
    const next = [...filteredMarkets];
    next.sort((a, b) => {
      switch (sort) {
        case "closing":
          return new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime();
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "trending":
        default:
          return b.volumeMicros - a.volumeMicros;
      }
    });
    return next;
  }, [filteredMarkets, sort]);

  const totalOpenVol = useMemo(
    () => markets.filter((m) => m.status === "open").reduce((acc, m) => acc + m.volumeMicros, 0),
    [markets]
  );
  const openCount = useMemo(() => markets.filter((m) => m.status === "open").length, [markets]);

  return (
    <div className="mx-auto max-w-[1180px] pb-16">
      {/* Hero */}
      <section className="border-b border-[var(--line)] pb-10">
        <p className="mb-4 text-[12px] font-medium text-[var(--muted)]">
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
          <Stat label="Markets" value={loadState === "ready" ? <AnimatedNumber value={openCount} /> : "—"} />
          <Stat
            label="Open volume"
            value={
              loadState === "ready" ? (
                <AnimatedNumber value={totalOpenVol} format={(n) => `$${microsToUsdcCompact(n)}`} />
              ) : (
                "—"
              )
            }
          />
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
                "rounded px-3 py-1 text-[12px] font-medium transition-colors",
                statusFilter === s
                  ? "bg-[var(--ink)] text-[color:var(--canvas)]"
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

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort markets"
              className="cursor-pointer appearance-none rounded-md border border-[var(--line)] bg-[var(--paper)] py-1.5 pl-9 pr-7 text-[12px] text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className="pointer-events-none absolute right-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-[var(--muted)]"
            >
              <path
                d="M2.5 4.5 6 8l3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="relative w-full max-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets…"
              className="w-full rounded-md border border-[var(--line)] bg-[var(--paper)] py-1.5 pl-9 pr-3 text-[12px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--ink)] focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="mt-6">
        {loadState === "loading" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <MarketCardSkeleton key={i} />
            ))}
            <span className="sr-only">Loading markets…</span>
          </div>
        )}
        {loadState === "error" && (
          <p className="rounded-lg border border-dashed border-[var(--red-text)]/40 bg-[var(--red-text)]/5 p-10 text-center text-[13px] text-[var(--red-text)]">
            {errorMsg}
          </p>
        )}
        {loadState === "ready" && (
          <p className="mb-4 text-[12px] text-[var(--muted)]">
            {sortedMarkets.length} {sortedMarkets.length === 1 ? "market" : "markets"}
          </p>
        )}
        {loadState === "ready" && sortedMarkets.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--line)] p-12 text-center">
            <SearchX className="h-6 w-6 text-[var(--muted)]" />
            <p className="text-[13px] text-[var(--muted)]">No markets match these filters.</p>
            {(query.trim() || category !== "All") && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory("All");
                }}
                className="text-[12px] font-medium text-[var(--ink)] underline-offset-4 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
        {loadState === "ready" && sortedMarkets.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortedMarkets.map((m) => (
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

// Loading placeholder that mirrors MarketCard's structure so the grid keeps
// its rhythm while markets load — no layout shift when real cards arrive.
function MarketCardSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="flex items-center justify-between">
        <div className="h-3 w-16 rounded bg-[var(--line-soft)]" />
        <div className="h-3 w-12 rounded bg-[var(--line-soft)]" />
      </div>
      <div className="space-y-2">
        <div className="h-3.5 w-full rounded bg-[var(--line-soft)]" />
        <div className="h-3.5 w-2/3 rounded bg-[var(--line-soft)]" />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="h-3 w-16 rounded bg-[var(--line-soft)]" />
          <div className="h-3 w-16 rounded bg-[var(--line-soft)]" />
        </div>
        <div className="h-1.5 w-full rounded-full bg-[var(--line-soft)]" />
      </div>
      <div className="flex items-center justify-between border-t border-[var(--line-soft)] pt-3">
        <div className="h-3 w-20 rounded bg-[var(--line-soft)]" />
        <div className="h-3 w-14 rounded bg-[var(--line-soft)]" />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[11.5px] font-medium text-[var(--muted)]">
        {label}
      </dt>
      <dd className="truncate text-[13px] font-medium text-[var(--ink)]">{value}</dd>
    </div>
  );
}

// Re-export the Market type signature used by the page (helper for downstream).
export type { Market };
