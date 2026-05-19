import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, History, LayoutGrid, LogOut, Wallet } from "lucide-react";
import { cn } from "./lib/utils";
import { useDisburseDynamicWallet } from "./lib/dynamic";
import { getInitialTheme } from "./lib/theme";
import {
  MARKETS_PATH,
  MARKET_HISTORY_PATH,
  MARKET_POSITIONS_PATH,
  getAppHref,
  getCurrentRouteKey,
  getDocsHref,
  getInitialPage,
  getInternalTargetPath,
  getMarketIdFromPath,
  type NavigateHandler,
  type Page
} from "./lib/routing";
import MarketsListPage from "./pages/markets/MarketsListPage";
import MarketDetailPage from "./pages/markets/MarketDetailPage";
import MyPositionsPage from "./pages/markets/MyPositionsPage";
import HistoryPage from "./pages/markets/HistoryPage";

type NavItem = {
  page: Page;
  label: string;
  href: string;
  icon: typeof LayoutGrid;
};

const NAV_ITEMS: NavItem[] = [
  { page: "markets",           label: "Markets",   href: MARKETS_PATH,           icon: LayoutGrid },
  { page: "market-positions",  label: "Positions", href: MARKET_POSITIONS_PATH,  icon: BarChart3 },
  { page: "market-history",    label: "History",   href: MARKET_HISTORY_PATH,    icon: History }
];

export default function BetApp() {
  const [page, setPage] = useState<Page>(() => getInitialPage());
  const [marketId, setMarketId] = useState<string | undefined>(() => getMarketIdFromPath());
  const [, setRouteKey] = useState<string>(() => getCurrentRouteKey());

  // Apply persisted theme on mount. The bet shell does not have its own
  // toggle yet — it inherits whatever the user last selected in the app.
  useEffect(() => {
    getInitialTheme();
  }, []);

  useEffect(() => {
    const onPop = () => {
      setPage(getInitialPage());
      setMarketId(getMarketIdFromPath());
      setRouteKey(getCurrentRouteKey());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const onNavigate: NavigateHandler = useCallback((event: MouseEvent<HTMLAnchorElement>, target: string) => {
    const internal = getInternalTargetPath(target);
    // External or cross-subdomain links fall through to default browser nav.
    if (!internal) return;

    event.preventDefault();
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current !== internal) {
      window.history.pushState(null, "", internal);
    }
    setPage(getInitialPage());
    setMarketId(getMarketIdFromPath());
    setRouteKey(getCurrentRouteKey());
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <BetHeader page={page} onNavigate={onNavigate} />
      <div className="mx-auto flex max-w-[1400px] gap-8 px-6 pt-6 md:px-10">
        <BetSidebar page={page} onNavigate={onNavigate} />
        <main className="min-w-0 flex-1 pt-2">
          {page === "markets" && <MarketsListPage onNavigate={onNavigate} />}
          {page === "market-detail" && <MarketDetailPage marketId={marketId} onNavigate={onNavigate} />}
          {page === "market-positions" && <MyPositionsPage onNavigate={onNavigate} />}
          {page === "market-history" && <HistoryPage onNavigate={onNavigate} />}
        </main>
      </div>
    </div>
  );
}

function BetHeader({ page: _page, onNavigate }: { page: Page; onNavigate: NavigateHandler }) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--canvas)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-6 py-4 md:px-10">
        <div className="flex items-center gap-3">
          <a
            href={MARKETS_PATH}
            onClick={(e) => onNavigate(e, MARKETS_PATH)}
            className="font-mono text-[13px] font-semibold tracking-tight text-[var(--ink)]"
          >
            Disburse
          </a>
          <span className="rounded-sm border border-[var(--line)] px-1.5 py-[2px] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
            Bet
          </span>
        </div>

        <nav className="flex items-center gap-5 text-[13px] text-[var(--muted)]">
          <a
            href={getAppHref("/")}
            className="transition-colors hover:text-[var(--ink)]"
          >
            App
          </a>
          <a
            href={getDocsHref()}
            className="transition-colors hover:text-[var(--ink)]"
          >
            Docs
          </a>
          <BetWalletButton />
        </nav>
      </div>
    </header>
  );
}

function BetWalletButton() {
  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();
  const short = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close the disconnect menu when the user clicks elsewhere. Without this,
  // it stays open as a floating chip and traps further wallet clicks.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: globalThis.MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  if (!short) {
    return (
      <button
        type="button"
        onClick={() => wallet.openAuthFlow?.()}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--ink)] bg-[var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--canvas)] transition-colors hover:opacity-90"
      >
        <Wallet className="h-3.5 w-3.5" />
        Connect
      </button>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)] transition-colors hover:border-[var(--ink)]"
      >
        <Wallet className="h-3.5 w-3.5" />
        {short}
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[180px] overflow-hidden rounded-md border border-[var(--line)] bg-[var(--canvas)] shadow-md">
          <button
            type="button"
            onClick={async () => {
              setMenuOpen(false);
              await wallet.disconnect?.();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]",
              "transition-colors hover:bg-[var(--input-bg)]"
            )}
          >
            <LogOut className="h-3.5 w-3.5" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function BetSidebar({ page, onNavigate }: { page: Page; onNavigate: NavigateHandler }) {
  return (
    <aside className="hidden w-[180px] shrink-0 lg:block">
      <nav className="sticky top-24 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = page === item.page;
          const Icon = item.icon;
          return (
            <a
              key={item.page}
              href={item.href}
              onClick={(e) => onNavigate(e, item.href)}
              className={cn(
                "relative flex items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2 text-[13px] transition-colors",
                active
                  ? "text-[var(--ink)]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full transition-all",
                  active ? "bg-[var(--primary-bg)]" : "bg-transparent"
                )}
              />
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
