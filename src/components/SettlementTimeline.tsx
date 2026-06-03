/**
 * SettlementTimeline. Visual trace of a payment lifecycle from request
 * creation through verification and attestation.
 *
 * All colour tokens resolve from CSS variables so the component reads
 * correctly in both light and dark themes.
 */

type Stage = {
  label: string;
  status: "complete" | "active" | "pending" | "failed";
  timestamp?: string;
  detail?: string;
};

type Props = {
  stages: Stage[];
  compact?: boolean;
};

const STATUS_STYLES = {
  complete: {
    dot: "bg-[var(--primary-bg)] border-[var(--primary-bg)]",
    line: "bg-[var(--primary-bg)]/55",
    label: "text-[var(--ink)]",
    detail: "text-[var(--muted)]",
  },
  active: {
    dot: "bg-[var(--primary-bg)] border-[var(--primary-bg)]/40 shadow-[0_0_0_3px_var(--panel-accent)]",
    line: "bg-[var(--line)]",
    label: "text-[var(--ink)]",
    detail: "text-[var(--muted)]",
  },
  pending: {
    dot: "bg-transparent border-[var(--line-strong)]",
    line: "bg-[var(--line-soft)]",
    label: "text-[var(--muted)]",
    detail: "text-[var(--muted-soft)]",
  },
  failed: {
    dot: "bg-[var(--red-text)] border-[var(--red-text)]",
    line: "bg-[var(--red-text)]/35",
    label: "text-[var(--red-text)]",
    detail: "text-[var(--muted)]",
  },
} as const;

export default function SettlementTimeline({ stages, compact = false }: Props) {
  return (
    <div className="rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11.5px] font-medium text-[var(--muted)]">
          Settlement pipeline
        </p>
      </div>

      <div className={compact ? "flex flex-wrap items-center gap-x-2 gap-y-2" : "space-y-0"}>
        {stages.map((stage, index) => {
          const styles = STATUS_STYLES[stage.status];
          const isLast = index === stages.length - 1;

          if (compact) {
            return (
              <div key={stage.label} className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full border ${styles.dot}`} />
                <span className={`text-[11.5px] font-medium ${styles.label}`}>
                  {stage.label}
                </span>
                {!isLast && <div className={`h-px w-5 ${styles.line}`} />}
              </div>
            );
          }

          return (
            <div key={stage.label} className="flex gap-3.5">
              {/* Dot + rail */}
              <div className="flex flex-col items-center">
                <div
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full border ${styles.dot}`}
                  aria-hidden="true"
                />
                {!isLast && <div className={`min-h-[26px] w-px flex-1 ${styles.line}`} />}
              </div>

              {/* Content */}
              <div className="pb-4">
                <p className={`text-[12px] font-medium tracking-[-0.005em] ${styles.label}`}>
                  {stage.label}
                </p>
                {stage.detail && (
                  <p className={`mt-0.5 text-[11px] leading-relaxed ${styles.detail}`}>
                    {stage.detail}
                  </p>
                )}
                {stage.timestamp && (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--muted-soft)]">
                    {stage.timestamp}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Build timeline stages from payment request state.
 */
export function buildPaymentTimeline(
  status: string,
  lifecycle: string,
  hasAttestation: boolean,
  timestamps?: {
    created?: string;
    submitted?: string;
    confirmed?: string;
    attested?: string;
  },
): Stage[] {
  const stages: Stage[] = [
    {
      label: "Request created",
      status: "complete",
      timestamp: timestamps?.created,
      detail: "QR payload generated",
    },
    {
      label: "Payment submitted",
      status: timestamps?.submitted
        ? "complete"
        : lifecycle === "awaiting_wallet"
        ? "active"
        : "pending",
      timestamp: timestamps?.submitted,
      detail:
        lifecycle === "awaiting_wallet"
          ? "Awaiting wallet signature"
          : undefined,
    },
    {
      label: "Onchain confirmation",
      status:
        status === "paid" || status === "failed"
          ? status === "paid"
            ? "complete"
            : "failed"
          : lifecycle === "confirming" ||
            lifecycle === "proving" ||
            lifecycle === "settling"
          ? "active"
          : "pending",
      timestamp: timestamps?.confirmed,
      detail:
        lifecycle === "confirming"
          ? "Waiting for block confirmation"
          : lifecycle === "proving"
          ? "Generating Polymer proof"
          : lifecycle === "settling"
          ? "Relaying Arc settlement"
          : undefined,
    },
    {
      label: "Verification",
      status:
        status === "paid"
          ? "complete"
          : status === "failed"
          ? "failed"
          : lifecycle === "verified"
          ? "complete"
          : "pending",
      detail:
        status === "paid"
          ? "Receipt verified from chain data"
          : status === "failed"
          ? "Verification failed"
          : undefined,
    },
    {
      label: "Attestation",
      status: hasAttestation ? "complete" : "pending",
      timestamp: timestamps?.attested,
      detail: hasAttestation
        ? "VSR fingerprint recorded"
        : "Awaiting verification",
    },
  ];

  return stages;
}
