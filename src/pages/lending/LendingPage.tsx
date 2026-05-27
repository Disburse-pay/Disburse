import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import PoolStats from "../../components/lending/PoolStats";
import PositionPanel from "../../components/lending/PositionPanel";
import LendCard from "../../components/lending/LendCard";
import BorrowCard from "../../components/lending/BorrowCard";
import TvlChart from "../../components/lending/TvlChart";
import { fetchLendingPoolSnapshot } from "../../lib/lending/api";
import type { LendingPoolSnapshot } from "../../lib/lending/types";
import { cn } from "../../lib/utils";

/**
 * LendingPage — top-level page for the cirBTC → USDC lending product.
 *
 * Layout:
 *   ┌─ PoolStats          (cash, borrowed, util, APRs, BTC price)
 *   ┌─ PositionPanel      (collateral, debt, HF, supplied aUSDC)
 *   └─ Action grid (md:2-col)
 *      ┌─ LendCard        (Earn — Supply / Withdraw USDC)
 *      └─ BorrowCard      (Borrow — Deposit / Borrow / Repay / Withdraw)
 *
 * Splitting the original 6-tab ActionPanel into Lend vs Borrow makes the
 * mental model match the product: "I want to earn yield" vs "I want a loan
 * against my cirBTC". Each card surfaces wallet balances + a MAX button so
 * users aren't squinting to figure out how much they can move.
 *
 * The page itself fetches the pool snapshot once and shares the APR / BTC
 * price props to the action cards so the cards don't duplicate the poll.
 * `refreshKey` bumps after every tx so balances + position re-fetch fresh.
 */
export default function LendingPage() {
  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();
  const [refreshKey, setRefreshKey] = useState(0);
  const [snap, setSnap] = useState<LendingPoolSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await fetchLendingPoolSnapshot();
        if (!cancelled) setSnap(s);
      } catch {
        // PoolStats has its own loader + error UI; this is just for the
        // child cards' optional APR / price hints, so swallow errors.
      }
    }
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [refreshKey]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[20px] font-semibold tracking-[-0.012em] text-[var(--ink)]">Lending</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Supply USDC to earn yield, or borrow against cirBTC collateral at up to 80% LTV. Liquidation threshold 90%, bonus 5%.
        </p>
      </header>
      <PoolStats />
      <TvlChart />
      {/* Pool + TVL render for every visitor — the action surfaces below
          handle their own "Connect wallet" affordance for unconnected users. */}
      {account ? (
        <>
          <PositionPanel account={account} refreshKey={refreshKey} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <LendCard
              account={account}
              supplyAprWad={snap?.supplyAprWad ?? null}
              refreshKey={refreshKey}
              onSuccess={() => setRefreshKey((k) => k + 1)}
            />
            <BorrowCard
              account={account}
              borrowAprWad={snap?.borrowAprWad ?? null}
              btcPriceWad={snap?.btcPriceWad ?? null}
              refreshKey={refreshKey}
              onSuccess={() => setRefreshKey((k) => k + 1)}
            />
          </div>
        </>
      ) : (
        <LendingConnectPrompt onConnect={() => wallet.openAuthFlow?.()} />
      )}
    </div>
  );
}

function LendingConnectPrompt({ onConnect }: { onConnect: () => void }) {
  return (
    <div className={cn(
      "flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--line)] bg-[var(--paper)] p-8 text-center",
    )}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--paper-2)]">
        <Wallet className="h-4 w-4 text-[var(--ink)]" />
      </div>
      <h2 className="text-[14.5px] font-semibold text-[var(--ink)]">Connect to lend or borrow</h2>
      <p className="max-w-[440px] text-[12.5px] leading-relaxed text-[var(--muted)]">
        Pool stats and TVL above are live. Connect a wallet to supply USDC for yield, or deposit cirBTC and borrow against it.
      </p>
      <button
        type="button"
        onClick={onConnect}
        className="mt-1 inline-flex items-center gap-2 rounded-md bg-[var(--primary-bg)] px-4 py-1.5 text-[12.5px] font-medium text-[color:var(--primary-text)] shadow-sm transition-colors hover:bg-[var(--primary-bg-hover)]"
      >
        Connect wallet
      </button>
    </div>
  );
}
