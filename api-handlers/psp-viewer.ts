import type { Hash } from "viem";
import { assertMethod, readQueryString, sendError, type ApiRequest, type ApiResponse } from "../server/http.js";
import { readPspByUid } from "../server/psp/issue.js";
import type { PspV1 } from "../src/lib/psp/types.js";
import { ARC_DESTINATION_CHAIN_ID, getCrossChainExplorerTxUrl, isPaymentSourceChainId } from "../src/lib/crosschain.js";

/**
 * GET /api/psp-viewer?uid=psp:abc123...
 *
 * Returns a self-contained HTML page displaying PSP details and verification
 * instructions. Public — anyone with the UID can view and verify.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "GET");

    const uid = readQueryString(request, "uid");
    if (!uid || !/^psp:[0-9a-f]{16}$/.test(uid)) {
      response.setHeader?.("content-type", "application/json; charset=utf-8");
      response.status(400).json({ error: "Provide a valid PSP uid." });
      return;
    }

    const psp = await readPspByUid(uid);
    if (!psp) {
      response.setHeader?.("content-type", "application/json; charset=utf-8");
      response.status(404).json({ error: "PSP not found." });
      return;
    }

    const html = renderPspViewer(psp);
    sendHtml(response, 200, html);
  } catch (error) {
    sendError(response, error);
  }
}

function renderPspViewer(psp: PspV1): string {
  const arcExplorer = getCrossChainExplorerTxUrl(ARC_DESTINATION_CHAIN_ID, psp.settlement.txHash);
  const sourceExplorer =
    psp.source && isPaymentSourceChainId(psp.source.chainId)
      ? getCrossChainExplorerTxUrl(psp.source.chainId, psp.source.txHash as Hash)
      : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PSP ${psp.uid} — Disburse Settlement Proof</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e4e4e7; min-height: 100vh; padding: 2rem 1rem; }
    .container { max-width: 640px; margin: 0 auto; }
    .badge { display: inline-flex; align-items: center; gap: 0.5rem; background: #064e3b; color: #6ee7b7; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; margin-bottom: 1.5rem; }
    .badge::before { content: "✓"; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #fff; }
    .uid { font-family: monospace; font-size: 0.875rem; color: #a1a1aa; margin-bottom: 2rem; }
    .section { background: #18181b; border: 1px solid #27272a; border-radius: 0.75rem; padding: 1.25rem; margin-bottom: 1rem; }
    .section h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; margin-bottom: 0.75rem; }
    .row { display: flex; justify-content: space-between; align-items: baseline; padding: 0.375rem 0; border-bottom: 1px solid #27272a; }
    .row:last-child { border-bottom: none; }
    .label { font-size: 0.8125rem; color: #a1a1aa; }
    .value { font-size: 0.8125rem; color: #e4e4e7; font-family: monospace; max-width: 60%; text-align: right; word-break: break-all; }
    .value a { color: #60a5fa; text-decoration: none; }
    .value a:hover { text-decoration: underline; }
    .verify-box { background: #1c1917; border: 1px solid #44403c; border-radius: 0.75rem; padding: 1.25rem; margin-top: 1.5rem; }
    .verify-box h2 { font-size: 0.875rem; color: #fbbf24; margin-bottom: 0.75rem; }
    .verify-box pre { background: #0c0a09; padding: 0.75rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.75rem; color: #d6d3d1; line-height: 1.5; }
    .footer { margin-top: 2rem; text-align: center; font-size: 0.75rem; color: #52525b; }
    .footer a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">Verified Settlement Proof</div>
    <h1>Portable Settlement Proof</h1>
    <p class="uid">${psp.uid}</p>

    ${psp.invoice ? `
    <div class="section">
      <h2>Invoice</h2>
      <div class="row"><span class="label">Request ID</span><span class="value">${psp.invoice.requestId}</span></div>
      <div class="row"><span class="label">Label</span><span class="value">${escapeHtml(psp.invoice.label)}</span></div>
      <div class="row"><span class="label">Amount</span><span class="value">${psp.invoice.amount} ${psp.invoice.token}</span></div>
      <div class="row"><span class="label">Payer</span><span class="value">${truncateAddress(psp.invoice.payer)}</span></div>
      <div class="row"><span class="label">Recipient</span><span class="value">${truncateAddress(psp.invoice.recipient)}</span></div>
      ${psp.invoice.invoiceDate ? `<div class="row"><span class="label">Date</span><span class="value">${psp.invoice.invoiceDate}</span></div>` : ""}
    </div>
    ` : ""}

    ${psp.marketClaim ? `
    <div class="section">
      <h2>Market Claim</h2>
      <div class="row"><span class="label">Market</span><span class="value">${escapeHtml(psp.marketClaim.question)}</span></div>
      <div class="row"><span class="label">Outcome</span><span class="value">${psp.marketClaim.outcome}${psp.marketClaim.outcome === psp.marketClaim.winningOutcome ? " (won)" : ""}</span></div>
      <div class="row"><span class="label">Payout</span><span class="value">${psp.marketClaim.payoutAmount} USDC</span></div>
      <div class="row"><span class="label">Market Address</span><span class="value">${truncateAddress(psp.marketClaim.onchainMarket)}</span></div>
      <div class="row"><span class="label">Resolved At</span><span class="value">${psp.marketClaim.resolvedAt}</span></div>
    </div>
    ` : ""}

    <div class="section">
      <h2>Settlement (Arc Testnet)</h2>
      <div class="row"><span class="label">Chain ID</span><span class="value">${psp.settlement.chainId}</span></div>
      <div class="row"><span class="label">Tx Hash</span><span class="value"><a href="${arcExplorer}" target="_blank" rel="noopener">${truncateHash(psp.settlement.txHash)}</a></span></div>
      <div class="row"><span class="label">Block</span><span class="value">${psp.settlement.blockNumber}</span></div>
      <div class="row"><span class="label">Settled At</span><span class="value">${psp.settlement.settledAt}</span></div>
    </div>

    ${psp.source ? `
    <div class="section">
      <h2>Source Chain</h2>
      <div class="row"><span class="label">Chain ID</span><span class="value">${psp.source.chainId}</span></div>
      <div class="row"><span class="label">Tx Hash</span><span class="value">${sourceExplorer ? `<a href="${sourceExplorer}" target="_blank" rel="noopener">${truncateHash(psp.source.txHash)}</a>` : truncateHash(psp.source.txHash)}</span></div>
      <div class="row"><span class="label">Payer</span><span class="value">${truncateAddress(psp.source.payer)}</span></div>
    </div>
    ` : ""}

    <div class="section">
      <h2>Cryptographic Proof</h2>
      <div class="row"><span class="label">Digest</span><span class="value">${truncateHash(psp.digest)}</span></div>
      <div class="row"><span class="label">Algorithm</span><span class="value">${psp.signature.alg}</span></div>
      <div class="row"><span class="label">Issuer</span><span class="value">${truncateAddress(psp.issuer.publicKey)}</span></div>
      <div class="row"><span class="label">Network</span><span class="value">${psp.networkMode}</span></div>
      <div class="row"><span class="label">Version</span><span class="value">${psp.version}</span></div>
    </div>

    <div class="verify-box">
      <h2>Verify this proof yourself</h2>
      <pre>npx @disburse/psp-verify proof.json --issuer ${psp.issuer.publicKey}

# Or fetch and pipe:
curl -s "${getApiUrl()}/api/psp?uid=${psp.uid}" | npx @disburse/psp-verify --stdin</pre>
    </div>

    <div class="footer">
      Issued by <a href="${psp.issuer.url}" target="_blank" rel="noopener">${escapeHtml(psp.issuer.name)}</a> &middot; ${psp.createdAt}
    </div>
  </div>
</body>
</html>`;
}

function sendHtml(response: ApiResponse, statusCode: number, html: string) {
  response.setHeader?.("content-type", "text/html; charset=utf-8");
  response.setHeader?.("cache-control", "public, max-age=31536000, immutable");
  const next = response.status(statusCode);
  if (next.send) {
    next.send(html);
    return;
  }
  next.json(html);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncateAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function truncateHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : hash;
}

function getApiUrl(): string {
  // Canonical, stable public origin for the copy-paste verification commands.
  // Deliberately NOT process.env.VERCEL_URL: on Vercel that is the per-deploy
  // hostname (<project>-<hash>-<account>.vercel.app), which leaks the account/
  // project name into this public page and changes on every deploy. Override
  // with PSP_PUBLIC_URL for non-standard deployments.
  return process.env.PSP_PUBLIC_URL || "https://app.disburse.online";
}
