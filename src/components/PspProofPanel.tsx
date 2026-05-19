/**
 * PSP Proof Panel
 *
 * Displays the Portable Settlement Proof tied to a paid QR request. The panel
 * queries by request_id so the receipt surface can show the proof without
 * already knowing the immutable PSP UID.
 */

import { Check, Copy, Download, ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PspV1 } from "../lib/psp/types";

type PspProofPanelProps = {
  requestId: string;
  onCopy?: (value: string) => void;
};

export function PspProofPanel({ requestId, onCopy }: PspProofPanelProps) {
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
        if (!cancelled) {
          setPsp(data as PspV1);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PSP");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
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

  if (loading) {
    return (
      <section className="psp-proof-panel pending" aria-label="Portable Settlement Proof">
        <PanelHeader title="Portable Settlement Proof" badge="checking" />
        <p className="psp-proof-note">Checking Arc Testnet proof issuance for this request.</p>
      </section>
    );
  }

  if (error || !psp) {
    return (
      <section className="psp-proof-panel pending" aria-label="Portable Settlement Proof">
        <PanelHeader title="Portable Settlement Proof" badge={error ? "unavailable" : "pending"} />
        <p className="psp-proof-note">
          The receipt is verified on Arc Testnet. A PSP will appear here when the backend issuer has signed
          the portable proof document.
        </p>
      </section>
    );
  }

  const viewerUrl = `/api/psp-viewer?uid=${encodeURIComponent(psp.uid)}`;
  const fetchCommand = `curl -s "${window.location.origin}/api/psp?uid=${psp.uid}" | npx @disburse/psp-verify --stdin --issuer ${psp.issuer.publicKey}`;

  return (
    <section className="psp-proof-panel" aria-label="Portable Settlement Proof">
      <PanelHeader title="Portable Settlement Proof" badge={psp.uid} issued />

      <div className="psp-proof-details">
        <ProofRow label="Digest" value={`${psp.digest.slice(0, 10)}...${psp.digest.slice(-8)}`} />
        <ProofRow label="Issuer" value={`${psp.issuer.publicKey.slice(0, 6)}...${psp.issuer.publicKey.slice(-4)}`} />
        <ProofRow label="Network" value={`${psp.networkMode} · Arc Testnet`} />
      </div>

      <div className="psp-proof-command">
        <div>
          <span>CLI verify</span>
          <code>{fetchCommand}</code>
        </div>
        <button type="button" aria-label="Copy CLI verification command" onClick={() => copyValue(fetchCommand)}>
          <Copy size={12} strokeWidth={1.8} />
        </button>
      </div>

      <div className="psp-proof-actions">
        <button className="compliance-button" type="button" onClick={() => copyValue(jsonContent)}>
          <Copy size={14} strokeWidth={1.5} />
          Copy JSON
        </button>
        <button className="compliance-button" type="button" onClick={handleDownload}>
          <Download size={14} strokeWidth={1.5} />
          Download
        </button>
        <a className="compliance-button" href={viewerUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} strokeWidth={1.5} />
          View proof
        </a>
      </div>
    </section>
  );
}

function PanelHeader({ title, badge, issued }: { title: string; badge: string; issued?: boolean }) {
  return (
    <div className="psp-proof-header">
      <span className="psp-proof-icon" aria-hidden="true">
        {issued ? <Check size={14} strokeWidth={1.8} /> : <ShieldCheck size={14} strokeWidth={1.6} />}
      </span>
      <span className="psp-proof-title">{title}</span>
      <span className="psp-proof-badge">{badge}</span>
    </div>
  );
}

function ProofRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="psp-proof-row">
      <span className="psp-proof-label">{label}</span>
      <code className="psp-proof-value">{value}</code>
    </div>
  );
}
