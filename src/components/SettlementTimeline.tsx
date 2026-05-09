/**
 * SettlementTimeline — Visual timeline showing the lifecycle of a payment
 * from request creation through verification and attestation.
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
    dot: "bg-emerald-400 border-emerald-400/30",
    line: "bg-emerald-400/40",
    label: "text-emerald-400",
    detail: "text-emerald-400/60",
  },
  active: {
    dot: "bg-blue-400 border-blue-400/30 animate-pulse",
    line: "bg-blue-400/20",
    label: "text-blue-400",
    detail: "text-blue-400/60",
  },
  pending: {
    dot: "bg-[#333] border-[#444]",
    line: "bg-[#1a1a1a]",
    label: "text-[#555]",
    detail: "text-[#444]",
  },
  failed: {
    dot: "bg-red-400 border-red-400/30",
    line: "bg-red-400/20",
    label: "text-red-400",
    detail: "text-red-400/60",
  },
};

export default function SettlementTimeline({ stages, compact = false }: Props) {
  return (
    <div className="border border-brand-border bg-brand-surface/30 backdrop-blur-sm p-5">
      <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted mb-4">
        Settlement Pipeline
      </h4>

      <div className={compact ? "flex items-center gap-2" : "space-y-0"}>
        {stages.map((stage, index) => {
          const styles = STATUS_STYLES[stage.status];
          const isLast = index === stages.length - 1;

          if (compact) {
            return (
              <div key={stage.label} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full border ${styles.dot}`} />
                <span className={`text-[10px] font-mono ${styles.label}`}>{stage.label}</span>
                {!isLast && (
                  <div className={`w-6 h-px ${styles.line}`} />
                )}
              </div>
            );
          }

          return (
            <div key={stage.label} className="flex gap-3">
              {/* Dot + line */}
              <div className="flex flex-col items-center">
                <div className={`w-2.5 h-2.5 rounded-full border-2 ${styles.dot} mt-1`} />
                {!isLast && (
                  <div className={`w-px flex-1 min-h-[24px] ${styles.line}`} />
                )}
              </div>

              {/* Content */}
              <div className="pb-4">
                <p className={`text-xs font-medium ${styles.label}`}>{stage.label}</p>
                {stage.detail && (
                  <p className={`text-[10px] font-mono mt-0.5 ${styles.detail}`}>{stage.detail}</p>
                )}
                {stage.timestamp && (
                  <p className="text-[9px] font-mono text-[#444] mt-0.5">{stage.timestamp}</p>
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
  }
): Stage[] {
  const stages: Stage[] = [
    {
      label: "Request Created",
      status: "complete",
      timestamp: timestamps?.created,
      detail: "QR payload generated",
    },
    {
      label: "Payment Submitted",
      status: timestamps?.submitted ? "complete" :
              lifecycle === "awaiting_wallet" ? "active" : "pending",
      timestamp: timestamps?.submitted,
      detail: lifecycle === "awaiting_wallet" ? "Awaiting wallet signature" : undefined,
    },
    {
      label: "Onchain Confirmation",
      status: status === "paid" || status === "failed" ? (status === "paid" ? "complete" : "failed") :
              lifecycle === "confirming" || lifecycle === "proving" || lifecycle === "settling" ? "active" : "pending",
      timestamp: timestamps?.confirmed,
      detail: lifecycle === "confirming" ? "Waiting for block confirmation" :
              lifecycle === "proving" ? "Generating Polymer proof" :
              lifecycle === "settling" ? "Relaying Arc settlement" : undefined,
    },
    {
      label: "Verification",
      status: status === "paid" ? "complete" :
              status === "failed" ? "failed" :
              lifecycle === "verified" ? "complete" : "pending",
      detail: status === "paid" ? "Receipt verified from chain data" :
              status === "failed" ? "Verification failed" : undefined,
    },
    {
      label: "Attestation",
      status: hasAttestation ? "complete" : "pending",
      timestamp: timestamps?.attested,
      detail: hasAttestation ? "VSR fingerprint recorded" : "Awaiting verification",
    },
  ];

  return stages;
}
