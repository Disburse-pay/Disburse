import { useEffect, useMemo, useState } from "react";
import type { Hash } from "viem";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import {
  fetchMarkets,
  fetchMyClaims,
  MarketsApiError,
  recordClaim
} from "../../lib/markets/api";
import { readClaimableShares, submitClaim } from "../../lib/markets/onchain";
import { subscribeMyClaims } from "../../lib/markets/realtime";
import {
  microsToUsdcString,
  type Market,
  type MarketClaim,
  type Outcome
} from "../../lib/markets/types";
import type { NavigateHandler } from "../../lib/routing";
import OutcomeBadge from "../../components/markets/OutcomeBadge";
import ClaimButton from "../../components/markets/ClaimButton";

type Props = {
  onNavigate: NavigateHandler;
};

type Row = {
  market: Market;
  outcome: Outcome; // The winning outcome (or, if a claim exists, the outcome the user claimed)
  claimableMicros: bigint; // 0n if no winning shares held
  claim?: MarketClaim;
};

export default function HistoryPage({ onNavigate }: Props) {
  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();

  const [markets, setMarkets] = useState<Market[]>([]);
  const [claims, setClaims] = useState<MarketClaim[]>([]);
  const [claimable, setClaimable] = useState<Map<string, bigint>>(new Map());
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  // Per-market in-flight or last-failed status from the user's claim action.
  const [claimStatus, setClaimStatus] = useState<Map<string, string>>(new Map());

  // 1. Load resolved markets + (if connected) prior claims.
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setClaimable(new Map());
    const tasks: Promise<unknown>[] = [
      fetchMarkets({ status: "resolved" }).then((m) => {
        if (!cancelled) setMarkets(m);
      })
    ];
    if (account) {
      tasks.push(
        fetchMyClaims(account).then((c) => {
          if (!cancelled) setClaims(c);
        })
      );
    } else {
      setClaims([]);
    }
    Promise.all(tasks)
      .then(() => {
        if (!cancelled) setLoadState("ready");
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

  // 2. For each resolved market with no existing claim, read the on-chain
  // OutcomeToken balance to know what's claimable. Done in parallel; one
  // failed read shouldn't block the others.
  useEffect(() => {
    if (!account || loadState !== "ready" || markets.length === 0) return;
    let cancelled = false;
    const claimedIds = new Set(claims.map((c) => c.marketId));
    const work = markets
      .filter((m) => !claimedIds.has(m.id))
      .map(async (m) => {
        try {
          const bal = await readClaimableShares(account, m);
          if (!cancelled) {
            setClaimable((prev) => {
              if (prev.get(m.id) === bal) return prev;
              const next = new Map(prev);
              next.set(m.id, bal);
              return next;
            });
          }
        } catch {
          // Swallow — failure to read a balance just means "not eligible"
          // surface; user can still see the row.
        }
      });
    void Promise.all(work);
    return () => {
      cancelled = true;
    };
  }, [account, loadState, markets, claims]);

  // 3. Realtime: claim row inserts/updates (psp_uid fills in async).
  useEffect(() => {
    if (!account) return;
    return subscribeMyClaims(account, (updated) => {
      setClaims((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        const next = idx === -1 ? [...prev, updated] : prev.slice();
        if (idx !== -1) next[idx] = updated;
        // Re-sort newest-first to keep the rendered order stable.
        return next.sort(
          (a, b) => new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime()
        );
      });
    });
  }, [account]);

  // Build display rows: one per resolved market.
  const rows: Row[] = useMemo(() => {
    const claimByMarket = new Map(claims.map((c) => [c.marketId, c]));
    return markets.map((m) => {
      const claim = claimByMarket.get(m.id);
      const outcome: Outcome = claim?.outcome ?? m.winningOutcome ?? "YES";
      const claimableBn = claim ? 0n : (claimable.get(m.id) ?? 0n);
      return { market: m, outcome, claimableMicros: claimableBn, claim };
    });
  }, [markets, claims, claimable]);

  async function handleClaim(market: Market, amount: bigint) {
    if (!account) return;
    if (amount <= 0n) return;
    setClaimStatus((m) => new Map(m).set(market.id, "Sign in wallet…"));
    try {
      const provider = await wallet.getEthereumProvider();
      if (!provider) throw new Error("Wallet provider not available. Reconnect and try again.");

      const txHash: Hash = await submitClaim(provider, account, market.onchainAddress, amount);
      setClaimStatus((m) => new Map(m).set(market.id, "Indexing claim…"));

      // Record the claim — server reads MarketClaimed log and (if PSP enabled)
      // issues a signed PSP. The realtime channel above will deliver the
      // pspUid update; we set the local claims map optimistically here too.
      const { claim } = await recordClaim({ marketId: market.id, txHash });
      setClaims((prev) =>
        prev.some((c) => c.id === claim.id) ? prev : [claim, ...prev]
      );
      setClaimable((prev) => {
        if (!prev.has(market.id)) return prev;
        const next = new Map(prev);
        next.delete(market.id);
        return next;
      });
      setClaimStatus((m) => {
        const next = new Map(m);
        next.delete(market.id);
        return next;
      });
    } catch (err) {
      const message =
        err instanceof MarketsApiError
          ? `Claim failed (${err.status}): ${err.message}`
          : err instanceof Error
            ? err.message
            : "Claim failed";
      setClaimStatus((m) => new Map(m).set(market.id, message));
    }
  }

  return (
    <div className="mx-auto max-w-[1180px] pb-16">
      <section className="border-b border-[var(--line)] pb-10">
        <p className="mb-4 text-[12px] font-medium text-[var(--muted)]">
          History
        </p>
        <h1 className="max-w-[26ch] text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-[var(--ink)]">
          Resolved markets &amp; settlement proofs
        </h1>
        <p className="mt-5 max-w-[68ch] text-[15px] leading-relaxed text-[var(--muted)]">
          Once a market resolves, winners can claim their USDC payout. Each
          claim automatically emits a signed Portable Settlement Proof — the
          differentiator that makes Disburse the only prediction-market venue
          with auditable, third-party-verifiable payout receipts.
        </p>
      </section>

      <section className="mt-8 space-y-4">
        {!account && (
          <div className="rounded-md border border-dashed border-[var(--line)] p-6 text-center text-[13px] text-[var(--muted)]">
            Connect a wallet to see your claim history and eligible payouts.
          </div>
        )}

        {loadState === "loading" && (
          <p className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[13px] text-[var(--muted)]">
            Loading resolved markets…
          </p>
        )}
        {loadState === "error" && (
          <p className="rounded-lg border border-dashed border-[var(--red-text)]/40 bg-[var(--red-text)]/5 p-10 text-center text-[13px] text-[var(--red-text)]">
            {errorMsg}
          </p>
        )}
        {loadState === "ready" && rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[13px] text-[var(--muted)]">
            No resolved markets yet.
          </p>
        )}
        {loadState === "ready" &&
          rows.map((row) => {
            const claim = row.claim;
            const pspUid = claim?.pspUid;
            // Eligible = market resolved + user holds winning shares + no claim row yet.
            const claimable = !claim && row.claimableMicros > 0n;
            const statusMsg = claimStatus.get(row.market.id);
            const sharesLabel = claim
              ? (claim.sharesMicros / 1_000_000).toFixed(2)
              : (Number(row.claimableMicros) / 1_000_000).toFixed(2);
            const payoutMicros = claim ? claim.payoutMicros : Number(row.claimableMicros);
            return (
              <article
                key={row.market.id}
                className="flex flex-col gap-4 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5 md:flex-row md:items-start md:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11.5px] font-medium text-[var(--muted)]">
                    <span>Resolved</span>
                    <OutcomeBadge outcome={row.market.winningOutcome ?? "YES"} />
                    {row.market.resolvesAt && (
                      <>
                        <span>·</span>
                        <span>{new Date(row.market.resolvesAt).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                  <a
                    href={`/markets/${row.market.id}`}
                    onClick={(e) => onNavigate(e, `/markets/${row.market.id}`)}
                    className="text-[14px] font-medium leading-snug text-[var(--ink)] underline-offset-2 hover:underline"
                  >
                    {row.market.question}
                  </a>
                  {(claim || row.claimableMicros > 0n) && (
                    <p className="mt-2 text-[12px] font-medium text-[var(--muted)]">
                      Held: {sharesLabel} {row.outcome} shares
                    </p>
                  )}
                  {statusMsg && (
                    <p className="mt-2 font-mono text-[11px] text-[var(--red-text)]">{statusMsg}</p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-3">
                  {claim || row.claimableMicros > 0n ? (
                    <ClaimButton
                      claimable={claimable}
                      pspUid={pspUid}
                      payoutLabel={`$${microsToUsdcString(payoutMicros)}`}
                      onClaim={() => handleClaim(row.market, row.claimableMicros)}
                    />
                  ) : (
                    <span className="text-[11.5px] font-medium text-[var(--muted-soft)]">
                      No position
                    </span>
                  )}
                </div>
              </article>
            );
          })}
      </section>
    </div>
  );
}
