import type { MouseEvent } from "react";
import { Clock, TrendingUp } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  formatCloseCountdown,
  microsToProbability,
  microsToUsdcCompact,
  probabilityToPercent,
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
  const isResolved = market.status === "resolved";

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => onNavigate(e, href);

  return (
    <a
      href={href}
      onClick={handleClick}
      className="group relative flex flex-col gap-4 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5 transition-all hover:border-[var(--ink)]/40 hover:shadow-sm"
    >
      {/* Top row: category + countdown or resolved badge */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
          {market.category}
        </span>
        {isResolved ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Resolved <OutcomeBadge outcome={market.winningOutcome ?? "YES"} />
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            <Clock className="h-3 w-3" />
            {formatCloseCountdown(market.closesAt)}
          </span>
        )}
      </div>

      {/* Question */}
      <p className="text-[14px] font-medium leading-snug text-[var(--ink)] group-hover:text-[var(--ink)]">
        {market.question}
      </p>

      {/* YES / NO probability bar */}
      {!isResolved && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em]">
            <span className="text-[var(--green-text)]">
              YES {probabilityToPercent(yesProb)}
            </span>
            <span className="text-[var(--red-text)]">
              NO {probabilityToPercent(noProb)}
            </span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--line-soft)]">
            <div
              className="bg-[var(--green-text)] transition-all"
              style={{ width: `${yesProb * 100}%` }}
            />
            <div
              className={cn("bg-[var(--red-text)] transition-all")}
              style={{ width: `${noProb * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer: volume + OI */}
      <div className="flex items-center justify-between border-t border-[var(--line-soft)] pt-3 text-[11px] text-[var(--muted)]">
        <span className="inline-flex items-center gap-1.5">
          <TrendingUp className="h-3 w-3" />
          ${microsToUsdcCompact(market.volumeMicros)} vol
        </span>
        <span className="font-mono">
          ${microsToUsdcCompact(market.openInterestMicros)} OI
        </span>
      </div>
    </a>
  );
}
