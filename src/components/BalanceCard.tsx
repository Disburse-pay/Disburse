import { motion } from "motion/react";
import { ArrowUpRight, QrCode, Send, Shield } from "lucide-react";
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
  const isEmpty = requestCount === 0;

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

      <div className="relative p-5 sm:p-6">
        {/* Top row */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
                Total requested volume
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--input-bg)] px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
                <Shield size={9} strokeWidth={2} className="text-[var(--green-text)]" />
                Non-custodial
              </span>
            </div>
            <h2 className="flex items-baseline gap-2 text-[2rem] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums sm:text-[2.5rem]">
              {totalVolume}
              <span className="text-[13px] font-normal text-[var(--muted)]">USDC</span>
            </h2>
            {isEmpty && (
              <p className="mt-1.5 text-[12px] text-[var(--muted)]">
                No requests yet. Create one to start tracking volume.
              </p>
            )}
          </div>

          {account && (
            <div className="shrink-0 text-right">
              <p className="mb-1 text-[9.5px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                Connected
              </p>
              <p className="font-mono text-[11.5px] text-[var(--ink)]">
                {account.slice(0, 6)}…{account.slice(-4)}
              </p>
            </div>
          )}
        </div>

        {/* Metrics */}
        <div className="mb-6 grid grid-cols-2 divide-x divide-y divide-[var(--line-soft)] overflow-hidden rounded-lg border border-[var(--line-soft)] md:grid-cols-4 md:divide-y-0">
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
            label="Settled"
            value={requestCount > 0 ? `${successRate}%` : "—"}
            tone={
              requestCount === 0
                ? "default"
                : successRate >= 80
                ? "accent"
                : successRate >= 50
                ? "warn"
                : "danger"
            }
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate("/qr-payments")}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary-bg)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--primary-text)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
          >
            <QrCode size={13} strokeWidth={2} />
            Create request
            <ArrowUpRight size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => onNavigate("/payments")}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--line-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <Send size={13} strokeWidth={1.75} />
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
    <div className="p-3">
      <p className="mb-1.5 text-[9.5px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <p className={`text-[15.5px] font-semibold tabular-nums ${TONE_CLASS[tone]}`}>
        {value}
        {unit && (
          <span className="ml-1 text-[10.5px] font-normal text-[var(--muted)]">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}
