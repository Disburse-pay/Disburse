/**
 * PSP Proof Panel
 *
 * Displays Portable Settlement Proof details in the receipt view.
 * Fetches the PSP by request ID from the API and shows:
 * - UID and digest
 * - Copy JSON / Download buttons
 * - Link to the public viewer
 */

import { useEffect, useState } from "react";
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
        // Try fetching by building UID from the API — we don't know the UID yet,
        // so we query by request_id through a slightly different path
        const response = await fetch(`/api/psp?request_id=${encodeURIComponent(requestId)}`);
        if (response.status === 404) {
          // No PSP yet — not an error, just not issued
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

    fetchPsp();
    return () => { cancelled = true; };
  }, [requestId]);

  if (loading) {
    return null; // Don't show anything while loading
  }

  if (error || !psp) {
    return null; // Silently hide if no PSP exists
  }

  const viewerUrl = `/api/psp-viewer?uid=${encodeURIComponent(psp.uid)}`;
  const jsonContent = JSON.stringify(psp, null, 2);

  function handleCopyJson() {
    if (onCopy) {
      onCopy(jsonContent);
    } else {
      navigator.clipboard.writeText(jsonContent).catch(() => {});
    }
  }

  function handleDownload() {
    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${psp!.uid}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="psp-proof-panel">
      <div className="psp-proof-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <polyline points="9 12 11 14 15 10" />
        </svg>
        <span className="psp-proof-title">Portable Settlement Proof</span>
        <span className="psp-proof-badge">{psp.uid}</span>
      </div>

      <div className="psp-proof-details">
        <div className="psp-proof-row">
          <span className="psp-proof-label">Digest</span>
          <code className="psp-proof-value">{psp.digest.slice(0, 10)}...{psp.digest.slice(-8)}</code>
        </div>
        <div className="psp-proof-row">
          <span className="psp-proof-label">Issuer</span>
          <code className="psp-proof-value">{psp.issuer.publicKey.slice(0, 6)}...{psp.issuer.publicKey.slice(-4)}</code>
        </div>
        <div className="psp-proof-row">
          <span className="psp-proof-label">Network</span>
          <span className="psp-proof-value">{psp.networkMode}</span>
        </div>
      </div>

      <div className="psp-proof-actions">
        <button className="compliance-button" type="button" onClick={handleCopyJson}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
          </svg>
          Copy JSON
        </button>
        <button className="compliance-button" type="button" onClick={handleDownload}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>
          </svg>
          Download
        </button>
        <a className="compliance-button" href={viewerUrl} target="_blank" rel="noopener noreferrer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/>
          </svg>
          View Proof
        </a>
      </div>
    </div>
  );
}
