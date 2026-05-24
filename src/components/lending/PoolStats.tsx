import { useEffect, useState } from "react";
import { fetchLendingPoolSnapshot } from "../../lib/lending/api";
import { formatApr, formatUsdc, type LendingPoolSnapshot, WAD } from "../../lib/lending/types";

/**
 * PoolStats — top-of-page summary card. Polls the latest snapshot every 15s.
 *
 * Snapshot freshness depends on the indexer cron (every 5 minutes by
 * default), so the "observed at" timestamp is shown to set expectations.
 */
export default function PoolStats() {
  const [snap, setSnap] = useState<LendingPoolSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await fetchLendingPoolSnapshot();
        if (!cancelled) {
          setSnap(s);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (error && !snap) {
    return (
      <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5 text-[12.5px] text-[var(--muted)]">
        Pool stats unavailable: {error}
      </div>
    );
  }
  if (!snap) {
    return (
      <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5 text-[12.5px] text-[var(--muted)]">
        Loading pool stats…
      </div>
    );
  }

  const utilPct = (Number(snap.utilizationWad) / 1e18) * 100;
  const btcUsd = snap.btcPriceWad ? Number(snap.btcPriceWad / 10n ** 14n) / 10_000 : null;

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-medium text-[var(--ink)]">Pool</h2>
        <span className="text-[10.5px] text-[var(--muted-soft)]">
          As of {new Date(snap.observedAt).toLocaleTimeString()}
          {snap.btcPriceWad === null && <span className="ml-2 text-[var(--red-text)]">price stale</span>}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Cash" value={`$${formatUsdc(snap.cashUsdc)}`} />
        <Stat label="Total borrowed" value={`$${formatUsdc(snap.totalBorrowsUsdc)}`} />
        <Stat label="Utilization" value={`${utilPct.toFixed(1)}%`} />
        <Stat label="Supply APR" value={formatApr(snap.supplyAprWad)} accent="green" />
        <Stat label="Borrow APR" value={formatApr(snap.borrowAprWad)} accent="red" />
      </dl>
      {btcUsd !== null && (
        <p className="mt-3 text-[11.5px] text-[var(--muted)]">
          cirBTC priced from Pyth BTC/USD: <span className="font-mono">${btcUsd.toLocaleString()}</span>
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "green" | "red" }) {
  return (
    <div>
      <dt className="mb-1 text-[11.5px] font-medium text-[var(--muted)]">{label}</dt>
      <dd
        className={
          "text-[14px] font-medium " +
          (accent === "green"
            ? "text-[var(--green-text)]"
            : accent === "red"
              ? "text-[var(--red-text)]"
              : "text-[var(--ink)]")
        }
      >
        {value}
      </dd>
    </div>
  );
}
