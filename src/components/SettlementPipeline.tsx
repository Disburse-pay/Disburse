import { CheckCircle2, FileText, Layers, ShieldCheck, Wallet, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { isCrossChainPaymentRequest, type PaymentRequest, type Receipt } from "../lib/payments";
import { getCrossChainLabel } from "../lib/crosschain";

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

type Props = {
  request: PaymentRequest;
  receipt?: Receipt;
};

/**
 * Horizontal cross-chain settlement pipeline. Renders the canonical stages
 * a cross-chain QR payment moves through — payer signs, source confirms,
 * Polymer proof, Arc settle, receipt issued — driven by real
 * PaymentRequest.settlement state plus the Receipt if present.
 *
 * For Arc-native (same-chain) requests, renders a 3-node compact pipeline.
 */
export default function SettlementPipeline({ request, receipt }: Props) {
  const stages = buildStages(request, receipt);
  const isCrossChain = isCrossChainPaymentRequest(request);
  const settlement = request.settlement;
  const route = isCrossChain
    ? `Cross-chain · ${getCrossChainLabel(settlement?.sourceChainId)} → Arc`
    : "Arc Testnet · same-chain";

  const isLive =
    (request.status === "open" || request.status === "possible_match") &&
    Boolean(request.txHash || settlement?.stage === "proving" || settlement?.stage === "settling");

  return (
    <section
      aria-label="Cross-chain settlement pipeline"
      className="overflow-hidden rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]"
    >
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[9.5px] uppercase tracking-[0.2em]">
            <span
              className="inline-flex items-center gap-1.5"
              style={{ color: isLive ? "var(--green-text)" : "var(--muted)" }}
            >
              <span className="relative inline-flex h-2 w-2 items-center justify-center">
                {isLive && (
                  <span
                    className="absolute inset-0 rounded-full opacity-40"
                    style={{
                      background: "currentColor",
                      animation: "ping 1.6s cubic-bezier(0,0,0.2,1) infinite",
                    }}
                  />
                )}
                <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
              </span>
              {isLive ? "Live settlement" : request.status === "paid" ? "Settled" : "Settlement"}
            </span>
          </p>
          <h3 className="mt-1.5 text-[15.5px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
            {request.label}
            {isLive && (
              <span
                className="ml-2 font-normal text-[var(--muted-soft)]"
                style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
              >
                settling now.
              </span>
            )}
          </h3>
          <p className="m-0 text-[12px] text-[var(--muted)]">{route}</p>
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="font-mono text-[22px] font-semibold tracking-[-0.01em] text-[var(--ink)] tabular-nums">
            {request.amount}
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--muted)]">
            {request.token}
          </span>
        </div>
      </header>

      <div className="px-5 pb-6 pt-7">
        <div
          className="grid items-start"
          style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
        >
          {stages.map((stage, i) => (
            <PipelineNode
              key={stage.id}
              stage={stage}
              next={stages[i + 1]}
              isLast={i === stages.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function PipelineNode({
  stage,
  next,
  isLast,
}: {
  stage: Stage;
  next?: Stage;
  isLast: boolean;
}) {
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
  const connectorComplete =
    isComplete && next && (next.status === "complete" || next.status === "active");

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
          <span className="text-[11px] tracking-[0.06em]">
            {String(stage.idx).padStart(2, "0")}
          </span>
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

      <p className="mt-3 text-[12.5px] font-semibold tracking-[-0.005em] text-[var(--ink)]">
        {stage.label}
      </p>
      <p className="mt-1 max-w-[22ch] text-[11px] leading-snug text-[var(--muted)]">
        {stage.sub}
      </p>
      {stage.time && (
        <p
          className="mt-1.5 font-mono text-[10px] tracking-[0.04em] tabular-nums"
          style={{ color }}
        >
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
    // Arc-native: 3-node compact pipeline
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
