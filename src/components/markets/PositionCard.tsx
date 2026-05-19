import { type MouseEvent } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  microsToProbability,
  microsToShares,
  microsToUsdcString,
  probabilityToPercent,
  type Market,
  type Position
} from "../../lib/markets/types";
import type { NavigateHandler } from "../../lib/routing";
import OutcomeBadge from "./OutcomeBadge";

type Props = {
  market: Market;
  position: Position;
  onNavigate: NavigateHandler;
};

export default function PositionCard({ market, position, onNavigate }: Props) {
  const isYes = position.yesSharesMicros > position.noSharesMicros;
  const sharesMicros = isYes ? position.yesSharesMicros : position.noSharesMicros;
  const outcome = isYes ? "YES" : "NO";
  const priceMicros = isYes ? market.yesPriceMicros : market.noPriceMicros;
  const valueMicros = Math.floor((sharesMicros * priceMicros) / 1_000_000);
  const pnlMicros = valueMicros - position.costBasisMicros;
  const pnlPct = position.costBasisMicros > 0 ? (pnlMicros / position.costBasisMicros) * 100 : 0;
  const positive = pnlMicros >= 0;
  const isResolved = market.status === "resolved";
  const won = isResolved && market.winningOutcome === outcome;
  const href = `/markets/${market.id}`;

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => onNavigate(e, href);

  return (
    <a
      href={href}
      onClick={handleClick}
      className="group flex flex-col gap-4 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5 transition-all hover:border-[var(--ink)]/40 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-medium leading-snug text-[var(--ink)]">
          {market.question}
        </p>
        <ArrowRight className="h-4 w-4 flex-shrink-0 text-[var(--muted-soft)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ink)]" />
      </div>

      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
        <OutcomeBadge outcome={outcome} />
        <span>·</span>
        <span>{microsToShares(sharesMicros)} shares</span>
        <span>·</span>
        <span>
          {isResolved
            ? won
              ? "Winner — claimable"
              : "Lost"
            : `${probabilityToPercent(microsToProbability(priceMicros))} implied`}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-4 border-t border-[var(--line-soft)] pt-4">
        <StatCell label="Cost basis" value={`$${microsToUsdcString(position.costBasisMicros)}`} />
        <StatCell
          label={isResolved ? "Payout" : "Value (mark)"}
          value={`$${microsToUsdcString(isResolved && won ? sharesMicros : valueMicros)}`}
        />
        <StatCell
          label="P&L"
          value={`${positive ? "+" : ""}$${microsToUsdcString(pnlMicros)}`}
          subValue={`${positive ? "+" : ""}${pnlPct.toFixed(1)}%`}
          accent={positive ? "green" : "red"}
        />
      </dl>
    </a>
  );
}

function StatCell({
  label,
  value,
  subValue,
  accent
}: {
  label: string;
  value: string;
  subValue?: string;
  accent?: "green" | "red";
}) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={cn(
          "truncate text-[13px] font-medium",
          accent === "green" && "text-[var(--green-text)]",
          accent === "red" && "text-[var(--red-text)]",
          !accent && "text-[var(--ink)]"
        )}
      >
        {value}
        {subValue && (
          <span className="ml-1 font-mono text-[10px] opacity-80">{subValue}</span>
        )}
      </dd>
    </div>
  );
}
