import type { MouseEvent } from "react";
import { Clock } from "lucide-react";
import {
  formatCloseCountdown,
  microsToProbability,
  microsToUsdcCompact,
  type Market
} from "../../lib/markets/types";
import type { NavigateHandler } from "../../lib/routing";
import OutcomeBadge from "./OutcomeBadge";

type Props = {
  market: Market;
  onNavigate: NavigateHandler;
};

export default function MarketCard({ market, onNavigate }: Props) {
  const href = `/markets/${market.id}`;
  const yesProb = microsToProbability(market.yesPriceMicros);
  const noProb = microsToProbability(market.noPriceMicros);
  const yesPct = Math.round(yesProb * 100);
  const isResolved = market.status === "resolved";

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => onNavigate(e, href);

  return (
    <a
      href={href}
      onClick={handleClick}
      className="group relative flex flex-col rounded-xl border border-[var(--line)] bg-[var(--paper)] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--ink)]/30 hover:shadow-[0_10px_28px_-14px_rgba(0,0,0,0.22)]"
    >
      {/* Top row: category pill + countdown / resolved */}
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full border border-[var(--line)] bg-[var(--paper-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
          {market.category}
        </span>
        {isResolved ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--muted)]">
            Resolved <OutcomeBadge outcome={market.winningOutcome ?? "YES"} />
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--muted)]">
            <Clock className="h-3 w-3" />
            {formatCloseCountdown(market.closesAt)}
          </span>
        )}
      </div>

      {/* Question — fixed two-line height keeps the grid aligned */}
      <p className="mb-4 line-clamp-2 min-h-[2.6em] text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[var(--ink)]">
        {market.question}
      </p>

      {!isResolved ? (
        <>
          {/* Probability headline */}
          <div className="mb-2 flex items-baseline gap-1.5">
            <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-[var(--ink)] tabular-nums">
              {yesPct}%
            </span>
            <span className="text-[12px] font-medium text-[var(--muted)]">yes</span>
          </div>

          {/* Split probability bar */}
          <div className="mb-4 flex h-1.5 overflow-hidden rounded-full bg-[var(--line-soft)]">
            <div
              className="bg-[var(--green-text)] transition-all duration-500"
              style={{ width: `${yesProb * 100}%` }}
            />
            <div
              className="bg-[var(--red-text)] transition-all duration-500"
              style={{ width: `${noProb * 100}%` }}
            />
          </div>

          {/* Yes / No price chips — the recognizable "market" affordance */}
          <div className="grid grid-cols-2 gap-2">
            <span className="flex items-center justify-center gap-1 rounded-lg border border-[var(--green-text)]/25 bg-[var(--green-text)]/10 py-2 text-[12.5px] font-semibold text-[var(--green-text)] transition-colors group-hover:bg-[var(--green-text)]/15">
              Yes <span className="tabular-nums">{Math.round(yesProb * 100)}¢</span>
            </span>
            <span className="flex items-center justify-center gap-1 rounded-lg border border-[var(--red-text)]/25 bg-[var(--red-text)]/10 py-2 text-[12.5px] font-semibold text-[var(--red-text)] transition-colors group-hover:bg-[var(--red-text)]/15">
              No <span className="tabular-nums">{Math.round(noProb * 100)}¢</span>
            </span>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2.5 text-[12.5px] text-[var(--muted)]">
          Settled — {market.winningOutcome ?? "YES"} won
        </div>
      )}

      {/* Footer: volume + open interest */}
      <div className="mt-4 flex items-center justify-between border-t border-[var(--line-soft)] pt-3 text-[11.5px] text-[var(--muted)]">
        <span className="tabular-nums">${microsToUsdcCompact(market.volumeMicros)} Vol</span>
        <span className="tabular-nums">${microsToUsdcCompact(market.openInterestMicros)} OI</span>
      </div>
    </a>
  );
}
