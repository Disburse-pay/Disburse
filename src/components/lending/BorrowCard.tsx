import { useCallback, useEffect, useState } from "react";
import type { Address, Hash } from "viem";
import { ArrowDownToLine, ArrowUpFromLine, Bitcoin, DollarSign } from "lucide-react";
import { cn } from "../../lib/utils";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import {
  borrow,
  depositCollateral,
  readCirBtcWalletBalance,
  readMaxBorrow,
  readUsdcWalletBalance,
  readUserCollateral,
  readUserDebt,
  repay,
  withdrawCollateral,
} from "../../lib/lending/onchain";
import {
  CIRBTC_DECIMALS,
  USDC_DECIMALS,
  formatApr,
  formatCirBtc,
  formatUsdc,
  parseCirBtcInput,
  parseUsdcInput,
} from "../../lib/lending/types";

type Step = "deposit" | "borrow" | "repay" | "withdraw";

type SubmitState =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "ok"; txHash: Hash; message: string }
  | { kind: "error"; message: string };

const STEPS: { key: Step; label: string; sub: string; asset: "cirBTC" | "USDC" }[] = [
  { key: "deposit",  label: "Deposit",  sub: "Lock cirBTC as collateral",    asset: "cirBTC" },
  { key: "borrow",   label: "Borrow",   sub: "Borrow USDC against collateral", asset: "USDC" },
  { key: "repay",    label: "Repay",    sub: "Pay down your USDC debt",      asset: "USDC" },
  { key: "withdraw", label: "Withdraw", sub: "Reclaim cirBTC (after repay)",  asset: "cirBTC" },
];

/**
 * BorrowCard — the "borrow against cirBTC" side of the lending product.
 *
 * Four sequential steps in the borrow flow, presented as a single card with
 * a clearer left-to-right step picker than the original 6-button grid:
 *
 *   Deposit cirBTC → Borrow USDC → (later) Repay USDC → Withdraw cirBTC
 *
 * We show live data for each step:
 *   - Deposit:  wallet cirBTC + locked collateral
 *   - Borrow:   max-borrowable from the pool's LTV math
 *   - Repay:    current debt (live, accrued) + wallet USDC
 *   - Withdraw: locked collateral + how much is currently "free"
 */
export default function BorrowCard({
  account,
  borrowAprWad,
  btcPriceWad,
  refreshKey,
  onSuccess,
}: {
  account: Address;
  borrowAprWad: bigint | null;
  btcPriceWad: bigint | null;
  refreshKey: number;
  onSuccess: () => void;
}) {
  const wallet = useDisburseDynamicWallet();
  const [step, setStep] = useState<Step>("deposit");
  const [amount, setAmount] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  const [walletCirBtc, setWalletCirBtc] = useState<bigint | null>(null);
  const [walletUsdc, setWalletUsdc] = useState<bigint | null>(null);
  const [locked, setLocked] = useState<bigint | null>(null);
  const [debt, setDebt] = useState<bigint | null>(null);
  const [maxBorrow, setMaxBorrow] = useState<bigint | null>(null);

  const loadBalances = useCallback(async () => {
    try {
      const [wc, wu, l, d, mb] = await Promise.all([
        readCirBtcWalletBalance(account),
        readUsdcWalletBalance(account),
        readUserCollateral(account),
        readUserDebt(account).catch(() => 0n),
        readMaxBorrow(account).catch(() => 0n),
      ]);
      setWalletCirBtc(wc);
      setWalletUsdc(wu);
      setLocked(l);
      setDebt(d);
      setMaxBorrow(mb);
    } catch {
      /* leave nulls; UI hides MAX + balance hints */
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
      let txHash: Hash;
      let message: string;
      switch (step) {
        case "deposit": {
          const amt = parseCirBtcInput(amount);
          if (amt <= 0n) throw new Error("Enter a positive cirBTC amount.");
          setSubmit({ kind: "busy", step: "Depositing cirBTC…" });
          txHash = await depositCollateral(provider, account, amt);
          message = `Deposited ${amount} cirBTC as collateral.`;
          break;
        }
        case "borrow": {
          const amt = parseUsdcInput(amount);
          if (amt <= 0n) throw new Error("Enter a positive USDC amount.");
          setSubmit({ kind: "busy", step: "Borrowing USDC…" });
          txHash = await borrow(provider, account, amt);
          message = `Borrowed ${amount} USDC.`;
          break;
        }
        case "repay": {
          const amt = parseUsdcInput(amount);
          if (amt <= 0n) throw new Error("Enter a positive USDC amount.");
          setSubmit({ kind: "busy", step: "Repaying USDC…" });
          txHash = await repay(provider, account, amt);
          message = `Repaid ${amount} USDC.`;
          break;
        }
        case "withdraw": {
          const amt = parseCirBtcInput(amount);
          if (amt <= 0n) throw new Error("Enter a positive cirBTC amount.");
          setSubmit({ kind: "busy", step: "Withdrawing cirBTC…" });
          txHash = await withdrawCollateral(provider, account, amt);
          message = `Withdrew ${amount} cirBTC.`;
          break;
        }
      }
      setSubmit({ kind: "ok", txHash, message });
      setAmount("");
      await loadBalances();
      onSuccess();
    } catch (err) {
      setSubmit({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const ctx = stepContext(step, { walletCirBtc, walletUsdc, locked, debt, maxBorrow });

  return (
    <div className="flex flex-col rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5">
      <header className="mb-4">
        <h2 className="text-[14px] font-medium text-[var(--ink)]">Borrow — Loan against cirBTC</h2>
        <p className="mt-0.5 text-[11.5px] text-[var(--muted)]">
          Lock cirBTC, borrow USDC up to 80% LTV at
          {borrowAprWad !== null && (
            <> <span className="font-mono text-[var(--red-text)]">{formatApr(borrowAprWad)}</span></>
          )}
          {" "}APR. Liquidatable above 90% LTV.
        </p>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <BalancePill
          label="Wallet cirBTC"
          amount={walletCirBtc}
          unit="cirBTC"
          decimals={CIRBTC_DECIMALS}
          accent={walletCirBtc !== null && walletCirBtc > 0n ? "orange" : undefined}
        />
        <BalancePill
          label="Locked cirBTC"
          amount={locked}
          unit="cirBTC"
          decimals={CIRBTC_DECIMALS}
          accent={locked !== null && locked > 0n ? "orange" : undefined}
        />
        <BalancePill
          label="Wallet USDC"
          amount={walletUsdc}
          unit="USDC"
          decimals={USDC_DECIMALS}
        />
        <BalancePill
          label="USDC debt"
          amount={debt}
          unit="USDC"
          decimals={USDC_DECIMALS}
          accent={debt !== null && debt > 0n ? "red" : undefined}
        />
      </div>

      {btcPriceWad !== null && (
        <p className="-mt-1 mb-2 text-[10.5px] text-[var(--muted-soft)]">
          cirBTC priced from Pyth: <span className="font-mono">${(Number(btcPriceWad / 10n ** 14n) / 10_000).toLocaleString()}</span>
        </p>
      )}

      <StepPicker step={step} onChange={(s) => { setStep(s); setAmount(""); setSubmit({ kind: "idle" }); }} />

      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-medium text-[var(--muted)]">
              Amount ({ctx.unit})
            </span>
            <span className="text-[10.5px] text-[var(--muted-soft)]">
              {ctx.maxLabel}:{" "}
              {ctx.max !== null ? (
                <span className="font-mono">
                  {ctx.unit === "cirBTC" ? formatCirBtc(ctx.max, 6) : formatUsdc(ctx.max)}
                </span>
              ) : (
                "—"
              )}
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
            {ctx.max !== null && ctx.max > 0n && (
              <button
                type="button"
                onClick={() => setAmount(formatRaw(ctx.max as bigint, ctx.unit === "cirBTC" ? CIRBTC_DECIMALS : USDC_DECIMALS))}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--line)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
              >
                Max
              </button>
            )}
          </div>
          {ctx.note && (
            <p className="text-[10.5px] text-[var(--muted-soft)]">{ctx.note}</p>
          )}
        </label>
        <button
          type="submit"
          disabled={submit.kind === "busy"}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--ink)] px-4 py-2 text-[13px] font-medium text-[var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submit.kind === "busy" ? submit.step : ctx.submitLabel}
        </button>
      </form>

      {submit.kind === "ok" && (
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
      )}
      {submit.kind === "error" && (
        <p className="mt-3 text-[12px] text-[var(--red-text)]">{submit.message}</p>
      )}
    </div>
  );
}

function StepPicker({ step, onChange }: { step: Step; onChange: (s: Step) => void }) {
  return (
    <div className="flex rounded-md border border-[var(--line)] bg-[var(--paper-2)] p-0.5">
      {STEPS.map((s, idx) => {
        const active = step === s.key;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange(s.key)}
            title={s.sub}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-0 rounded-[3px] py-1.5 text-[12px] font-medium transition-colors",
              active
                ? "bg-[var(--ink)] text-[var(--primary-text)]"
                : "text-[var(--muted)] hover:text-[var(--ink)]",
            )}
          >
            <span className="flex items-center gap-1.5">
              {idx === 0 && <ArrowDownToLine className="h-3 w-3" />}
              {idx === 1 && <DollarSign className="h-3 w-3" />}
              {idx === 2 && <DollarSign className="h-3 w-3" />}
              {idx === 3 && <ArrowUpFromLine className="h-3 w-3" />}
              {s.label}
            </span>
            <span
              className={cn(
                "text-[9px] font-normal opacity-80",
                active ? "text-[var(--primary-text)]" : "text-[var(--muted-soft)]",
              )}
            >
              {s.asset}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BalancePill({
  label,
  amount,
  unit,
  decimals,
  accent,
}: {
  label: string;
  amount: bigint | null;
  unit: "USDC" | "cirBTC";
  decimals: number;
  accent?: "orange" | "red";
}) {
  const formatted =
    amount === null
      ? "—"
      : unit === "cirBTC"
        ? formatCirBtc(amount, decimals >= 8 ? 6 : 4)
        : formatUsdc(amount);
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
      <p className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
        {unit === "cirBTC" ? <Bitcoin className="h-2.5 w-2.5" /> : <DollarSign className="h-2.5 w-2.5" />}
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-mono text-[13px]",
          accent === "red" ? "text-[var(--red-text)]" : accent === "orange" ? "text-[var(--ink)]" : "text-[var(--ink)]",
        )}
      >
        {formatted}
      </p>
    </div>
  );
}

type Ctx = {
  unit: "USDC" | "cirBTC";
  max: bigint | null;
  maxLabel: string;
  submitLabel: string;
  note?: string;
};

function stepContext(
  step: Step,
  balances: {
    walletCirBtc: bigint | null;
    walletUsdc: bigint | null;
    locked: bigint | null;
    debt: bigint | null;
    maxBorrow: bigint | null;
  },
): Ctx {
  switch (step) {
    case "deposit":
      return {
        unit: "cirBTC",
        max: balances.walletCirBtc,
        maxLabel: "Wallet",
        submitLabel: "Deposit cirBTC",
        note: "Locked cirBTC backs your borrowing power. No price update needed.",
      };
    case "borrow":
      return {
        unit: "USDC",
        max: balances.maxBorrow,
        maxLabel: "Available",
        submitLabel: "Borrow USDC",
        note: "We push a fresh BTC/USD price right before sending the tx so the pool accepts it.",
      };
    case "repay":
      return {
        unit: "USDC",
        max: minBig(balances.debt, balances.walletUsdc),
        maxLabel: "Debt",
        submitLabel: "Repay USDC",
        note: balances.debt !== null && balances.debt === 0n ? "No outstanding debt." : undefined,
      };
    case "withdraw":
      return {
        unit: "cirBTC",
        max: balances.locked,
        maxLabel: "Locked",
        submitLabel: "Withdraw cirBTC",
        note: "If you still have debt, the pool only releases collateral that keeps your HF ≥ 1.",
      };
  }
}

function minBig(a: bigint | null, b: bigint | null): bigint | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
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
