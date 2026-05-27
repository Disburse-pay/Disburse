import { useCallback, useEffect, useState } from "react";
import type { Address, Hash } from "viem";
import { ArrowDownToLine, ArrowUpFromLine, Wallet } from "lucide-react";
import { cn } from "../../lib/utils";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import { deposit, withdraw, readAUsdcBalance, readUsdcWalletBalance } from "../../lib/lending/onchain";
import {
  formatApr,
  formatUsdc,
  parseUsdcInput,
  USDC_DECIMALS,
} from "../../lib/lending/types";

type Mode = "supply" | "withdraw";

type SubmitState =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "ok"; txHash: Hash; message: string }
  | { kind: "error"; message: string };

/**
 * LendCard — the "earn yield" side of the lending product.
 *
 * Two actions only: supply USDC, redeem aUSDC. We surface:
 *   - wallet USDC balance (so the user knows the upper bound on supply)
 *   - aUSDC balance (current position, also the upper bound on withdraw)
 *   - current supply APR
 *
 * MAX buttons populate the input from the balance shown next to the mode
 * toggle. Withdraw uses aUSDC shares; in the MVP that's 1:1 with USDC at
 * supplyIndex = 1e18 (today) and drifts as interest accrues. We keep the
 * unit display as aUSDC for honesty.
 */
export default function LendCard({
  account,
  supplyAprWad,
  refreshKey,
  onSuccess,
}: {
  account: Address;
  supplyAprWad: bigint | null;
  refreshKey: number;
  onSuccess: () => void;
}) {
  const wallet = useDisburseDynamicWallet();
  const [mode, setMode] = useState<Mode>("supply");
  const [amount, setAmount] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  const [walletUsdc, setWalletUsdc] = useState<bigint | null>(null);
  const [aUsdc, setAUsdc] = useState<bigint | null>(null);

  const loadBalances = useCallback(async () => {
    try {
      const [w, a] = await Promise.all([
        readUsdcWalletBalance(account),
        readAUsdcBalance(account),
      ]);
      setWalletUsdc(w);
      setAUsdc(a);
    } catch {
      // Balance reads aren't fatal — leave them as null and the UI just hides
      // the MAX buttons and the "wallet:" hint.
    }
  }, [account]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances, refreshKey]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const provider = await wallet.getEthereumProvider?.();
    if (!provider) {
      setSubmit({ kind: "error", message: "No Ethereum provider available." });
      return;
    }

    try {
      const amt = parseUsdcInput(amount);
      if (amt <= 0n) throw new Error("Enter a positive USDC amount.");

      let txHash: Hash;
      let message: string;
      if (mode === "supply") {
        setSubmit({ kind: "busy", step: "Supplying USDC…" });
        txHash = await deposit(provider, account, amt);
        message = `Supplied ${amount} USDC.`;
      } else {
        setSubmit({ kind: "busy", step: "Withdrawing USDC…" });
        txHash = await withdraw(provider, account, amt);
        message = `Withdrew ${amount} aUSDC shares.`;
      }

      setSubmit({ kind: "ok", txHash, message });
      setAmount("");
      await loadBalances();
      onSuccess();
    } catch (err) {
      setSubmit({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const max = mode === "supply" ? walletUsdc : aUsdc;
  const balanceLabel = mode === "supply" ? "Wallet" : "Supplied";
  const submitLabel = mode === "supply" ? "Supply USDC" : "Withdraw USDC";

  return (
    <div className="flex flex-col rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5">
      <header className="mb-4">
        <h2 className="text-[14px] font-medium text-[var(--ink)]">Earn — Lend USDC</h2>
        <p className="mt-0.5 text-[11.5px] text-[var(--muted)]">
          Supply USDC, earn the pool's supply APR
          {supplyAprWad !== null && (
            <> (<span className="font-mono text-[var(--green-text)]">{formatApr(supplyAprWad)}</span>)</>
          )}
          . Withdraw anytime.
        </p>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <BalancePill label="Wallet USDC" amount={walletUsdc} />
        <BalancePill label="Your aUSDC" amount={aUsdc} accent="green" />
      </div>

      <ModeToggle mode={mode} onChange={(m) => { setMode(m); setAmount(""); setSubmit({ kind: "idle" }); }} />

      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-medium text-[var(--muted)]">
              Amount ({mode === "supply" ? "USDC" : "aUSDC"})
            </span>
            <span className="text-[10.5px] text-[var(--muted-soft)]">
              {balanceLabel}: {max !== null ? <span className="font-mono">{formatUsdc(max)}</span> : "—"}
            </span>
          </div>
          <div className="relative">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full rounded-md border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2 pr-16 font-mono text-[13.5px] text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
              disabled={submit.kind === "busy"}
            />
            {max !== null && max > 0n && (
              <button
                type="button"
                onClick={() => setAmount(formatRaw(max, USDC_DECIMALS))}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--line)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
              >
                Max
              </button>
            )}
          </div>
        </label>
        <button
          type="submit"
          disabled={submit.kind === "busy"}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--ink)] px-4 py-2 text-[13px] font-medium text-[color:var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submit.kind === "busy" ? submit.step : submitLabel}
        </button>
      </form>

      <SubmitFeedback submit={submit} />
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex rounded-md border border-[var(--line)] bg-[var(--paper-2)] p-0.5">
      <ToggleButton active={mode === "supply"} onClick={() => onChange("supply")} icon={<ArrowDownToLine className="h-3 w-3" />}>
        Supply
      </ToggleButton>
      <ToggleButton active={mode === "withdraw"} onClick={() => onChange("withdraw")} icon={<ArrowUpFromLine className="h-3 w-3" />}>
        Withdraw
      </ToggleButton>
    </div>
  );
}

function ToggleButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-[3px] py-1.5 text-[12px] font-medium transition-colors",
        active ? "bg-[var(--ink)] text-[color:var(--primary-text)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function BalancePill({ label, amount, accent }: { label: string; amount: bigint | null; accent?: "green" }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-mono text-[13px]",
          accent === "green" ? "text-[var(--green-text)]" : "text-[var(--ink)]",
        )}
      >
        {amount !== null ? formatUsdc(amount) : <span className="inline-flex items-center gap-1 text-[var(--muted-soft)]"><Wallet className="h-3 w-3" />—</span>}
      </p>
    </div>
  );
}

function SubmitFeedback({ submit }: { submit: SubmitState }) {
  if (submit.kind === "ok") {
    return (
      <p className="mt-3 text-[12px] text-[var(--green-text)]">
        {submit.message}{" "}
        <a
          href={`https://testnet.arcscan.app/tx/${submit.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          View tx
        </a>
      </p>
    );
  }
  if (submit.kind === "error") {
    return <p className="mt-3 text-[12px] text-[var(--red-text)]">{submit.message}</p>;
  }
  return null;
}

/** Render a raw fixed-point integer as a decimal string with no thousands sep. */
function formatRaw(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
