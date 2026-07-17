import { useCallback, useEffect, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { ArrowDownToLine, Wallet } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { ARC_CHAIN_ID, TOKENS, erc20Abi, publicClient } from "../lib/arc";
import { depositToGateway } from "../lib/gateway/deposit";
import { fetchGatewayBalance } from "../lib/gateway/balance";
import type { EthereumProvider } from "../lib/onchain";
import SidePanel from "./ui/SidePanel";

type Props = {
  open: boolean;
  onClose: () => void;
  account?: Address;
  chainId?: number;
  getProvider: () => Promise<EthereumProvider | undefined>;
  /** Notify the shell that on-chain balances changed after a deposit. */
  onDeposited?: () => void;
};

type Phase = "idle" | "approving" | "depositing" | "refreshing" | "done";

/**
 * Deposit USDC into the Disburse (Circle Gateway) unified balance on Arc.
 * approve + GatewayWallet.deposit only — never a plain transfer to the
 * Gateway Wallet, which would burn the funds. See src/lib/gateway/deposit.ts.
 */
export default function DepositPanel({ open, onClose, account, chainId, getProvider, onDeposited }: Props) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [disburseBalance, setDisburseBalance] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | undefined>();

  const wrongChain = Boolean(account && chainId !== undefined && chainId !== ARC_CHAIN_ID);
  const busy = phase === "approving" || phase === "depositing" || phase === "refreshing";

  const refreshBalances = useCallback(async () => {
    if (!account) {
      setWalletBalance(null);
      setDisburseBalance(null);
      return;
    }
    const [wallet, gateway] = await Promise.allSettled([
      publicClient.readContract({
        address: TOKENS.USDC.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account]
      }),
      fetchGatewayBalance(account)
    ]);
    if (wallet.status === "fulfilled") setWalletBalance(wallet.value as bigint);
    if (gateway.status === "fulfilled") setDisburseBalance(gateway.value.available);
  }, [account]);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setError(undefined);
    setPhase("idle");
    void refreshBalances();
  }, [open, refreshBalances]);

  function setMax() {
    if (walletBalance !== null) {
      setAmount(formatUnits(walletBalance, TOKENS.USDC.decimals));
    }
  }

  async function handleDeposit() {
    if (!account || busy) return;
    setError(undefined);

    let value: bigint;
    try {
      value = parseUnits(amount.trim() || "0", TOKENS.USDC.decimals);
    } catch {
      setError(t("depositAmountInvalid"));
      return;
    }
    if (value <= 0n) {
      setError(t("depositAmountInvalid"));
      return;
    }
    if (walletBalance !== null && value > walletBalance) {
      setError(t("depositAmountTooHigh"));
      return;
    }

    const provider = await getProvider();
    if (!provider) {
      setError(t("depositConnect"));
      return;
    }

    try {
      // The lib approves first when the allowance is short; reflect that phase
      // so the user knows why their wallet prompts twice.
      const needsApproval = value > 0n;
      setPhase(needsApproval ? "approving" : "depositing");
      const result = await depositToGateway(provider, account, value);
      // If no approval tx came back, the first prompt was already the deposit.
      if (!result.approveHash) setPhase("depositing");
      setPhase("refreshing");
      await refreshBalances();
      setPhase("done");
      setAmount("");
      onDeposited?.();
    } catch (depositError) {
      setPhase("idle");
      setError(depositError instanceof Error ? depositError.message : String(depositError));
    }
  }

  const actionLabel =
    phase === "approving"
      ? t("depositApproving")
      : phase === "depositing"
        ? t("depositDepositing")
        : phase === "refreshing"
          ? t("depositRefreshing")
          : t("depositAction");

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      side="right"
      width={380}
      ariaLabel={t("depositTitle")}
      title={t("depositTitle")}
      description={t("depositDescription")}
    >
      {!account ? (
        <p className="text-sm text-[var(--muted)]">{t("depositConnect")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Balances */}
          <dl className="grid grid-cols-2 gap-2">
            <BalanceTile
              icon={<Wallet size={14} strokeWidth={1.75} />}
              label={t("depositWalletBalance")}
              value={formatBalance(walletBalance)}
            />
            <BalanceTile
              icon={<ArrowDownToLine size={14} strokeWidth={1.75} />}
              label={t("depositDisburseBalance")}
              value={formatBalance(disburseBalance)}
            />
          </dl>

          {/* Amount */}
          <div>
            <label htmlFor="deposit-amount" className="mb-1 block text-sm text-[var(--muted)]">
              {t("depositAmount")}
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2 focus-within:border-[var(--primary-bg)]">
              <input
                id="deposit-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                disabled={busy}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                className="min-w-0 flex-1 bg-transparent text-base font-medium text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
              />
              <span className="text-sm font-medium text-[var(--muted)]">USDC</span>
              <button
                type="button"
                onClick={setMax}
                disabled={busy || walletBalance === null}
                className="rounded-md border border-[var(--line-strong)] px-2 py-0.5 text-xs font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--paper-2)] disabled:opacity-50"
              >
                {t("depositMax")}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleDeposit()}
            disabled={busy || wrongChain}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--primary-bg)] px-3 text-base font-medium text-[color:var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            {!busy && <ArrowDownToLine size={15} strokeWidth={1.75} />}
            {actionLabel}
          </button>

          {wrongChain && <p className="text-sm text-[var(--ink)]">{t("depositWrongChain")}</p>}
          {phase === "done" && !error && (
            <p role="status" className="text-sm text-[var(--ink)]">
              {t("depositDone")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-[var(--ink)]">
              {error}
            </p>
          )}
        </div>
      )}
    </SidePanel>
  );
}

function BalanceTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[var(--muted)]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1 truncate text-base font-semibold tabular-nums text-[var(--ink)]">{value}</p>
    </div>
  );
}

function formatBalance(value: bigint | null): string {
  if (value === null) return "—";
  const formatted = formatUnits(value, TOKENS.USDC.decimals);
  const asNumber = Number(formatted);
  if (!Number.isFinite(asNumber)) return formatted;
  return `${asNumber.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
