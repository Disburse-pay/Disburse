import { ArrowRight, QrCode, Send } from "lucide-react";
import type { Address } from "viem";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { useI18n } from "../lib/i18n";
import AnimatedNumber from "./ui/AnimatedNumber";

type Props = {
  totalVolume: number;
  verifiedVolume: number;
  pendingVolume: number;
  requestCount: number;
  receiptCount: number;
  account?: Address;
  onNavigate: (target: string) => void;
  trend?: { value: number }[];
  trendDeltaPct?: number;
};

/**
 * Headline metric card. Card-shell with calm border + paper background.
 * Monochrome (no green/red on values), tabular figures, large headline.
 * One indigo accent on the primary action.
 */
export default function BalanceCard({
  totalVolume,
  verifiedVolume,
  pendingVolume,
  requestCount,
  receiptCount,
  account: _account,
  onNavigate,
  trend,
  trendDeltaPct,
}: Props) {
  const { t, formatCurrency } = useI18n();
  const successRate =
    requestCount > 0 ? Math.round((receiptCount / requestCount) * 100) : 0;
  const isEmpty = requestCount === 0;
  const hasTrend = Array.isArray(trend) && trend.length > 1;
  const deltaKnown = typeof trendDeltaPct === "number" && Number.isFinite(trendDeltaPct);
  const deltaPositive = deltaKnown && (trendDeltaPct as number) >= 0;

  return (
    <section
      aria-label={t("portfolioSummary")}
      className="rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--card-shadow)]"
    >
      <div className="px-7 pt-7 pb-7">
        {/* Eyebrow */}
        <p className="text-[13px] text-[var(--muted)]">
          {t("requestedVolume")}
        </p>

        {/* Headline number + optional sparkline */}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <h2 className="text-[clamp(2.5rem,4.5vw,3.25rem)] font-medium leading-none tracking-[-0.028em] text-[var(--ink)]">
              <AnimatedNumber value={totalVolume} format={formatCurrency} />
            </h2>
            <p className="mt-3 text-[13px] text-[var(--muted)]">
              {isEmpty ? (
                t("noRequestsVolume")
              ) : (
                <>
                  Last 7 days
                  {deltaKnown && (
                    <>
                      {" · "}
                      <span className="text-[var(--ink)]">
                        {deltaPositive ? "+" : ""}
                        {(trendDeltaPct as number).toFixed(1)}%
                      </span>{" "}
                      <span>vs prior week</span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>

          {hasTrend && !isEmpty && (
            <div className="h-12 w-40 shrink-0 sm:w-52" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="balanceSpark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary-bg)" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="var(--primary-bg)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--primary-bg)"
                    strokeWidth={1.5}
                    fill="url(#balanceSpark)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate("/qr-payments")}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--primary-bg)] px-4 py-2 text-[13.5px] font-medium text-[color:var(--primary-text)] shadow-sm transition-colors hover:bg-[var(--primary-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
          >
            <QrCode size={14} strokeWidth={1.75} />
            {t("newRequest")}
            <ArrowRight size={13} strokeWidth={2} className="ml-0.5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate("/payments")}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-4 py-2 text-[13.5px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink-soft)] hover:bg-[var(--paper-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <Send size={14} strokeWidth={1.75} />
            {t("directTransfer")}
          </button>
        </div>
      </div>

      {/* Supporting metrics — single row split by hairlines. Monochrome. */}
      <dl className="grid grid-cols-2 border-t border-[var(--line)] md:grid-cols-4">
        <Metric label={t("verified")} value={formatCurrency(verifiedVolume)} />
        <Metric label={t("pending")} value={formatCurrency(pendingVolume)} bordered />
        <Metric label={t("requests")} value={String(requestCount)} bordered />
        <Metric
          label={t("settlementRate")}
          value={requestCount > 0 ? `${successRate}%` : "—"}
          bordered
        />
      </dl>
    </section>
  );
}

function Metric({
  label,
  value,
  bordered,
}: {
  label: string;
  value: string;
  bordered?: boolean;
}) {
  return (
    <div
      className={[
        "px-6 py-5",
        bordered ? "border-l border-[var(--line)] first:border-l-0" : "",
        "[&:nth-child(3)]:border-l-0 md:[&:nth-child(3)]:border-l [&:nth-child(n+3)]:border-t [&:nth-child(n+3)]:border-[var(--line)] md:[&:nth-child(n+3)]:border-t-0",
      ].join(" ")}
    >
      <dt className="text-[12.5px] text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 text-[19px] font-medium tracking-[-0.012em] text-[var(--ink)]">
        {value}
      </dd>
    </div>
  );
}
