import { motion } from "motion/react";
import { ArrowUpRight, Send } from "lucide-react";
import type { Address } from "viem";

type Props = {
  totalVolume: string;
  verifiedVolume: string;
  pendingVolume: string;
  requestCount: number;
  receiptCount: number;
  account?: Address;
  onNavigate: (target: string) => void;
};

export default function BalanceCard({
  totalVolume,
  verifiedVolume,
  pendingVolume,
  requestCount,
  receiptCount,
  account,
  onNavigate,
}: Props) {
  const successRate =
    requestCount > 0 ? Math.round((receiptCount / requestCount) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)]"
    >
      {/* Quiet highlight along the top edge — no giant blur blob. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary-bg)]/40 to-transparent"
        aria-hidden="true"
      />

      <div className="relative p-6 sm:p-7">
        {/* Top row */}
        <div className="mb-7 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
              Total requested volume
            </p>
            <h2 className="flex items-baseline gap-2 text-[2.25rem] font-semibold tracking-tight text-[var(--ink)] tabular-nums sm:text-[2.75rem]">
              {totalVolume}
              <span className="text-base font-normal text-[var(--muted)]">USDC</span>
            </h2>
          </div>

          {account && (
            <div className="shrink-0 text-right">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                Connected
              </p>
              <p className="font-mono text-xs text-[var(--ink)]">
                {account.slice(0, 6)}…{account.slice(-4)}
              </p>
            </div>
          )}
        </div>

        {/* Metrics — dividers, not nested borders */}
        <div className="mb-7 grid grid-cols-2 divide-x divide-y divide-[var(--line-soft)] overflow-hidden rounded-lg border border-[var(--line-soft)] md:grid-cols-4 md:divide-y-0">
          <MetricCell
            label="Verified"
            value={verifiedVolume}
            unit="USDC"
            tone="accent"
          />
          <MetricCell
            label="Pending"
            value={pendingVolume}
            unit="USDC"
            tone="info"
          />
          <MetricCell
            label="Requests"
            value={String(requestCount)}
            tone="default"
          />
          <MetricCell
            label="Success rate"
            value={`${successRate}%`}
            tone={successRate >= 80 ? "accent" : successRate >= 50 ? "warn" : "danger"}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate("/qr-payments")}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary-bg)] px-4 py-2 text-[13px] font-medium text-[var(--primary-text)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
          >
            Create request
            <ArrowUpRight size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => onNavigate("/payments")}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] px-4 py-2 text-[13px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--line-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <Send size={14} strokeWidth={1.75} />
            Direct send
          </button>
        </div>
      </div>
    </motion.div>
  );
}

type Tone = "accent" | "info" | "warn" | "danger" | "default";

const TONE_CLASS: Record<Tone, string> = {
  accent: "text-[var(--green-text)]",
  info: "text-[var(--blue-text)]",
  warn: "text-[var(--yellow-text)]",
  danger: "text-[var(--red-text)]",
  default: "text-[var(--ink)]",
};

function MetricCell({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: Tone;
}) {
  return (
    <div className="p-3.5">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <p className={`text-[17px] font-semibold tabular-nums ${TONE_CLASS[tone]}`}>
        {value}
        {unit && (
          <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}
