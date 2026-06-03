import { Copy, ExternalLink, FileText, ReceiptText, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { ARC_CHAIN_ID } from "../../lib/arc";
import { getCrossChainLabel } from "../../lib/crosschain";
import { Button, Field } from "../ui";
import { useReceipt } from "./context";

/**
 * Top section of the unified Receipt. Owns the canonical render of:
 * amount, label, status, payer/payee, network, block, tx hash, issued time,
 * SHA-256 fingerprint, VSR UID, and the export actions.
 *
 * These fields appear here and ONLY here in the receipt surface.
 */
export default function ReceiptSummary() {
  const { request, receipt, attestation, onCopyFingerprint, onExportJson, onExportUbl, onExportPdf } = useReceipt();

  const chainId = receipt?.chainId ?? ARC_CHAIN_ID;
  const networkLabel = chainId === ARC_CHAIN_ID ? "Arc Testnet" : getCrossChainLabel(chainId as never);
  const fingerprint = attestation?.fingerprint;
  const shortFingerprint = fingerprint
    ? `${fingerprint.slice(0, 10)}…${fingerprint.slice(-6)}`
    : undefined;
  const shortTx = receipt ? `${receipt.txHash.slice(0, 10)}…${receipt.txHash.slice(-8)}` : undefined;
  const issuedAt = receipt?.confirmedAt;

  const statusPill = statusToPill(request.status);

  return (
    <div className="px-5 pb-4 pt-4">
      {/* Headline: amount + status. Each appears once on the whole receipt. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-[var(--muted)]">
            Verifiable Settlement Receipt
          </p>
          <h3 className="mt-1.5 truncate text-[15.5px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
            {request.label || "Untitled request"}
          </h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[24px] font-semibold tracking-[-0.01em] tabular-nums text-[var(--ink)]">
              {receipt?.amount ?? request.amount}
            </span>
            <span className="text-[12px] font-medium text-[var(--muted)]">
              {receipt?.token ?? request.token}
            </span>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[10px] tracking-[0.06em]"
            style={{ color: statusPill.color, background: statusPill.bg }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusPill.color }} />
            {statusPill.label}
          </span>
        </div>
      </div>

      {/* Detail rows: each field rendered once. */}
      <dl className="mt-4 border-y border-[var(--line-soft)]">
        {issuedAt && <Field.Row label="Issued">{formatIssuedAt(issuedAt)}</Field.Row>}
        {receipt?.from && <Field.Row label="Payer">{receipt.from}</Field.Row>}
        <Field.Row label="Payee">{receipt?.to ?? request.recipient}</Field.Row>
        <Field.Row label="Network">{`${networkLabel} · chainId ${chainId}`}</Field.Row>
        {receipt?.blockNumber && (
          <Field.Row label="Block">{`#${Number(receipt.blockNumber).toLocaleString()}`}</Field.Row>
        )}
        {shortTx && receipt && (
          <Field.Row label="Tx hash">
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
          </Field.Row>
        )}
        {attestation?.uid && <Field.Row label="VSR UID">{attestation.uid}</Field.Row>}
      </dl>

      {shortFingerprint && (
        <div className="mt-3 flex items-center gap-3 rounded-sm border border-[var(--line)] bg-[var(--input-bg)] px-3.5 py-3">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--line)] bg-[var(--paper)] text-[var(--ink-soft)]">
            <ShieldCheck size={14} strokeWidth={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-medium text-[var(--muted)]">
              SHA-256 fingerprint
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--ink)]">
              {shortFingerprint}
            </p>
          </div>
          {onCopyFingerprint && (
            <Button
              variant="secondary"
              size="sm"
              aria-label="Copy fingerprint"
              onClick={() => onCopyFingerprint(fingerprint as string)}
              className="h-7 w-7 px-0"
            >
              <Copy size={12} strokeWidth={1.75} />
            </Button>
          )}
        </div>
      )}

      {(onExportJson || onExportUbl || onExportPdf || receipt?.explorerUrl) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line-soft)] pt-3">
          <p className="text-[11.5px] font-medium text-[var(--muted)]">
            Export
          </p>
          <div className="flex flex-wrap gap-1.5">
            {onExportJson && (
              <Button variant="secondary" size="sm" onClick={onExportJson} iconLeft={<FileText size={12} strokeWidth={1.75} />}>
                JSON
              </Button>
            )}
            {onExportUbl && (
              <Button variant="secondary" size="sm" onClick={onExportUbl} iconLeft={<FileText size={12} strokeWidth={1.75} />}>
                UBL 2.1
              </Button>
            )}
            {onExportPdf && (
              <Button variant="secondary" size="sm" onClick={onExportPdf} iconLeft={<ReceiptText size={12} strokeWidth={1.75} />}>
                PDF
              </Button>
            )}
            {receipt?.explorerUrl && (
              <a
                href={receipt.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1.5 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--paper)] px-2.5 text-[11.5px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--line-soft)]"
              >
                <ExternalLink size={12} strokeWidth={1.75} />
                Explorer
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Pill = { label: string; color: string; bg: string };

function statusToPill(status: string): Pill {
  switch (status) {
    case "paid":
      return { label: "Verified onchain", color: "var(--green-text)", bg: "var(--green-bg)" };
    case "failed":
      return { label: "Failed", color: "var(--red-text)", bg: "var(--red-bg)" };
    case "expired":
      return { label: "Expired", color: "var(--muted)", bg: "var(--gray-bg)" };
    case "possible_match":
      return { label: "Matching", color: "var(--blue-text)", bg: "var(--blue-bg)" };
    default:
      return { label: "Awaiting payment", color: "var(--muted)", bg: "var(--gray-bg)" };
  }
}

function formatIssuedAt(value: string): ReactNode {
  try {
    return new Date(value).toISOString();
  } catch {
    return value;
  }
}
