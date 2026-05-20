import { useEffect, useMemo, useState } from "react";
import type { Hash } from "viem";
import { ArrowLeft, Calendar, Hash as HashIcon } from "lucide-react";
import { useDisburseDynamicWallet } from "../../lib/dynamic";
import {
  aggregateOrderbook,
  fetchFills,
  fetchMarketDetail,
  MarketsApiError,
  recordClaim,
  type RawOpenOrder
} from "../../lib/markets/api";
import { readClaimableShares, submitClaim } from "../../lib/markets/onchain";
import {
  subscribeMarketFills,
  subscribeMarketOrders
} from "../../lib/markets/realtime";
import {
  formatCloseCountdown,
  microsToProbability,
  microsToUsdcCompact,
  microsToUsdcString,
  probabilityToPercent,
  type Fill,
  type Market,
  type Outcome
} from "../../lib/markets/types";
import type { NavigateHandler } from "../../lib/routing";
import OrderbookDepth from "../../components/markets/OrderbookDepth";
import PriceChart from "../../components/markets/PriceChart";
import TradePanel from "../../components/markets/TradePanel";
import OutcomeBadge from "../../components/markets/OutcomeBadge";
import ClaimButton from "../../components/markets/ClaimButton";

type Props = {
  marketId: string | undefined;
  onNavigate: NavigateHandler;
};

export default function MarketDetailPage({ marketId, onNavigate }: Props) {
  const [market, setMarket] = useState<Market | undefined>();
  const [rawOrders, setRawOrders] = useState<RawOpenOrder[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound" | "error">(
    "loading"
  );
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<Outcome>("YES");

  // Load market + orderbook + fills on mount / id change.
  useEffect(() => {
    if (!marketId) {
      setLoadState("notfound");
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    Promise.all([fetchMarketDetail(marketId), fetchFills(marketId, 200)])
      .then(([{ market, rawOrders }, fills]) => {
        if (cancelled) return;
        setMarket(market);
        setRawOrders(rawOrders);
        setFills(fills);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof MarketsApiError && err.status === 404) {
          setLoadState("notfound");
          return;
        }
        const message =
          err instanceof MarketsApiError
            ? `Failed to load market (${err.status}): ${err.message}`
            : err instanceof Error
              ? err.message
              : "Unknown error";
        setErrorMsg(message);
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [marketId]);

  // Subscribe to order + fill realtime once the market is loaded.
  // We apply diffs in-place rather than refetching because the page is the
  // hot path for trading UX — a brief loading flash on every order would
  // make the depth chart unusable.
  useEffect(() => {
    if (!marketId || loadState !== "ready") return;

    const unsubOrders = subscribeMarketOrders(marketId, (change) => {
      setRawOrders((prev) => applyOrderChange(prev, change));
    });
    const unsubFills = subscribeMarketFills(marketId, (fill) => {
      // Newest first — matches `fetchFills` ordering.
      setFills((prev) => (prev.some((f) => f.id === fill.id) ? prev : [fill, ...prev]));
    });
    return () => {
      unsubOrders();
      unsubFills();
    };
  }, [marketId, loadState]);

  // Re-aggregate when raw orders or selected outcome changes.
  const orderbook = useMemo(
    () => (market ? aggregateOrderbook(rawOrders, market.id, outcome) : undefined),
    [rawOrders, market, outcome]
  );

  if (loadState === "loading") {
    return (
      <div className="mx-auto max-w-[1180px] pb-16">
        <BackLink onNavigate={onNavigate} />
        <p className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[13px] text-[var(--muted)]">
          Loading market…
        </p>
      </div>
    );
  }
  if (loadState === "notfound" || !market) {
    return (
      <div className="mx-auto max-w-[1180px] pb-16">
        <BackLink onNavigate={onNavigate} />
        <p className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[13px] text-[var(--muted)]">
          Market not found.
        </p>
      </div>
    );
  }
  if (loadState === "error") {
    return (
      <div className="mx-auto max-w-[1180px] pb-16">
        <BackLink onNavigate={onNavigate} />
        <p className="rounded-lg border border-dashed border-[var(--red-text)]/40 bg-[var(--red-text)]/5 p-10 text-center text-[13px] text-[var(--red-text)]">
          {errorMsg}
        </p>
      </div>
    );
  }

  const yesProb = microsToProbability(market.yesPriceMicros);
  const noProb = microsToProbability(market.noPriceMicros);
  const isResolved = market.status === "resolved";

  return (
    <div className="mx-auto max-w-[1180px] pb-16">
      <BackLink onNavigate={onNavigate} />

      {/* Header */}
      <section className="border-b border-[var(--line)] pb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
            {market.category}
          </span>
          <span className="text-[var(--muted-soft)]">·</span>
          {isResolved ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
              Resolved <OutcomeBadge outcome={market.winningOutcome ?? "YES"} />
            </span>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
              Closes in {formatCloseCountdown(market.closesAt)}
            </span>
          )}
        </div>

        <h1 className="max-w-[40ch] text-[clamp(1.5rem,3vw,2rem)] font-semibold leading-[1.15] tracking-tight text-[var(--ink)]">
          {market.question}
        </h1>

        {market.description && (
          <p className="mt-4 max-w-[68ch] text-[14px] leading-relaxed text-[var(--muted)]">
            {market.description}
          </p>
        )}

        {/* Price summary */}
        <dl className="mt-6 grid grid-cols-2 gap-6 border-t border-[var(--line-soft)] pt-5 sm:grid-cols-4">
          <Stat
            label="YES price"
            value={`$${microsToUsdcString(market.yesPriceMicros)}`}
            accent="green"
          />
          <Stat
            label="NO price"
            value={`$${microsToUsdcString(market.noPriceMicros)}`}
            accent="red"
          />
          <Stat label="Implied YES" value={probabilityToPercent(yesProb)} />
          <Stat label="Implied NO" value={probabilityToPercent(noProb)} />
        </dl>

        <dl className="mt-4 grid grid-cols-2 gap-6 text-[11px] text-[var(--muted)] sm:grid-cols-4">
          <Meta icon={Calendar} label="Closes" value={new Date(market.closesAt).toLocaleDateString()} />
          <Meta
            icon={HashIcon}
            label="Contract"
            value={`${market.onchainAddress.slice(0, 6)}…${market.onchainAddress.slice(-4)}`}
          />
          <Meta
            label="Volume"
            value={`$${microsToUsdcCompact(market.volumeMicros)}`}
          />
          <Meta
            label="Open interest"
            value={`$${microsToUsdcCompact(market.openInterestMicros)}`}
          />
        </dl>
      </section>

      {/* Main grid: chart + orderbook left, trade panel right */}
      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <PriceChart fills={fills} />
          {orderbook && (
            <OrderbookDepth
              orderbook={orderbook}
              outcome={outcome}
              onOutcomeChange={setOutcome}
            />
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          {isResolved ? (
            <ResolvedPanel market={market} onNavigate={onNavigate} />
          ) : (
            <TradePanel
              market={market}
              outcome={outcome}
              onOutcomeChange={setOutcome}
              rawOrders={rawOrders}
            />
          )}
        </aside>
      </section>
    </div>
  );
}

// Apply a single realtime change to the raw orders list. Keeps `rawOrders`
// in lockstep with the server without a refetch round-trip — the aggregator
// downstream will re-fold from the new array on the next render.
function applyOrderChange(
  prev: RawOpenOrder[],
  change: { kind: "INSERT" | "UPDATE" | "DELETE"; order: RawOpenOrder }
): RawOpenOrder[] {
  if (change.kind === "DELETE") {
    return prev.filter((o) => o.hash !== change.order.hash);
  }
  // Drop terminal-state orders so they don't pollute depth. The aggregator
  // already filters by `remaining > 0`, but pruning here keeps the array
  // small as a market accumulates history.
  const isClosed =
    change.order.status === "filled" ||
    change.order.status === "cancelled" ||
    change.order.status === "expired";
  if (isClosed) {
    return prev.filter((o) => o.hash !== change.order.hash);
  }
  const idx = prev.findIndex((o) => o.hash === change.order.hash);
  if (idx === -1) return [...prev, change.order];
  const next = prev.slice();
  next[idx] = change.order;
  return next;
}

/**
 * ResolvedPanel — replaces the TradePanel on resolved markets.
 *
 * Mirrors the read+claim flow that HistoryPage already implements, but
 * scoped to this single market so winners can claim directly from the
 * market page without a context switch. Behaviour:
 *   1. If wallet is disconnected → render a "Connect" CTA.
 *   2. If wallet is connected and holds winning shares → render the
 *      ClaimButton wired to Market.claim().
 *   3. Otherwise → render a "No claimable shares" line.
 *
 * We do NOT detect prior claims here — once the tx lands the user's
 * winning-share balance goes to zero and case (3) takes over naturally.
 * For a polished PSP display history, the canonical surface remains
 * /markets/history.
 */
function ResolvedPanel({
  market,
  onNavigate
}: {
  market: Market;
  onNavigate: NavigateHandler;
}) {
  const wallet = useDisburseDynamicWallet();
  const account = wallet.getAccount?.();
  const [claimableMicros, setClaimableMicros] = useState<bigint>(0n);
  const [statusMsg, setStatusMsg] = useState<string | undefined>();
  const [didClaim, setDidClaim] = useState(false);

  // Re-read the winning-share balance whenever the wallet changes (or after
  // a claim flips it to zero).
  useEffect(() => {
    if (!account) {
      setClaimableMicros(0n);
      return;
    }
    let cancelled = false;
    readClaimableShares(account, market)
      .then((bal) => {
        if (!cancelled) setClaimableMicros(bal);
      })
      .catch(() => {
        if (!cancelled) setClaimableMicros(0n);
      });
    return () => {
      cancelled = true;
    };
  }, [account, market, didClaim]);

  async function handleClaim() {
    if (!account || claimableMicros <= 0n) return;
    setStatusMsg("Sign in wallet…");
    try {
      const provider = await wallet.getEthereumProvider();
      if (!provider) throw new Error("Wallet provider not available. Reconnect and try again.");

      const txHash: Hash = await submitClaim(
        provider,
        account,
        market.onchainAddress,
        claimableMicros
      );
      setStatusMsg("Indexing claim…");
      await recordClaim({ marketId: market.id, txHash });
      setStatusMsg(undefined);
      setDidClaim(true);
    } catch (err) {
      const message =
        err instanceof MarketsApiError
          ? `Claim failed (${err.status}): ${err.message}`
          : err instanceof Error
            ? err.message
            : "Claim failed";
      setStatusMsg(message);
    }
  }

  const payoutLabel = `$${microsToUsdcString(Number(claimableMicros))}`;

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
          Resolved · <OutcomeBadge outcome={market.winningOutcome ?? "YES"} />
        </p>
      </div>

      {!account ? (
        <>
          <p className="mb-4 text-[13px] text-[var(--muted)]">
            Connect a wallet to check whether you have winning shares to
            claim on this market.
          </p>
          <button
            type="button"
            onClick={() => wallet.openAuthFlow?.()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--ink)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--canvas)] hover:opacity-90"
          >
            Connect to claim
          </button>
        </>
      ) : claimableMicros > 0n ? (
        <>
          <p className="mb-3 text-[13px] text-[var(--muted)]">
            You hold {microsToUsdcString(Number(claimableMicros))}{" "}
            {market.winningOutcome ?? "YES"} shares from the winning side.
            Claim to redeem them 1:1 for USDC.
          </p>
          <div className="flex justify-end">
            <ClaimButton
              claimable={!statusMsg}
              payoutLabel={payoutLabel}
              onClaim={handleClaim}
            />
          </div>
          {statusMsg && (
            <p className="mt-3 break-all font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
              {statusMsg}
            </p>
          )}
        </>
      ) : (
        <p className="text-[13px] text-[var(--muted)]">
          No winning shares to claim. See{" "}
          <a
            href="/markets/history"
            onClick={(e) => onNavigate(e, "/markets/history")}
            className="text-[var(--ink)] underline-offset-2 hover:underline"
          >
            History
          </a>{" "}
          for past payouts.
        </p>
      )}
    </div>
  );
}

function BackLink({ onNavigate }: { onNavigate: NavigateHandler }) {
  return (
    <a
      href="/markets"
      onClick={(e) => onNavigate(e, "/markets")}
      className="mb-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
    >
      <ArrowLeft className="h-3 w-3" /> All markets
    </a>
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
      <dt className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={
          accent === "green"
            ? "text-[18px] font-semibold tracking-tight text-[var(--green-text)]"
            : accent === "red"
              ? "text-[18px] font-semibold tracking-tight text-[var(--red-text)]"
              : "text-[18px] font-semibold tracking-tight text-[var(--ink)]"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function Meta({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon?: typeof Calendar;
}) {
  return (
    <div className="flex items-center gap-2 truncate">
      {Icon && <Icon className="h-3 w-3 text-[var(--muted-soft)]" />}
      <span className="font-mono uppercase tracking-[0.14em] text-[var(--muted-soft)]">
        {label}
      </span>
      <span className="truncate font-mono text-[var(--ink)]">{value}</span>
    </div>
  );
}
