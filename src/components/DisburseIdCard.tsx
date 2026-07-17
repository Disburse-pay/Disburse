import { useEffect, useState } from "react";
import { AtSign } from "lucide-react";
import type { Address } from "viem";
import { useI18n } from "../lib/i18n";
import { claimDisburseId, lookupIdByAddress, type DisburseId } from "../lib/idsApi";
import type { EthereumProvider } from "../lib/onchain";
import { shortAddress } from "../lib/payments";

type Props = {
  account?: Address;
  getProvider: () => Promise<EthereumProvider | undefined>;
};

/**
 * Dashboard card for the wallet's Disburse ID. Shows the claimed name, or a
 * one-line claim form when the wallet has none. Names are immutable and
 * receive payment requests in the in-app inbox.
 */
export default function DisburseIdCard({ account, getProvider }: Props) {
  const { t } = useI18n();
  const [id, setId] = useState<DisburseId | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState("");
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setId(undefined);
    setError(undefined);
    if (!account) {
      return;
    }
    let isActive = true;
    setIsLoading(true);
    lookupIdByAddress(account)
      .then((found) => {
        if (isActive) {
          setId(found);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });
    return () => {
      isActive = false;
    };
  }, [account]);

  async function handleClaim() {
    if (!account || isClaiming) {
      return;
    }
    setError(undefined);
    const provider = await getProvider();
    if (!provider) {
      setError(t("noWalletPage"));
      return;
    }
    setIsClaiming(true);
    try {
      const claimed = await claimDisburseId(provider, account, input);
      setId(claimed);
      setInput("");
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : String(claimError));
    } finally {
      setIsClaiming(false);
    }
  }

  return (
    <section
      aria-label={t("disburseId")}
      className="rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--card-shadow)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-sm text-[var(--muted)]">{t("disburseId")}</p>
          {!account && (
            <p className="mt-1 text-base text-[var(--muted)]">{t("disburseIdConnect")}</p>
          )}
          {account && isLoading && (
            <p className="mt-1 text-base text-[var(--muted)]">{t("loading")}</p>
          )}
          {account && !isLoading && id && (
            <>
              <p className="mt-1 flex items-center gap-1 text-lg font-semibold tracking-[-0.012em] text-[var(--ink)]">
                <AtSign size={15} strokeWidth={2} className="text-[var(--muted)]" />
                {id.handle}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {shortAddress(id.address)} · {t("disburseIdYours")}
              </p>
            </>
          )}
          {account && !isLoading && !id && (
            <p className="mt-1 text-base text-[var(--muted)]">{t("disburseIdUnclaimed")}</p>
          )}
        </div>

        {account && !isLoading && !id && (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleClaim();
            }}
          >
            <div className="flex h-8 items-center gap-1 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-2 focus-within:border-[var(--ink-soft)]">
              <AtSign size={13} strokeWidth={2} className="text-[var(--muted)]" />
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={t("disburseIdPlaceholder")}
                spellCheck={false}
                autoComplete="off"
                maxLength={17}
                className="w-36 border-none bg-transparent p-0 text-base text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
              />
            </div>
            <button
              type="submit"
              disabled={isClaiming || !input.trim()}
              className="inline-flex h-8 items-center rounded-md bg-[var(--primary-bg)] px-3 text-base font-medium text-[color:var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            >
              {isClaiming ? t("disburseIdClaiming") : t("disburseIdClaim")}
            </button>
          </form>
        )}
      </div>
      {error && (
        <p role="alert" className="border-t border-[var(--line-soft)] px-5 py-3 text-sm text-[var(--ink)]">
          {error}
        </p>
      )}
    </section>
  );
}
