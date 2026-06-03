import { Copy, Download, ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PspV1 } from "../../lib/psp/types";
import { Button, Field } from "../ui";
import { useReceipt } from "./context";

/**
 * Bottom section of the unified Receipt. Renders the Portable Settlement
 * Proof (PSP) inline — no nested card. Mirrors the lifecycle of the standalone
 * PspProofPanel: loading → 404-pending → error-unavailable → issued.
 *
 * The same "pending" copy keeps working until the backend issuer signs the
 * portable proof document, so existing production state surfaces the same way.
 */
export default function ReceiptProof() {
  const { request, onCopy } = useReceipt();
  const requestId = request.id;
  const [psp, setPsp] = useState<PspV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchPsp() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/psp?request_id=${encodeURIComponent(requestId)}`);
        if (response.status === 404) {
          if (!cancelled) {
            setPsp(null);
            setLoading(false);
          }
          return;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (!cancelled) setPsp(data as PspV1);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load PSP");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchPsp();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const jsonContent = useMemo(() => (psp ? JSON.stringify(psp, null, 2) : ""), [psp]);

  function copyValue(value: string) {
    if (onCopy) {
      onCopy(value);
      return;
    }
    navigator.clipboard.writeText(value).catch(() => {});
  }

  function handleDownload() {
    if (!psp) return;
    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${psp.uid}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const badge = psp ? psp.uid : loading ? "checking" : error ? "unavailable" : "pending";

  return (
    <div className="px-5 pb-4 pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-[12px] font-medium text-[var(--muted)]">
          <span className="inline-flex h-[20px] w-[20px] items-center justify-center rounded-[var(--btn-radius)] border border-[var(--green-text)] bg-[var(--green-bg)] text-[var(--green-text)]">
            <ShieldCheck size={11} strokeWidth={1.9} />
          </span>
          Portable Settlement Proof
        </p>
        <span
          className="max-w-[50%] truncate rounded-[2px] border border-[var(--line)] bg-[var(--input-bg)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--muted)]"
          title={badge}
        >
          {badge}
        </span>
      </div>

      {!psp ? (
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--muted)]">
          {loading
            ? "Checking Arc Testnet proof issuance for this request."
            : "The receipt is verified on Arc Testnet. A PSP will appear here when the backend issuer has signed the portable proof document."}
        </p>
      ) : (
        <>
          <dl className="mt-3 border-y border-[var(--line-soft)]">
            <Field.Row label="Digest">{`${psp.digest.slice(0, 10)}...${psp.digest.slice(-8)}`}</Field.Row>
            <Field.Row label="Issuer">{`${psp.issuer.publicKey.slice(0, 6)}...${psp.issuer.publicKey.slice(-4)}`}</Field.Row>
            <Field.Row label="Network">{`${psp.networkMode} · Arc Testnet`}</Field.Row>
          </dl>

          <div className="mt-3 flex items-center gap-2.5 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--input-bg)] p-2.5">
            <div className="min-w-0 flex-1">
              <span className="mb-1 block text-[12px] font-medium text-[var(--muted)]">
                CLI verify
              </span>
              <code className="block truncate font-mono text-[11px] text-[var(--ink-soft)]">
                {buildFetchCommand(psp)}
              </code>
            </div>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Copy CLI verification command"
              onClick={() => copyValue(buildFetchCommand(psp))}
              className="h-[30px] w-[30px] px-0"
            >
              <Copy size={12} strokeWidth={1.8} />
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" iconLeft={<Copy size={13} strokeWidth={1.6} />} onClick={() => copyValue(jsonContent)}>
              Copy JSON
            </Button>
            <Button variant="secondary" size="sm" iconLeft={<Download size={13} strokeWidth={1.6} />} onClick={handleDownload}>
              Download
            </Button>
            <a
              href={`/api/psp-viewer?uid=${encodeURIComponent(psp.uid)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--paper)] px-2.5 text-[11.5px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--line-soft)]"
            >
              <ExternalLink size={13} strokeWidth={1.6} />
              View proof
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function buildFetchCommand(psp: PspV1): string {
  return `curl -s "${window.location.origin}/api/psp?uid=${psp.uid}" | npx @disburse/psp-verify --stdin --issuer ${psp.issuer.publicKey}`;
}
