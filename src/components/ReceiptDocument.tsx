import { Copy, ExternalLink, FileText, ReceiptText, ShieldCheck } from "lucide-react";
import type { PaymentRequest, Receipt } from "../lib/payments";
import { getCrossChainLabel } from "../lib/crosschain";
import { ARC_CHAIN_ID } from "../lib/arc";

type Props = {
  receipt: Receipt;
  request: PaymentRequest;
  attestationUid?: string;
  attestationFingerprint?: string;
  onCopyFingerprint?: (value: string) => void;
  onExportJson?: () => void;
  onExportUbl?: () => void;
  onExportPdf?: () => void;
};

/**
 * Verifiable Settlement Receipt. Formal tear-sheet of a confirmed payment —
 * structured metadata, SHA-256 fingerprint anchor, and export actions.
 */
export default function ReceiptDocument({
  receipt,
  request,
  attestationUid,
  attestationFingerprint,
  onCopyFingerprint,
  onExportJson,
  onExportUbl,
  onExportPdf,
}: Props) {
  const chainId = receipt.chainId ?? ARC_CHAIN_ID;
  const networkLabel = chainId === ARC_CHAIN_ID ? "Arc Testnet" : getCrossChainLabel(chainId as never);
  const fingerprint = attestationFingerprint;
  const shortFingerprint = fingerprint
    ? `${fingerprint.slice(0, 10)}…${fingerprint.slice(-6)}`
    : undefined;
  const shortTx = `${receipt.txHash.slice(0, 10)}…${receipt.txHash.slice(-8)}`;
  const issuedAt = receipt.confirmedAt;

  return (
    <section
      aria-label="Verifiable Settlement Receipt"
      className="overflow-hidden rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]"
    >
      <header className="border-b border-[var(--line)] bg-gradient-to-b from-[var(--paper)] to-transparent px-5 pb-3.5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
              Verifiable Settlement Receipt
            </p>
            <h3 className="mt-1.5 text-[15.5px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
              VSR · {request.label}
            </h3>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-[var(--green-bg)] px-2 py-1 font-mono text-[10px] tracking-[0.06em] text-[var(--green-text)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--green-text)]" />
            Verified onchain
          </span>
        </div>
        <p className="mt-3 max-w-[60ch] text-[11px] leading-relaxed text-[var(--muted)]">
          <span className="italic" style={{ fontFamily: "var(--font-serif)" }}>
            Anyone
          </span>{" "}
          with the transaction hash can re-derive this record from chain data. No trust in Disburse required.
        </p>
      </header>

      <dl className="m-0 grid gap-0 px-5 pb-4 pt-2">
        <Row label="Issued" value={formatIssuedAt(issuedAt)} mono />
        <Row label="Payer" value={receipt.from} mono truncate />
        <Row label="Payee" value={receipt.to} mono truncate />
        <Row label="Network" value={`${networkLabel} · chainId ${chainId}`} mono />
        {receipt.blockNumber && (
          <Row label="Block" value={`#${Number(receipt.blockNumber).toLocaleString()}`} mono />
        )}
        <Row
          label="Tx hash"
          mono
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className="border-b border-dotted border-[var(--muted)]">{shortTx}</span>
              {receipt.explorerUrl && (
                <a
                  href={receipt.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--muted)] hover:text-[var(--ink)]"
                  aria-label="Open transaction in explorer"
                >
                  <ExternalLink size={11} strokeWidth={1.6} />
                </a>
              )}
            </span>
          }
        />
        <Row
          label="Amount"
          value={
            <span className="inline-flex items-baseline gap-1.5">
              <span className="font-mono text-[14px] font-semibold text-[var(--ink)] tabular-nums">
                {receipt.amount}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                {receipt.token}
              </span>
            </span>
          }
        />
        {attestationUid && (
          <Row label="VSR UID" value={attestationUid} mono truncate />
        )}
      </dl>

      {shortFingerprint && (
        <div className="mx-5 flex items-center gap-3 rounded-sm border border-[var(--line)] bg-[var(--input-bg)] px-3.5 py-3">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--line)] bg-[var(--paper)] text-[var(--ink-soft)]">
            <ShieldCheck size={14} strokeWidth={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--muted)]">
              SHA-256 fingerprint
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--ink)]">
              {shortFingerprint}
            </p>
          </div>
          {onCopyFingerprint && (
            <button
              type="button"
              onClick={() => onCopyFingerprint(fingerprint as string)}
              aria-label="Copy fingerprint"
              className="inline-flex items-center justify-center rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--paper)] p-1.5 text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--line-soft)]"
            >
              <Copy size={12} strokeWidth={1.75} />
            </button>
          )}
        </div>
      )}

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
        <p className="m-0 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--muted)]">
          Export
        </p>
        <div className="flex flex-wrap gap-1.5">
          {onExportJson && (
            <ExportButton onClick={onExportJson} icon={<FileText size={12} strokeWidth={1.75} />} label="JSON" />
          )}
          {onExportUbl && (
            <ExportButton onClick={onExportUbl} icon={<FileText size={12} strokeWidth={1.75} />} label="UBL 2.1" />
          )}
          {onExportPdf && (
            <ExportButton onClick={onExportPdf} icon={<ReceiptText size={12} strokeWidth={1.75} />} label="PDF" />
          )}
          {receipt.explorerUrl && (
            <a
              href={receipt.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--line-soft)]"
            >
              <ExternalLink size={12} strokeWidth={1.75} />
              Explorer
            </a>
          )}
        </div>
      </footer>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-baseline gap-4 border-t border-[var(--line-soft)] py-2 first:border-t-0">
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={[
          "m-0 text-[12px] text-[var(--ink)]",
          mono ? "font-mono" : "",
          truncate ? "overflow-hidden text-ellipsis whitespace-nowrap" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

function ExportButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--line-soft)]"
    >
      {icon}
      {label}
    </button>
  );
}

function formatIssuedAt(value: string): string {
  try {
    return new Date(value).toISOString();
  } catch {
    return value;
  }
}
