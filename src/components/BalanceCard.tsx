import { ArrowRight, QrCode, Send } from "lucide-react";
import type { Address } from "viem";
import { useI18n } from "../lib/i18n";

type Props = {
  totalVolume: number;
  verifiedVolume: number;
  pendingVolume: number;
  requestCount: number;
  receiptCount: number;
  account?: Address;
  onNavigate: (target: string) => void;
};

/**
 * Headline metric card for the dashboard.
 *
 * Design intent. Institutional, calm. One large number, a small group of
 * supporting metrics, two actions. No gradient highlights, no decorative
 * rings, no glow.
 */
export default function BalanceCard({
  totalVolume,
  verifiedVolume,
  pendingVolume,
  requestCount,
  receiptCount,
  account,
  onNavigate,
}: Props) {
  const { t, formatCurrency } = useI18n();
  const successRate =
    requestCount > 0 ? Math.round((receiptCount / requestCount) * 100) : 0;
  const isEmpty = requestCount === 0;

  return (
    <section
      aria-label={t("portfolioSummary")}
      className="rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]"
    >
      <div className="px-6 pt-6 pb-5">
        {/* Eyebrow row */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
              {t("requestedVolume")}
            </p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {t("requestedVolumeHint")}
            </p>
          </div>

          {account && (
            <div className="shrink-0 rounded-sm border border-[var(--line)] bg-[var(--input-bg)] px-2.5 py-1.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
                {t("signingAccount")}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-[var(--ink)]">
                {account.slice(0, 6)}&#8201;&#8201;{account.slice(-4)}
              </p>
            </div>
          )}
        </div>

        {/* Primary number */}
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[2.25rem] font-semibold leading-none tracking-[-0.025em] text-[var(--ink)] tabular-nums sm:text-[2.75rem]">
            {formatCurrency(totalVolume)}
          </h2>
        </div>
        {isEmpty && (
          <p className="mt-2 text-[12px] text-[var(--muted)]">
            {t("noRequestsVolume")}
          </p>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate("/qr-payments")}
            className="inline-flex items-center gap-1.5 rounded-[var(--btn-radius)] bg-[var(--primary-bg)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
          >
            <QrCode size={13} strokeWidth={1.75} />
            {t("newRequest")}
            <ArrowRight size={12} strokeWidth={2} className="ml-0.5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate("/payments")}
            className="inline-flex items-center gap-1.5 rounded-[var(--btn-radius)] border border-[var(--line)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--line-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <Send size={13} strokeWidth={1.75} />
            {t("directTransfer")}
          </button>
        </div>
      </div>

      {/* Supporting metrics. Single row, hairline divider, no rounded inner box. */}
      <dl className="grid grid-cols-2 border-t border-[var(--line)] md:grid-cols-4">
        <Metric label={t("verified")} value={formatCurrency(verifiedVolume)} tone="accent" />
        <Metric
          label={t("pending")}
          value={formatCurrency(pendingVolume)}
          tone="neutral"
          bordered
        />
        <Metric
          label={t("requests")}
          value={String(requestCount)}
          tone="neutral"
          bordered
        />
        <Metric
          label={t("settlementRate")}
          value={requestCount > 0 ? `${successRate}%` : "--"}
          tone={
            requestCount === 0
              ? "neutral"
              : successRate >= 80
              ? "accent"
              : successRate >= 50
              ? "warn"
              : "danger"
          }
          bordered
        />
      </dl>
    </section>
  );
}

type Tone = "accent" | "warn" | "danger" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  accent: "text-[var(--green-text)]",
  warn: "text-[var(--yellow-text)]",
  danger: "text-[var(--red-text)]",
  neutral: "text-[var(--ink)]",
};

function Metric({
  label,
  value,
  unit,
  tone,
  bordered,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: Tone;
  bordered?: boolean;
}) {
  return (
    <div
      className={[
        "px-5 py-4",
        bordered ? "border-l border-[var(--line)] first:border-l-0" : "",
        "[&:nth-child(3)]:border-l-0 md:[&:nth-child(3)]:border-l [&:nth-child(n+3)]:border-t [&:nth-child(n+3)]:border-[var(--line)] md:[&:nth-child(n+3)]:border-t-0",
      ].join(" ")}
    >
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`text-[15px] font-semibold tabular-nums ${TONE_CLASS[tone]}`}>
          {value}
        </span>
        {unit && (
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {unit}
          </span>
        )}
      </dd>
    </div>
  );
}
