import { useEffect, useMemo, useState } from "react";
import type { Hash } from "viem";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import {
  fetchMarkets,
  fetchMyClaims,
  fetchMyFills,
  fetchPositions,
  MarketsApiError,
  recordClaim,
  type MyFill,
} from "../../lib/markets/api";
import { readClaimableShares, submitClaim } from "../../lib/markets/onchain";
import { subscribeMyPositions, subscribeMyClaims } from "../../lib/markets/realtime";
import {
  microsToUsdcString,
  type Market,
  type MarketClaim,
  type Outcome,
  type Position,
} from "../../lib/markets/types";
import type { NavigateHandler } from "../../lib/routing";
import PositionCard from "../../components/markets/PositionCard";
import OutcomeBadge from "../../components/markets/OutcomeBadge";
import ClaimButton from "../../components/markets/ClaimButton";

type Props = {
  onNavigate: NavigateHandler;
};

// ─── Resolved position row ─────────────────────────────────────────────
type ResolvedRow = {
  market: Market;
  position: Position;
  outcome: Outcome;
  claimableMicros: bigint;
  claim?: MarketClaim;
};

export default function MyPositionsPage({ onNavigate }: Props) {
  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();

  const [markets, setMarkets] = useState<Market[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [claims, setClaims] = useState<MarketClaim[]>([]);
  const [myFills, setMyFills] = useState<MyFill[]>([]);
  const [claimable, setClaimable] = useState<Map<string, bigint>>(new Map());
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [claimStatus, setClaimStatus] = useState<Map<string, string>>(new Map());

  // ─── Load data on account change ──────────────────────────────────────
  useEffect(() => {
    if (!account) {
      setLoadState("idle");
      setPositions([]);
      setMarkets([]);
      setClaims([]);
      setMyFills([]);
      setClaimable(new Map());
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    Promise.all([
      fetchPositions(account),
      fetchMarkets(),
      fetchMyClaims(account),
      fetchMyFills(account),
    ])
      .then(([pos, mkts, clm, fills]) => {
        if (cancelled) return;
        setPositions(pos);
        setMarkets(mkts);
        setClaims(clm);
        setMyFills(fills);
        setLoadState("ready");
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

  // ─── Realtime: position updates ───────────────────────────────────────
  useEffect(() => {
    if (!account || loadState !== "ready") return;
    return subscribeMyPositions(account, (updated) => {
      setPositions((prev) => {
        const idx = prev.findIndex((p) => p.marketId === updated.marketId);
        if (idx === -1) return [...prev, updated];
        const next = prev.slice();
        next[idx] = updated;
        return next;
      });
    });
  }, [account, loadState]);

  // ─── Realtime: claim updates ──────────────────────────────────────────
  useEffect(() => {
    if (!account) return;
    return subscribeMyClaims(account, (updated) => {
      setClaims((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        const next = idx === -1 ? [...prev, updated] : prev.slice();
        if (idx !== -1) next[idx] = updated;
        return next.sort(
          (a, b) => new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime()
        );
      });
    });
  }, [account]);

  // ─── Read claimable balances for resolved markets ─────────────────────
  useEffect(() => {
    if (!account || loadState !== "ready" || markets.length === 0) return;
    let cancelled = false;
    const claimedIds = new Set(claims.map((c) => c.marketId));
    const resolvedMarkets = markets.filter(
      (m) => m.status === "resolved" && !claimedIds.has(m.id)
    );
    const positionMarketIds = new Set(positions.map((p) => p.marketId));
    const eligibleMarkets = resolvedMarkets.filter((m) => positionMarketIds.has(m.id));

    const work = eligibleMarkets.map(async (m) => {
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
        // Swallow — balance read failure shows as "not eligible"
      }
    });
    void Promise.all(work);
    return () => {
      cancelled = true;
    };
  }, [account, loadState, markets, claims, positions]);

  // ─── Build active position rows ───────────────────────────────────────
  const activeRows = useMemo(() => {
    const marketById = new Map(markets.map((m) => [m.id, m] as const));
    return positions.flatMap((position) => {
      const market = marketById.get(position.marketId);
      if (!market || market.status === "resolved") return [];
      const totalShares = Math.max(0, position.yesSharesMicros) + Math.max(0, position.noSharesMicros);
      if (totalShares <= 0) return [];

      const yesCost = Math.floor((position.costBasisMicros * Math.max(0, position.yesSharesMicros)) / totalShares);
      const noCost = position.costBasisMicros - yesCost;
      const legs: Array<{
        position: Position;
        market: Market;
        outcome: Outcome;
        sharesMicros: number;
        costBasisMicros: number;
      }> = [];

      if (position.yesSharesMicros > 0) {
        legs.push({ position, market, outcome: "YES", sharesMicros: position.yesSharesMicros, costBasisMicros: yesCost });
      }
      if (position.noSharesMicros > 0) {
        legs.push({ position, market, outcome: "NO", sharesMicros: position.noSharesMicros, costBasisMicros: noCost });
      }
      return legs;
    });
  }, [positions, markets]);

  // ─── Build resolved position rows ─────────────────────────────────────
  const resolvedRows: ResolvedRow[] = useMemo(() => {
    const marketById = new Map(markets.map((m) => [m.id, m] as const));
    const claimByMarket = new Map(claims.map((c) => [c.marketId, c]));
    return positions
      .map((position) => {
        const market = marketById.get(position.marketId);
        if (!market || market.status !== "resolved") return null;
        const claim = claimByMarket.get(position.marketId);
        const outcome: Outcome = claim?.outcome ?? market.winningOutcome ?? "YES";
        const claimableBn = claim ? 0n : (claimable.get(market.id) ?? 0n);
        return { market, position, outcome, claimableMicros: claimableBn, claim } as ResolvedRow;
      })
      .filter((r): r is ResolvedRow => r !== null);
  }, [positions, markets, claims, claimable]);

  // ─── Portfolio summary ────────────────────────────────────────────────
  const portfolio = useMemo(() => {
    const marketById = new Map(markets.map((m) => [m.id, m] as const));

    let unrealizedPnl = 0;
    let totalCost = 0;
    for (const row of activeRows) {
      const priceMicros = row.outcome === "YES" ? row.market.yesPriceMicros : row.market.noPriceMicros;
      const markValue = Math.floor((row.sharesMicros * priceMicros) / 1_000_000);
      unrealizedPnl += markValue - row.costBasisMicros;
      totalCost += row.costBasisMicros;
    }

    // Realized = sum of realized PnL from positions + claim payouts
    let realizedPnl = 0;
    const seen = new Set<string>();
    for (const pos of positions) {
      const key = `${pos.userAddress}:${pos.marketId}`;
      if (!seen.has(key)) {
        realizedPnl += pos.realizedPnlMicros;
        seen.add(key);
      }
    }
    for (const claim of claims) {
      // Claim payout is pure realized gain (shares redeemed 1:1 for USDC)
      realizedPnl += claim.payoutMicros;
    }

    // Volume = sum of total_usdc across all user fills
    let totalVolume = 0;
    for (const fill of myFills) {
      totalVolume += fill.totalUsdcMicros;
    }

    // All-time positions = unique markets user traded in
    const uniqueMarkets = new Set(positions.map((p) => p.marketId));

    return {
      activeCount: activeRows.length,
      resolvedCount: resolvedRows.length,
      unrealizedPnl,
      realizedPnl,
      totalVolume,
      allTimePositions: uniqueMarkets.size,
    };
  }, [activeRows, resolvedRows, positions, claims, myFills, markets]);

  // ─── Claim handler ────────────────────────────────────────────────────
  async function handleClaim(market: Market, amount: bigint) {
    if (!account) return;
    if (amount <= 0n) return;
    setClaimStatus((m) => new Map(m).set(market.id, "Sign in wallet…"));
    try {
      const provider = await wallet.getEthereumProvider();
      if (!provider) throw new Error("Wallet provider not available.");

      const txHash: Hash = await submitClaim(provider, account, market.onchainAddress, amount);
      setClaimStatus((m) => new Map(m).set(market.id, "Indexing claim…"));

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

  // ─── Refresh helper for PositionCard sell ──────────────────────────────
  function refreshAll() {
    if (!account) return;
    void Promise.all([
      fetchPositions(account),
      fetchMarkets(),
      fetchMyFills(account),
    ]).then(([pos, mkts, fills]) => {
      setPositions(pos);
      setMarkets(mkts);
      setMyFills(fills);
    });
  }

  return (
    <div className="mx-auto max-w-[1180px] pb-16">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <section className="border-b border-[var(--line)] pb-10">
        <p className="mb-4 text-[12px] font-medium text-[var(--muted)]">
          Portfolio
        </p>
        <h1 className="max-w-[24ch] text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-[var(--ink)]">
          Your positions &amp; history
        </h1>

        {/* ── Portfolio summary stats ──────────────────────────────── */}
        {account && loadState === "ready" && (
          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--line-soft)] pt-6 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Active" value={portfolio.activeCount.toString()} />
            <Stat label="Resolved" value={portfolio.resolvedCount.toString()} />
            <Stat
              label="Unrealized P&L"
              value={`${portfolio.unrealizedPnl >= 0 ? "+" : ""}$${microsToUsdcString(portfolio.unrealizedPnl)}`}
              accent={portfolio.unrealizedPnl >= 0 ? "green" : "red"}
            />
            <Stat
              label="Realized P&L"
              value={`${portfolio.realizedPnl >= 0 ? "+" : ""}$${microsToUsdcString(portfolio.realizedPnl)}`}
              accent={portfolio.realizedPnl >= 0 ? "green" : "red"}
            />
            <Stat label="Total volume" value={`$${microsToUsdcString(portfolio.totalVolume)}`} />
            <Stat label="All-time markets" value={portfolio.allTimePositions.toString()} />
          </dl>
        )}
      </section>

      {/* ── Connect prompt / Loading / Error ──────────────────────── */}
      <section className="mt-8">
        {!account && (
          <div className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center">
            <p className="mb-4 text-[13px] text-[var(--muted)]">
              Connect a wallet to see your positions.
            </p>
            <button
              type="button"
              onClick={() => wallet.openAuthFlow?.()}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--primary-bg)] px-4 py-2 text-[12.5px] font-medium text-[color:var(--primary-text)] shadow-sm transition-colors hover:bg-[var(--primary-bg-hover)]"
            >
              Connect wallet
            </button>
          </div>
        )}

        {account && loadState === "loading" && (
          <p className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[13px] text-[var(--muted)]">
            Loading positions…
          </p>
        )}
        {account && loadState === "error" && (
          <p className="rounded-lg border border-dashed border-[var(--red-text)]/40 bg-[var(--red-text)]/5 p-10 text-center text-[13px] text-[var(--red-text)]">
            {errorMsg}
          </p>
        )}
      </section>

      {/* ── Active Positions ──────────────────────────────────────── */}
      {account && loadState === "ready" && (
        <>
          {activeRows.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-4 text-[12px] font-medium text-[var(--muted)]">
                Active positions
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {activeRows.map(({ position, market, outcome, sharesMicros, costBasisMicros }) => (
                  <PositionCard
                    key={`${market.id}:${outcome}`}
                    market={market}
                    position={position}
                    outcome={outcome}
                    sharesMicros={sharesMicros}
                    costBasisMicros={costBasisMicros}
                    onNavigate={onNavigate}
                    onSold={refreshAll}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Resolved Positions ────────────────────────────────── */}
          {resolvedRows.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-4 text-[12px] font-medium text-[var(--muted)]">
                Resolved positions
              </h2>
              <div className="space-y-4">
                {resolvedRows.map((row) => {
                  const claim = row.claim;
                  const pspUid = claim?.pspUid;
                  const statusMsg = claimStatus.get(row.market.id);
                  const won = row.market.winningOutcome === row.outcome;
                  const sharesHeld = row.outcome === "YES"
                    ? row.position.yesSharesMicros
                    : row.position.noSharesMicros;
                  // The user is "claimable" when they won AND haven't claimed yet.
                  // We don't require the on-chain `claimableMicros` read to be > 0n
                  // because that call can race (e.g. position cached before the
                  // resolution attestation lands, or RPC hiccup). The button itself
                  // re-reads the on-chain balance at submit time, so we'd rather
                  // let users try than gate them behind a stale read.
                  const canAttemptClaim = !claim && won && sharesHeld > 0;
                  // If the user has on-chain share balance, use it as the payout
                  // hint; otherwise fall back to micros held in our cache so the
                  // label isn't blank.
                  const fallbackPayout = Number(row.claimableMicros) || sharesHeld;
                  const payoutMicros = claim ? claim.payoutMicros : fallbackPayout;

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
                          <span>·</span>
                          <span className={won ? "text-[var(--green-text)]" : "text-[var(--red-text)]"}>
                            {won ? "Won" : "Lost"}
                          </span>
                        </div>
                        <a
                          href={`/markets/${row.market.id}`}
                          onClick={(e) => onNavigate(e, `/markets/${row.market.id}`)}
                          className="text-[14px] font-medium leading-snug text-[var(--ink)] underline-offset-2 hover:underline"
                        >
                          {row.market.question}
                        </a>
                        {sharesHeld > 0 && (
                          <p className="mt-2 text-[12px] font-medium text-[var(--muted)]">
                            Held: {(sharesHeld / 1_000_000).toFixed(2)} {row.outcome} shares
                            {claim && (
                              <span className="ml-2 text-[var(--green-text)]">
                                · Payout ${microsToUsdcString(claim.payoutMicros)}
                              </span>
                            )}
                          </p>
                        )}
                        {statusMsg && (
                          <p className="mt-2 font-mono text-[11px] text-[var(--red-text)]">{statusMsg}</p>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-3">
                        {claim || canAttemptClaim ? (
                          <ClaimButton
                            claimable={canAttemptClaim}
                            pspUid={pspUid}
                            payoutLabel={`$${microsToUsdcString(payoutMicros)}`}
                            onClaim={async () => {
                              // Prefer the cached on-chain amount; if it's zero
                              // (race), re-read at submit time to pick up the
                              // latest claimable balance.
                              let amount = row.claimableMicros;
                              if (amount === 0n && account) {
                                try {
                                  amount = await readClaimableShares(account, row.market);
                                } catch {
                                  // Fall through with 0n — handleClaim will
                                  // surface a clear error if the chain rejects.
                                }
                              }
                              await handleClaim(row.market, amount);
                            }}
                          />
                        ) : (
                          <span className="text-[11.5px] font-medium text-[var(--muted-soft)]">
                            No payout
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Empty state ───────────────────────────────────────── */}
          {activeRows.length === 0 && resolvedRows.length === 0 && (
            <section className="mt-8">
              <p className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[13px] text-[var(--muted)]">
                No positions yet. Open a market and place a trade to begin.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: "green" | "red";
}) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[11.5px] font-medium text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={
          accent === "green"
            ? "truncate text-[13px] font-medium text-[var(--green-text)]"
            : accent === "red"
              ? "truncate text-[13px] font-medium text-[var(--red-text)]"
              : "truncate text-[13px] font-medium text-[var(--ink)]"
        }
      >
        {value}
      </dd>
    </div>
  );
}
