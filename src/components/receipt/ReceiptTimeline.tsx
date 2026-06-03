import { CheckCircle2, FileText, Layers, ShieldCheck, Wallet, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { getCrossChainLabel } from "../../lib/crosschain";
import { isCrossChainPaymentRequest, type PaymentRequest, type Receipt } from "../../lib/payments";
import { useReceipt } from "./context";

type NodeStatus = "complete" | "active" | "pending" | "failed";

type Stage = {
  id: string;
  idx: number;
  status: NodeStatus;
  icon: ReactNode;
  label: string;
  sub: string;
  time?: string;
};

/**
 * Middle section of the unified Receipt. Renders settlement stages inline
 * (no separate card wrapper, no duplicate header — the request's label and
 * amount already live in ReceiptSummary).
 *
 * For Arc-native (same-chain) requests: 3 nodes. Cross-chain: 5 nodes.
 */
export default function ReceiptTimeline() {
  const { request, receipt } = useReceipt();
  const stages = buildStages(request, receipt);
  const isCrossChain = isCrossChainPaymentRequest(request);
  const route = isCrossChain
    ? `Cross-chain · ${getCrossChainLabel(request.settlement?.sourceChainId)} → Arc`
    : "Arc Testnet · same-chain";

  return (
    <div className="px-5 pb-5 pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-[var(--muted)]">
          Settlement timeline
        </p>
        <p className="text-[11px] text-[var(--muted)]">{route}</p>
      </div>

      <div className="mt-4 grid items-start" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((stage, i) => (
          <PipelineNode key={stage.id} stage={stage} next={stages[i + 1]} isLast={i === stages.length - 1} />
        ))}
      </div>
    </div>
  );
}

function PipelineNode({ stage, next, isLast }: { stage: Stage; next?: Stage; isLast: boolean }) {
  const isComplete = stage.status === "complete";
  const isActive = stage.status === "active";
  const isFailed = stage.status === "failed";
  const color = isFailed
    ? "var(--red-text)"
    : isComplete
    ? "var(--green-text)"
    : isActive
    ? "var(--blue-text)"
    : "var(--muted)";
  const ringBg = isFailed
    ? "var(--red-bg)"
    : isComplete
    ? "var(--green-bg)"
    : isActive
    ? "var(--blue-bg)"
    : "var(--paper)";
  const connectorComplete = isComplete && next && (next.status === "complete" || next.status === "active");

  return (
    <div className="relative flex flex-col items-center px-1.5 text-center">
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute"
          style={{
            top: 22,
            left: "calc(50% + 22px)",
            right: "calc(-50% + 22px)",
            height: 1,
            background: connectorComplete ? "var(--green-text)" : "var(--line)",
            opacity: connectorComplete ? 0.55 : 1,
          }}
        >
          {isActive && next && (
            <span
              style={{
                position: "absolute",
                top: -2.5,
                left: 0,
                width: 5,
                height: 5,
                borderRadius: 999,
                background: "var(--blue-text)",
                animation: "pipeline-flow 1.8s ease-in-out infinite",
              }}
            />
          )}
        </span>
      )}

      <span
        className="relative z-10 inline-flex h-11 w-11 items-center justify-center rounded-full font-mono"
        style={{
          background: ringBg,
          border: `1px solid ${isFailed || isComplete || isActive ? color : "var(--line)"}`,
          color,
        }}
      >
        {isComplete ? (
          <CheckCircle2 size={16} strokeWidth={1.8} />
        ) : isActive || isFailed ? (
          stage.icon
        ) : (
          <span className="text-[11px] tracking-[0.06em]">{String(stage.idx).padStart(2, "0")}</span>
        )}
        {isActive && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: -4,
              borderRadius: 999,
              border: `1px solid ${color}`,
              opacity: 0.35,
              animation: "pipeline-pulse 2s ease-out infinite",
            }}
          />
        )}
      </span>

      <p className="mt-3 text-[12.5px] font-semibold tracking-[-0.005em] text-[var(--ink)]">{stage.label}</p>
      <p className="mt-1 max-w-[22ch] text-[11px] leading-snug text-[var(--muted)]">{stage.sub}</p>
      {stage.time && (
        <p className="mt-1.5 font-mono text-[10px] tracking-[0.04em] tabular-nums" style={{ color }}>
          {stage.time}
        </p>
      )}
    </div>
  );
}

function buildStages(request: PaymentRequest, receipt?: Receipt): Stage[] {
  const isCrossChain = isCrossChainPaymentRequest(request);
  const submittedAt = request.submittedAt ? formatClock(request.submittedAt) : undefined;
  const confirmedAt = receipt?.confirmedAt ? formatClock(receipt.confirmedAt) : undefined;
  const settlement = request.settlement;
  const stage = settlement?.stage;

  if (!isCrossChain) {
    return [
      {
        id: "sign",
        idx: 1,
        status: request.txHash ? "complete" : request.status === "failed" ? "failed" : "active",
        icon: <Wallet size={16} strokeWidth={1.7} />,
        label: "Payer signs",
        sub: shortAddr(receipt?.from) ?? "Awaiting payer signature",
        time: submittedAt,
      },
      {
        id: "settle",
        idx: 2,
        status:
          request.status === "paid"
            ? "complete"
            : request.status === "failed"
            ? "failed"
            : request.txHash
            ? "active"
            : "pending",
        icon: <Zap size={16} strokeWidth={1.7} />,
        label: "Arc confirms",
        sub: receipt ? `block #${Number(receipt.blockNumber).toLocaleString()}` : "Awaiting confirmation",
        time: confirmedAt,
      },
      {
        id: "receipt",
        idx: 3,
        status: receipt ? "complete" : request.status === "failed" ? "failed" : "pending",
        icon: <FileText size={16} strokeWidth={1.7} />,
        label: "Receipt issued",
        sub: "VSR · UBL 2.1 · PDF",
        time: receipt ? "issued" : undefined,
      },
    ];
  }

  const signStatus: NodeStatus = settlement?.sourceTxHash || request.txHash ? "complete" : "active";
  const sourceConfStatus: NodeStatus =
    settlement?.sourceBlockNumber
      ? "complete"
      : stage === "submitted" || request.txHash
      ? "active"
      : "pending";
  const proofStatus: NodeStatus =
    stage === "settled" || request.status === "paid"
      ? "complete"
      : stage === "failed"
      ? "failed"
      : stage === "proving"
      ? "active"
      : stage === "settling" || settlement?.destinationTxHash
      ? "complete"
      : "pending";
  const settleStatus: NodeStatus =
    request.status === "paid" || stage === "settled"
      ? "complete"
      : stage === "failed"
      ? "failed"
      : stage === "settling" || settlement?.destinationTxHash
      ? "active"
      : "pending";
  const receiptStatus: NodeStatus = receipt
    ? "complete"
    : request.status === "failed" || stage === "failed"
    ? "failed"
    : "pending";

  return [
    {
      id: "sign",
      idx: 1,
      status: signStatus,
      icon: <Wallet size={16} strokeWidth={1.7} />,
      label: "Payer signs",
      sub: shortAddr(receipt?.from ?? (request.txHash ? request.recipient : undefined)) ?? "Awaiting signature",
      time: submittedAt,
    },
    {
      id: "source",
      idx: 2,
      status: sourceConfStatus,
      icon: <Layers size={16} strokeWidth={1.7} />,
      label: "Source confirms",
      sub: settlement?.sourceChainId
        ? `${getCrossChainLabel(settlement.sourceChainId)}`
        : "Source chain confirmation",
      time: settlement?.sourceBlockNumber ? `block #${Number(settlement.sourceBlockNumber).toLocaleString()}` : undefined,
    },
    {
      id: "proof",
      idx: 3,
      status: proofStatus,
      icon: <ShieldCheck size={16} strokeWidth={1.7} />,
      label: "Polymer proof",
      sub:
        stage === "proving"
          ? "Generating attestation"
          : proofStatus === "complete"
          ? "Attestation generated"
          : "Awaiting confirmation",
      time: proofStatus === "active" ? "in progress" : undefined,
    },
    {
      id: "settle",
      idx: 4,
      status: settleStatus,
      icon: <Zap size={16} strokeWidth={1.7} />,
      label: "Arc settles",
      sub: settlement?.destinationBlockNumber
        ? `block #${Number(settlement.destinationBlockNumber).toLocaleString()}`
        : "Awaiting proof",
      time: confirmedAt,
    },
    {
      id: "receipt",
      idx: 5,
      status: receiptStatus,
      icon: <FileText size={16} strokeWidth={1.7} />,
      label: "Receipt issued",
      sub: "VSR · UBL 2.1 · PDF",
      time: receipt ? "issued" : undefined,
    },
  ];
}

function shortAddr(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatClock(value: string): string | undefined {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString().slice(11, 19) + " UTC";
  } catch {
    return undefined;
  }
}
