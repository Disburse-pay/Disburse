import { Copy, Download } from "lucide-react";
import type { PaymentRequest, PaymentStatus } from "../lib/payments";

type Props = {
  request: PaymentRequest;
  qrDataUrl?: string;
  shareUrl: string;
  liveStatusLabel: string;
  onCopy: (value: string) => void;
  onDownload?: () => void;
};

const STATUS_TONE: Record<PaymentStatus, { bg: string; text: string; border: string; dot: string; label: string }> = {
  open: {
    bg: "var(--green-bg)",
    text: "var(--green-text)",
    border: "rgba(76,201,154,0.25)",
    dot: "var(--green-text)",
    label: "Watching",
  },
  possible_match: {
    bg: "var(--blue-bg)",
    text: "var(--blue-text)",
    border: "rgba(110,163,230,0.25)",
    dot: "var(--blue-text)",
    label: "Possible match",
  },
  paid: {
    bg: "var(--green-bg)",
    text: "var(--green-text)",
    border: "rgba(76,201,154,0.25)",
    dot: "var(--green-text)",
    label: "Paid",
  },
  failed: {
    bg: "var(--red-bg)",
    text: "var(--red-text)",
    border: "rgba(224,118,118,0.25)",
    dot: "var(--red-text)",
    label: "Failed",
  },
  expired: {
    bg: "var(--input-bg)",
    text: "var(--muted)",
    border: "var(--line)",
    dot: "var(--muted)",
    label: "Expired",
  },
};

/**
 * QR request card. Renders the live QR alongside structured payment metadata
 * and a "watching for payment" indicator. Backed by the real QR data URL and
 * PaymentRequest state — animations honour the request's actual status.
 */
export default function QrShareCard({
  request,
  qrDataUrl,
  shareUrl,
  liveStatusLabel,
  onCopy,
  onDownload,
}: Props) {
  const tone = STATUS_TONE[request.status] ?? STATUS_TONE.open;
  const shortAddr = `${request.recipient.slice(0, 6)}…${request.recipient.slice(-4)}`;
  const isWatching = request.status === "open" && !request.txHash;

  return (
    <section className="rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="mb-3.5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11.5px] font-medium text-[var(--muted)]">
            Active request
          </p>
          <h3 className="mt-1.5 truncate text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)]">
            {request.label}
          </h3>
          {request.note && (
            <p className="mt-1.5 max-w-[40ch] text-[12px] leading-snug text-[var(--muted)]">
              {request.note}
            </p>
          )}
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-[10px] tracking-[0.06em]"
          style={{
            background: tone.bg,
            color: tone.text,
            boxShadow: `inset 0 0 0 1px ${tone.border}`,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: tone.dot }}
          />
          {tone.label}
        </span>
      </div>

      <div className="mt-4 grid items-start gap-5 border-t border-[var(--line)] pt-4 sm:grid-cols-[172px_1fr]">
        <div className="h-[172px] w-[172px] rounded-sm border border-[var(--line)] bg-[var(--paper)] p-2">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR payment code" className="h-full w-full" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11.5px] font-medium text-[var(--muted)]">
              Generating
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3.5">
          <div>
            <p className="text-[11.5px] font-medium text-[var(--muted)]">
              Amount
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[26px] font-semibold leading-none text-[var(--ink)] tabular-nums">
                {request.amount}
              </span>
              <span className="text-[12px] font-medium text-[var(--muted)]">
                {request.token}
              </span>
            </div>
          </div>

          <div>
            <p className="text-[11.5px] font-medium text-[var(--muted)]">
              Recipient
            </p>
            <p className="mt-1 font-mono text-[11.5px] text-[var(--ink)]">{shortAddr}</p>
          </div>

          <div className="flex items-center gap-2" aria-live="polite">
            <span
              className="relative inline-flex h-2 w-2 items-center justify-center"
              style={{ color: tone.text }}
            >
              {isWatching && (
                <span
                  className="absolute inset-0 rounded-full opacity-40"
                  style={{
                    background: "currentColor",
                    animation: "ping 1.6s cubic-bezier(0,0,0.2,1) infinite",
                  }}
                />
              )}
              <span
                className="relative h-1.5 w-1.5 rounded-full"
                style={{ background: "currentColor" }}
              />
            </span>
            <span className="text-[12px] font-medium text-[var(--muted)]">
              {liveStatusLabel}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onCopy(shareUrl)}
              className="inline-flex items-center gap-1.5 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--line-soft)]"
            >
              <Copy size={12} strokeWidth={1.75} />
              Copy link
            </button>
            {onDownload && qrDataUrl && (
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex items-center gap-1.5 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--line-soft)]"
              >
                <Download size={12} strokeWidth={1.75} />
                Download PNG
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
