import { useState } from "react";
import { Wallet } from "lucide-react";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import PoolStats from "../../components/lending/PoolStats";
import PositionPanel from "../../components/lending/PositionPanel";
import ActionPanel from "../../components/lending/ActionPanel";

/**
 * LendingPage — top-level page for the cirBTC → USDC lending product.
 *
 * Layout (single column on mobile, two on desktop):
 *   ┌─ PoolStats (cash, borrowed, utilization, APRs)
 *   ┌─ PositionPanel (your collateral, debt, health factor, supplied)
 *   └─ ActionPanel (6 tabs: supply / withdraw / +cirBTC / −cirBTC / borrow / repay)
 *
 * The action panel bumps `refreshKey` on success so PositionPanel re-reads
 * fresh state. PoolStats has its own poller.
 */
export default function LendingPage() {
  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();
  const [refreshKey, setRefreshKey] = useState(0);

  if (!account) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--paper-2)]">
          <Wallet className="h-5 w-5 text-[var(--ink)]" />
        </div>
        <h2 className="text-[16px] font-semibold text-[var(--ink)]">Connect wallet to use Lending</h2>
        <p className="max-w-[420px] text-[13px] text-[var(--muted)]">
          Deposit cirBTC as collateral and borrow up to 80% of its USD value in USDC. Lenders earn interest on supplied USDC.
        </p>
        <button
          type="button"
          onClick={() => wallet.openAuthFlow?.()}
          className="mt-2 inline-flex items-center gap-2 rounded-md bg-[var(--ink)] px-4 py-2 text-[13px] font-medium text-[var(--primary-text)]"
        >
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[20px] font-semibold tracking-[-0.012em] text-[var(--ink)]">Lending</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Supply USDC to earn yield, or borrow against cirBTC collateral at up to 80% LTV. Liquidation threshold 90%, bonus 5%.
        </p>
      </header>
      <PoolStats />
      <PositionPanel account={account} refreshKey={refreshKey} />
      <ActionPanel onSuccess={() => setRefreshKey((k) => k + 1)} />
    </div>
  );
}
