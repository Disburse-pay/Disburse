import { useEffect, useMemo, useState } from "react";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import { fetchMarkets, fetchPositions, MarketsApiError } from "../../lib/markets/api";
import { subscribeMyPositions } from "../../lib/markets/realtime";
import { microsToUsdcString, type Market, type Position } from "../../lib/markets/types";
import type { NavigateHandler } from "../../lib/routing";
import PositionCard from "../../components/markets/PositionCard";

type Props = {
  onNavigate: NavigateHandler;
};

export default function MyPositionsPage({ onNavigate }: Props) {
  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();

  const [markets, setMarkets] = useState<Market[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | undefined>();

  // Load on account change. The empty-wallet branch renders a connect prompt
  // rather than firing any requests — positions are scoped per address.
  useEffect(() => {
    if (!account) {
      setLoadState("idle");
      setPositions([]);
      setMarkets([]);
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    Promise.all([fetchPositions(account), fetchMarkets()])
      .then(([pos, mkts]) => {
        if (cancelled) return;
        setPositions(pos);
        setMarkets(mkts);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof MarketsApiError
            ? `Failed to load (${err.status}): ${err.message}`
            : err instanceof Error
              ? err.message
              : "Unknown error";
        setErrorMsg(message);
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  // Realtime: merge incoming position rows by marketId. A position is
  // identified by (user_address, market_id) so we replace in place.
  useEffect(() => {
    if (!account || loadState !== "ready") return;
    return subscribeMyPositions(account, (updated) => {
      setPositions((prev) => {
        const idx = prev.findIndex((p) => p.marketId === updated.marketId);
        if (idx === -1) return [...prev, updated];
        const next = prev.slice();
        next[idx] = updated;
        return next;
      });
    });
  }, [account, loadState]);

  const rows = useMemo(() => {
    const marketById = new Map(markets.map((m) => [m.id, m] as const));
    return positions
      .map((p) => ({ position: p, market: marketById.get(p.marketId) }))
      .filter((r): r is { position: Position; market: Market } => Boolean(r.market))
      // Hide rows where both balances are zero — common after a full claim or
      // a partial-fill round-trip that nets to nothing.
      .filter(
        ({ position }) => position.yesSharesMicros > 0 || position.noSharesMicros > 0
      );
  }, [positions, markets]);

  const totals = useMemo(() => {
    let cost = 0;
    let value = 0;
    for (const { position, market } of rows) {
      const isYes = position.yesSharesMicros > position.noSharesMicros;
      const shares = isYes ? position.yesSharesMicros : position.noSharesMicros;
      const price = isYes ? market.yesPriceMicros : market.noPriceMicros;
      cost += position.costBasisMicros;
      value += Math.floor((shares * price) / 1_000_000);
    }
    return { cost, value, pnl: value - cost };
  }, [rows]);

  return (
    <div className="mx-auto max-w-[1180px] pb-16">
      <section className="border-b border-[var(--line)] pb-10">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
          My positions
        </p>
        <h1 className="max-w-[24ch] text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-[var(--ink)]">
          Your open and resolved positions
        </h1>

        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--line-soft)] pt-6 sm:grid-cols-4">
          <Stat label="Open positions" value={rows.length.toString()} />
          <Stat label="Cost basis" value={`$${microsToUsdcString(totals.cost)}`} />
          <Stat label="Mark value" value={`$${microsToUsdcString(totals.value)}`} />
          <Stat
            label="Unrealized"
            value={`${totals.pnl >= 0 ? "+" : ""}$${microsToUsdcString(totals.pnl)}`}
            accent={totals.pnl >= 0 ? "green" : "red"}
          />
        </dl>
      </section>

      <section className="mt-8">
        {!account && (
          <div className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center">
            <p className="mb-4 text-[13px] text-[var(--muted)]">
              Connect a wallet to see your positions.
            </p>
            <button
              type="button"
              onClick={() => wallet.openAuthFlow?.()}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--ink)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--canvas)] hover:opacity-90"
            >
              Connect wallet
            </button>
          </div>
        )}

        {account && loadState === "loading" && (
          <p className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[13px] text-[var(--muted)]">
            Loading positions…
          </p>
        )}
        {account && loadState === "error" && (
          <p className="rounded-lg border border-dashed border-[var(--red-text)]/40 bg-[var(--red-text)]/5 p-10 text-center text-[13px] text-[var(--red-text)]">
            {errorMsg}
          </p>
        )}
        {account && loadState === "ready" && rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[13px] text-[var(--muted)]">
            No positions yet. Open a market and place a trade to begin.
          </p>
        )}
        {account && loadState === "ready" && rows.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {rows.map(({ position, market }) => (
              <PositionCard
                key={`${market.id}`}
                market={market}
                position={position}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: "green" | "red";
}) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={
          accent === "green"
            ? "truncate text-[13px] font-medium text-[var(--green-text)]"
            : accent === "red"
              ? "truncate text-[13px] font-medium text-[var(--red-text)]"
              : "truncate text-[13px] font-medium text-[var(--ink)]"
        }
      >
        {value}
      </dd>
    </div>
  );
}
