import {
  getAddress,
  isAddress,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import {
  assertMethod,
  readQueryString,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../server/http.js";
import { readPspByUid } from "../server/psp/issue.js";
import {
  ARC_DESTINATION_CHAIN_ID,
  getCrossChainExplorerTxUrl,
  isPaymentSourceChainId,
} from "../src/lib/crosschain.js";
import type { PspV1 } from "../src/lib/psp/types.js";
import { verify } from "../src/lib/psp/verify.js";

/**
 * GET /api/psp-viewer?uid=psp:abc123...
 *
 * Returns a self-contained HTML page displaying PSP details and safe,
 * trust-root-aware verification instructions.
 */
export default async function handler(
  request: ApiRequest,
  response: ApiResponse
) {
  try {
    assertMethod(request, "GET");

    const uid = readQueryString(request, "uid");
    if (!uid || !/^psp:[0-9a-f]{16}$/.test(uid)) {
      response.setHeader?.("content-type", "application/json; charset=utf-8");
      sendJson(response, 400, { error: "Provide a valid PSP uid." });
      return;
    }

    const psp = await readPspByUid(uid);
    if (!psp) {
      response.setHeader?.("content-type", "application/json; charset=utf-8");
      sendJson(response, 404, { error: "PSP not found." });
      return;
    }

    const trustedIssuer = getConfiguredTrustedIssuer();
    const verification = trustedIssuer
      ? await verify(psp, { expectedIssuer: trustedIssuer })
      : null;

    sendHtml(
      response,
      200,
      renderPspViewer(psp, trustedIssuer, verification)
    );
  } catch (error) {
    sendError(response, error);
  }
}

function renderPspViewer(
  psp: PspV1,
  trustedIssuer: Address | null,
  verification: Awaited<ReturnType<typeof verify>> | null
): string {
  const arcExplorer = getCrossChainExplorerTxUrl(
    ARC_DESTINATION_CHAIN_ID,
    psp.settlement.txHash
  );
  const sourceExplorer =
    psp.source && isPaymentSourceChainId(psp.source.chainId)
      ? getCrossChainExplorerTxUrl(
          psp.source.chainId,
          psp.source.txHash as Hash
        )
      : null;

  const status = verification?.ok
    ? {
        className: "badge verified",
        label: "Trusted issuer signature verified",
        detail:
          "The document signature matches the server-configured trust root. On-chain settlement was not checked by this page.",
      }
    : verification
      ? {
          className: "badge failed",
          label: "Trusted verification failed",
          detail: verification.reason ?? "The PSP did not pass trusted verification.",
        }
      : {
          className: "badge pending",
          label: "Independent verification required",
          detail:
            "This page displays a PSP but does not treat the issuer embedded in that same document as a trust root.",
        };

  const trustedIssuerShellValue =
    trustedIssuer ?? "replace-with-an-independently-trusted-issuer-address";
  // uid is already constrained to /^psp:[0-9a-f]{16}$/ by the handler.
  const apiUrl = `${getApiUrl()}/api/psp?uid=${psp.uid}`;
  const issuerUrl = safeHttpUrl(psp.issuer.url);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PSP ${escapeHtml(psp.uid)} — Disburse Settlement Proof</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e4e4e7; min-height: 100vh; padding: 2rem 1rem; }
    .container { max-width: 640px; margin: 0 auto; }
    .badge { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; margin-bottom: 0.75rem; }
    .badge.verified { background: #064e3b; color: #6ee7b7; }
    .badge.failed { background: #450a0a; color: #fca5a5; }
    .badge.pending { background: #422006; color: #fcd34d; }
    .status-detail { color: #a1a1aa; font-size: 0.8125rem; line-height: 1.5; margin-bottom: 1.5rem; }
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
    <div class="${status.className}">${escapeHtml(status.label)}</div>
    <p class="status-detail">${escapeHtml(status.detail)}</p>
    <h1>Portable Settlement Proof</h1>
    <p class="uid">${escapeHtml(psp.uid)}</p>

    ${
      psp.invoice
        ? `
    <div class="section">
      <h2>Invoice</h2>
      <div class="row"><span class="label">Request ID</span><span class="value">${escapeHtml(psp.invoice.requestId)}</span></div>
      <div class="row"><span class="label">Label</span><span class="value">${escapeHtml(psp.invoice.label)}</span></div>
      <div class="row"><span class="label">Amount</span><span class="value">${escapeHtml(psp.invoice.amount)} ${escapeHtml(psp.invoice.token)}</span></div>
      <div class="row"><span class="label">Payer</span><span class="value">${escapeHtml(truncateAddress(psp.invoice.payer))}</span></div>
      <div class="row"><span class="label">Recipient</span><span class="value">${escapeHtml(truncateAddress(psp.invoice.recipient))}</span></div>
      ${psp.invoice.invoiceDate ? `<div class="row"><span class="label">Date</span><span class="value">${escapeHtml(psp.invoice.invoiceDate)}</span></div>` : ""}
    </div>
    `
        : ""
    }

    <div class="section">
      <h2>Settlement (Arc Testnet)</h2>
      <div class="row"><span class="label">Chain ID</span><span class="value">${escapeHtml(String(psp.settlement.chainId))}</span></div>
      <div class="row"><span class="label">Tx Hash</span><span class="value"><a href="${escapeHtml(arcExplorer)}" target="_blank" rel="noopener noreferrer">${escapeHtml(truncateHash(psp.settlement.txHash))}</a></span></div>
      <div class="row"><span class="label">Block</span><span class="value">${escapeHtml(psp.settlement.blockNumber)}</span></div>
      <div class="row"><span class="label">Settled At</span><span class="value">${escapeHtml(psp.settlement.settledAt)}</span></div>
    </div>

    ${
      psp.source
        ? `
    <div class="section">
      <h2>Source Chain</h2>
      <div class="row"><span class="label">Chain ID</span><span class="value">${escapeHtml(String(psp.source.chainId))}</span></div>
      <div class="row"><span class="label">Tx Hash</span><span class="value">${
        sourceExplorer
          ? `<a href="${escapeHtml(sourceExplorer)}" target="_blank" rel="noopener noreferrer">${escapeHtml(truncateHash(psp.source.txHash))}</a>`
          : escapeHtml(truncateHash(psp.source.txHash))
      }</span></div>
      <div class="row"><span class="label">Payer</span><span class="value">${escapeHtml(truncateAddress(psp.source.payer))}</span></div>
    </div>
    `
        : ""
    }

    <div class="section">
      <h2>Cryptographic Proof</h2>
      <div class="row"><span class="label">Digest</span><span class="value">${escapeHtml(truncateHash(psp.digest))}</span></div>
      <div class="row"><span class="label">Algorithm</span><span class="value">${escapeHtml(psp.signature.alg)}</span></div>
      <div class="row"><span class="label">Claimed issuer</span><span class="value">${escapeHtml(truncateAddress(psp.issuer.publicKey))}</span></div>
      <div class="row"><span class="label">Network</span><span class="value">${escapeHtml(psp.networkMode)}</span></div>
      <div class="row"><span class="label">Version</span><span class="value">${escapeHtml(String(psp.version))}</span></div>
    </div>

    <div class="verify-box">
      <h2>Verify this proof yourself</h2>
      <pre>TRUSTED_ISSUER=${escapeHtml(trustedIssuerShellValue)}
npx @disburse/psp-verify proof.json --issuer "$TRUSTED_ISSUER"

# Or fetch and pipe:
curl -fsS "${escapeHtml(apiUrl)}" | npx @disburse/psp-verify --stdin --issuer "$TRUSTED_ISSUER"</pre>
    </div>

    <div class="footer">
      Claimed issuer: ${
        issuerUrl
          ? `<a href="${escapeHtml(issuerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(psp.issuer.name)}</a>`
          : escapeHtml(psp.issuer.name)
      }
    </div>
  </div>
</body>
</html>`;
}

function sendHtml(
  response: ApiResponse,
  statusCode: number,
  html: string
) {
  response.setHeader?.("content-type", "text/html; charset=utf-8");
  response.setHeader?.(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  response.setHeader?.("cache-control", "no-store");
  const next = response.status(statusCode);
  if (next.send) {
    next.send(html);
    return;
  }
  next.json(html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;
}

function truncateHash(hash: string): string {
  return hash.length > 16
    ? `${hash.slice(0, 10)}...${hash.slice(-8)}`
    : hash;
}

function getConfiguredTrustedIssuer(): Address | null {
  const value = process.env.PSP_TRUSTED_ISSUER;
  if (!value || !isAddress(value) || getAddress(value) === zeroAddress) {
    return null;
  }
  return getAddress(value);
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function getApiUrl(): string {
  // Never use VERCEL_URL: it is a per-deploy hostname and can leak account and
  // project names. Only a valid HTTP(S) public origin is accepted.
  return (
    safeHttpUrl(process.env.PSP_PUBLIC_URL || "")?.replace(/\/$/, "") ||
    "https://app.disburse.online"
  );
}
