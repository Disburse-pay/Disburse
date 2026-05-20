import { useState } from "react";
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
import SellSheet from "./SellSheet";

type Props = {
  market: Market;
  position: Position;
  onNavigate: NavigateHandler;
  /** Called after a successful sell so the parent can refresh positions. */
  onSold?: () => void;
};

/**
 * PositionCard — one position's row in the My Positions list.
 *
 * The user's "dominant" side is the one with more shares (typically they
 * bought one outcome cleanly, so it's just yes vs no, but partial fills or
 * complete-set holders can have both — we still show the bigger leg).
 *
 * Three jobs:
 *   1. Show the bet at a glance (shares, cost basis, mark value, PnL).
 *   2. Click to navigate to market detail.
 *   3. Sell button → expands an inline SellSheet to exit early. The SellSheet
 *      does the market sweep against the live book. Selling is ONLY here —
 *      TradePanel is BUY-only.
 *
 * Resolution surfaces the "Winner — claimable" hint and points the user at
 * `/markets/history`, which is where the claim button lives. We could embed
 * the claim button here too; left as a follow-up to avoid duplicating the
 * resolved-market read pipeline that HistoryPage already owns.
 */
export default function PositionCard({ market, position, onNavigate, onSold }: Props) {
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

  const [showSell, setShowSell] = useState(false);

  // Selling shares of a side requires the market still be open. If it's
  // resolved we hide the Sell button — the user should claim via History
  // instead of trying to exit a position that's already settled.
  const canSell = !isResolved && sharesMicros > 0;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5 transition-all hover:border-[var(--ink)]/40 hover:shadow-sm">
      <a
        href={href}
        onClick={(e) => onNavigate(e, href)}
        className="group flex items-start justify-between gap-3"
      >
        <p className="text-[14px] font-medium leading-snug text-[var(--ink)]">
          {market.question}
        </p>
        <ArrowRight className="h-4 w-4 flex-shrink-0 text-[var(--muted-soft)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ink)]" />
      </a>

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

      {/* Resolved → "Claim from History" hint. Open → Sell button. */}
      {isResolved && won && (
        <a
          href="/markets/history"
          onClick={(e) => onNavigate(e, "/markets/history")}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--ink)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--canvas)] hover:opacity-90"
        >
          Claim payout
        </a>
      )}
      {canSell && !showSell && (
        <button
          type="button"
          onClick={() => setShowSell(true)}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--ink)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink)] transition-colors hover:bg-[var(--ink)] hover:text-[var(--canvas)]"
        >
          Sell {outcome} shares
        </button>
      )}
      {canSell && showSell && (
        <SellSheet
          marketId={market.id}
          marketAddress={market.onchainAddress}
          outcome={outcome}
          sharesOwnedMicros={sharesMicros}
          onSold={onSold}
          onClose={() => setShowSell(false)}
        />
      )}
    </div>
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
