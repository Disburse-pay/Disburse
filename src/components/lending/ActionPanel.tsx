import { useState } from "react";
import type { Address, Hash } from "viem";
import { cn } from "../../lib/utils";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import {
  borrow,
  deposit,
  depositCollateral,
  repay,
  withdraw,
  withdrawCollateral,
} from "../../lib/lending/onchain";
import {
  parseCirBtcInput,
  parseUsdcInput,
} from "../../lib/lending/types";

type Tab = "supply" | "withdraw" | "borrow" | "repay" | "collateral-in" | "collateral-out";

type SubmitState =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "ok"; txHash: Hash; message: string }
  | { kind: "error"; message: string };

const TABS: { key: Tab; label: string }[] = [
  { key: "supply", label: "Supply USDC" },
  { key: "withdraw", label: "Withdraw USDC" },
  { key: "collateral-in", label: "Add cirBTC" },
  { key: "collateral-out", label: "Withdraw cirBTC" },
  { key: "borrow", label: "Borrow USDC" },
  { key: "repay", label: "Repay USDC" },
];

/**
 * ActionPanel — single card with six tabs for the six pool actions.
 *
 * Why six and not the originally-spec'd four: depositing cirBTC collateral
 * and withdrawing it are distinct paths from supplying/withdrawing USDC.
 * Cramming them under one "withdraw" button makes the UX ambiguous; six
 * narrow buttons is cleaner.
 *
 * Validation:
 *   - Parses the numeric input into the asset's native fixed-point.
 *   - Rejects zero/negative amounts before signing.
 *
 * Each action calls into ../../lib/lending/onchain and pumps the result back
 * to the parent via `onSuccess` so PositionPanel/PoolStats refresh.
 */
export default function ActionPanel({ onSuccess }: { onSuccess: () => void }) {
  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();
  const [tab, setTab] = useState<Tab>("supply");
  const [amount, setAmount] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!account) {
      setSubmit({ kind: "error", message: "Connect a wallet first." });
      return;
    }
    const provider = await wallet.getEthereumProvider?.();
    if (!provider) {
      setSubmit({ kind: "error", message: "No Ethereum provider available." });
      return;
    }

    try {
      let txHash: Hash;
      let message: string;

      switch (tab) {
        case "supply": {
          const amt = parseUsdcInput(amount);
          if (amt <= 0n) throw new Error("Enter a positive USDC amount.");
          setSubmit({ kind: "busy", step: "Supplying USDC…" });
          txHash = await deposit(provider, account as Address, amt);
          message = `Supplied ${amount} USDC.`;
          break;
        }
        case "withdraw": {
          // The user enters shares to redeem. For the MVP that's aUSDC shares;
          // a future "USDC amount" widget can convert via supplyIndex.
          const amt = parseUsdcInput(amount);
          if (amt <= 0n) throw new Error("Enter a positive aUSDC shares amount.");
          setSubmit({ kind: "busy", step: "Withdrawing USDC…" });
          txHash = await withdraw(provider, account as Address, amt);
          message = `Withdrew ${amount} aUSDC shares.`;
          break;
        }
        case "collateral-in": {
          const amt = parseCirBtcInput(amount);
          if (amt <= 0n) throw new Error("Enter a positive cirBTC amount.");
          setSubmit({ kind: "busy", step: "Depositing cirBTC…" });
          txHash = await depositCollateral(provider, account as Address, amt);
          message = `Deposited ${amount} cirBTC as collateral.`;
          break;
        }
        case "collateral-out": {
          const amt = parseCirBtcInput(amount);
          if (amt <= 0n) throw new Error("Enter a positive cirBTC amount.");
          setSubmit({ kind: "busy", step: "Withdrawing cirBTC…" });
          txHash = await withdrawCollateral(provider, account as Address, amt);
          message = `Withdrew ${amount} cirBTC.`;
          break;
        }
        case "borrow": {
          const amt = parseUsdcInput(amount);
          if (amt <= 0n) throw new Error("Enter a positive USDC amount.");
          setSubmit({ kind: "busy", step: "Borrowing USDC…" });
          txHash = await borrow(provider, account as Address, amt);
          message = `Borrowed ${amount} USDC.`;
          break;
        }
        case "repay": {
          const amt = parseUsdcInput(amount);
          if (amt <= 0n) throw new Error("Enter a positive USDC amount.");
          setSubmit({ kind: "busy", step: "Repaying USDC…" });
          txHash = await repay(provider, account as Address, amt);
          message = `Repaid ${amount} USDC.`;
          break;
        }
        default:
          throw new Error("Unknown action.");
      }

      setSubmit({ kind: "ok", txHash, message });
      setAmount("");
      onSuccess();
    } catch (err) {
      setSubmit({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const placeholder =
    tab === "collateral-in" || tab === "collateral-out" ? "Amount in cirBTC" : "Amount in USDC";

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5">
      <h2 className="mb-3 text-[14px] font-medium text-[var(--ink)]">Actions</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setAmount("");
              setSubmit({ kind: "idle" });
            }}
            className={cn(
              "rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors",
              tab === t.key
                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--primary-text)]"
                : "border-[var(--line)] bg-[var(--paper-2)] text-[var(--ink)] hover:border-[var(--ink)]/40"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-[var(--muted)]">{placeholder}</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="rounded-md border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2 font-mono text-[13.5px] text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
            disabled={submit.kind === "busy"}
          />
        </label>
        <button
          type="submit"
          disabled={!account || submit.kind === "busy"}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--ink)] px-4 py-2 text-[13px] font-medium text-[var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submit.kind === "busy" ? submit.step : TABS.find((t) => t.key === tab)?.label ?? "Submit"}
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
