import { useEffect, useState } from "react";
import type { Address } from "viem";
import { fetchLendingPosition } from "../../lib/lending/api";
import {
  formatCirBtc,
  formatHealthFactor,
  formatUsdc,
  type LendingPosition,
  WAD,
} from "../../lib/lending/types";
import { readAUsdcBalance } from "../../lib/lending/onchain";

/**
 * PositionPanel — collateral, debt, HF, supplied aUSDC at a glance.
 *
 * Two data sources:
 *   - /api/lending-position (server-cached collateral/debt/HF, indexed)
 *   - readAUsdcBalance      (live on-chain aUSDC balance)
 *
 * Refreshes when `refreshKey` changes — the parent bumps it after every
 * successful tx so the panel reflects new state without waiting for the
 * indexer's 5-minute cron.
 */
export default function PositionPanel({ account, refreshKey }: { account: Address; refreshKey: number }) {
  const [pos, setPos] = useState<LendingPosition | null>(null);
  const [aUsdcShares, setAUsdcShares] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [p, shares] = await Promise.all([
          fetchLendingPosition(account),
          readAUsdcBalance(account),
        ]);
        if (cancelled) return;
        setPos(p);
        setAUsdcShares(shares);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [account, refreshKey]);

  if (error) {
    return (
      <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5 text-[12.5px] text-[var(--muted)]">
        Your position is unavailable: {error}
      </div>
    );
  }

  const collateralBtc = pos?.collateralAmount ?? 0n;
  const debtUsdc = pos?.cachedDebtUsdc ?? 0n;
  const collateralUsdc = pos?.cachedCollateralUsdc ?? 0n;
  const hf = pos?.cachedHealthFactor ?? null;
  const hfAccent: "green" | "red" | undefined =
    hf === null ? undefined : hf < WAD ? "red" : hf < 2n * WAD ? undefined : "green";
  const liquidatable = pos?.isLiquidatable ?? false;

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-medium text-[var(--ink)]">Your position</h2>
        {liquidatable && (
          <span className="rounded-md bg-[var(--red-bg,#fee)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--red-text)]">
            LIQUIDATABLE
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="cirBTC collateral" value={`${formatCirBtc(collateralBtc, 4)} cirBTC`} sub={`≈ $${formatUsdc(collateralUsdc)}`} />
        <Stat label="USDC debt" value={`$${formatUsdc(debtUsdc)}`} accent={debtUsdc > 0n ? "red" : undefined} />
        <Stat label="Health factor" value={formatHealthFactor(hf)} accent={hfAccent} />
        <Stat
          label="Supplied (aUSDC)"
          value={aUsdcShares !== null ? `${formatUsdc(aUsdcShares)} aUSDC` : "—"}
          accent="green"
        />
      </dl>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "green" | "red";
}) {
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
        {sub && <span className="ml-1 font-mono text-[10.5px] opacity-80">{sub}</span>}
      </dd>
    </div>
  );
}
