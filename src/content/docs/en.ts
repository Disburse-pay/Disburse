import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_RPC_ENDPOINTS, TOKENS } from "../../lib/arc";
import { PAYMENT_VALIDITY_MINUTES } from "../../lib/payments";
import { PRODUCTION_DOCS_HOSTNAME } from "../../lib/routing";
import type { DocsSection, DocsSummaryItem } from "./types";

export const docsSections: DocsSection[] = [
  {
    title: "What Disburse is",
    body: [
      "Disburse is a testnet payments and receipts layer for stablecoins on Arc. It creates wallet-authorized QR invoices, sends USDC or EURC directly, verifies confirmed transfers, and issues Portable Settlement Proofs for accounting workflows.",
      "The wallet keeps custody and signs every transaction. Requests, payment status, PSP documents, statements, and notifications are processed by Disburse services. Historical ledger data is loaded only after a wallet signature and is never cached in browser storage.",
      "A signed proof is not automatically trustworthy merely because its embedded issuer key verifies it. Trusted PSP verification requires an issuer address obtained independently, and offline verification does not assert that settlement exists onchain."
    ],
    points: [
      "Implemented in this checkout: Arc QR invoicing, direct send, exact settlement verification, PSP issuance, private statements, notifications, and wallet-owned webhooks.",
      `Documentation is served from ${PRODUCTION_DOCS_HOSTNAME}.`,
      "Testnet only: do not treat the application, tokens, or deployment records as production payment infrastructure.",
      "The supported payment surface is Arc Testnet only; unrelated historical artifacts are not part of the product."
    ]
  },
  {
    title: "Tech and stack",
    body: [
      "The frontend is React 19 on Vite 6 with Tailwind CSS v4. All chain access goes through viem; there is no other web3 dependency. The backend is a small set of Vercel functions behind one dispatcher, with Supabase Postgres holding QR request state, PSP documents, and webhook registrations.",
      "Everything is pinned to Arc Testnet, chain id 5042002. Arc has one property worth understanding before anything else here: USDC exists twice. Gas is paid in native USDC with 18 decimals, while payments move the ERC-20 contract at 6 decimals. The app scales between the two and checks both sides of a transfer before it lets the wallet sign."
    ],
    points: [
      "Frontend: React 19, Vite 6, Tailwind CSS v4, viem.",
      "Backend: Vercel functions, Supabase Postgres, Resend for mail, pdf-lib for PDF output.",
      "Gas: legacy gas pricing with a 20 gwei floor; Arc does not use EIP-1559.",
      "Amount rule: ERC-20 USDC and EURC use 6 decimals; the native gas token uses 18."
    ]
  },
  {
    title: "Network and assets",
    body: [
      "The app is pinned to Arc Testnet. Native gas is represented as USDC with 18 decimals, while supported ERC-20 payment amounts use 6 decimals.",
      "RPC access is handled through a small failover list. The interface reports the active endpoint, latest block, safe gas price, chain id, and token decimal checks so a user can see whether the network path is healthy before signing."
    ],
    points: [
      `Chain ID: ${ARC_CHAIN_ID}`,
      `RPC: ${new URL(ARC_RPC_URL).host}`,
      `Failover endpoints: ${ARC_RPC_ENDPOINTS.length}`,
      `USDC: ${TOKENS.USDC.address}`,
      `EURC: ${TOKENS.EURC.address}`
    ]
  },
  {
    title: "Contracts",
    body: [
      "The source-controlled contract in this checkout is PspVerifier v2. It verifies an EIP-712 claim that binds the canonical PSP digest and every field the contract consumes to one chain and verifier deployment.",
      "The verifier distinguishes direct signature-only claims from full settlement claims. Its owner manages trusted issuers and versioned settlement contracts through explicit registries and two-step ownership.",
      "Historical artifacts mention QrPaymentSource and QrPaymentSettlement, but their audited Solidity source and deployment helper are absent. Stale artifacts must not be used to deploy fund-holding contracts."
    ],
    points: [
      "Direct mode verifies a registered issuer's field-bound signature and reports settlement as not checked.",
      "Settlement mode also requires an enabled, version-matched settlement contract to confirm the settlement ID.",
      "A PSP needs a matching onchainClaim, and the v2 verifier must be deployed and configured, before online verification can succeed."
    ]
  },
  {
    title: "Payment flows",
    body: [
      "Disburse separates immediate transfers from request-based payments. Direct Payments are used when the sender already knows the recipient, token, and amount. QR Payments are used when a requester wants to publish a fixed request for someone else to pay.",
      "A scanned QR request opens the payer page with the request details locked. The payer can connect a wallet, estimate the transfer, submit the transaction, verify the result, and download the invoice after confirmation."
    ],
    points: [
      "Payments: the sender enters recipient, token, and amount, then signs a wallet transfer.",
      "QR Payments: the requester enters recipient, token, amount, label, note, and invoice date, then shares a request URL as a QR code.",
      "Confirmed direct payments are registered as canonical account history and PSP records; they do not create QR capabilities."
    ]
  },
  {
    title: "QR capability payload",
    body: [
      "A payable QR code contains a /pay URL with a base64url v3 reference in the r query parameter. The reference contains only the server request ID and a random bearer capability; invoice fields are fetched from the canonical API before the pay button is enabled.",
      "Every request is authorized by its recipient wallet. The server stores a SHA-256 digest with the request plus an owner-bound encrypted recovery envelope in a private table, chooses the next Arc block as the verification start, and enforces a short payment expiry."
    ],
    points: [
      "v3 fields: version, id, and requestToken.",
      "Treat the URL as a bearer capability; do not put it in analytics, public screenshots, or support tickets.",
      `Default payment window: ${PAYMENT_VALIDITY_MINUTES} minutes. The confirmed block timestamp, not the browser clock, determines whether a transfer was in time.`,
      "Legacy v1/v2 links embedded unsigned invoice fields and are intentionally rejected."
    ],
    code: "/pay?r=<base64url({ version: 3, id, requestToken })>"
  },
  {
    title: "Wallet execution",
    body: [
      "Payments are standard ERC-20 transfer calls signed by the connected wallet. The app estimates gas with viem, applies Arc's configured gas-price floor, saves the wallet transaction hash as soon as it is submitted, and then waits for confirmation.",
      "The wallet remains the authority for signing. Disburse prepares calldata and displays checks, but the final approval happens inside the wallet."
    ],
    points: [
      "Connect: eth_requestAccounts.",
      "Network: wallet_switchEthereumChain, with wallet_addEthereumChain fallback for Arc Testnet.",
      "Transfer: eth_sendTransaction with ERC-20 transfer(recipient, parsedAmount) calldata on the selected USDC or EURC contract.",
      "Gas: estimates are used for display and balance checks; the wallet finalizes transaction gas at signing."
    ]
  },
  {
    title: "Wallet-scoped history",
    body: [
      "Payment requests and receipts are loaded from Supabase only after the active wallet signs a short-lived history authorization. Switching or disconnecting the wallet clears the ledger from browser memory before the next account is loaded.",
      "QR bearer capabilities are encrypted at rest with AES-256-GCM and bound to the owner wallet plus request id. The database stores only the capability digest with the public request row; only the authenticated owner-history path unwraps the private envelope.",
      "The browser retains no historical ledger cache. Its only payment-related persistent state is an account-scoped recovery journal for a transaction that was broadcast but has not yet completed canonical server registration."
    ],
    points: [
      "History access is EIP-712 signed, wallet-scoped, short-lived, and served with cache-control: no-store.",
      "Global legacy browser-ledger keys are removed on application startup.",
      "Routine JSON exports omit QR bearer capabilities and payer authorizations.",
      "Only a canonical server confirmation may transition a server-backed payment to paid."
    ]
  },
  {
    title: "Invoice output",
    body: [
      "After the payer confirms and the transfer is verified from Arc Testnet data, the receipt surface exposes exportable documents and the backend-issued PSP when configured.",
      "PDF and UBL invoices are produced in the browser. PSP documents are signed by the backend issuer and can be fetched by UID or payment request id."
    ],
    points: [
      "Invoice includes tx hash, block, amount, label, note, invoice date, payer, recipient, confirmation time, and Arcscan link.",
      "PSP includes the invoice fields, Arc Testnet settlement fields, digest, UID, and issuer signature.",
      "Invoice date is display metadata, not the payment expiry.",
      "No server stores or emails PDF/UBL files in this build."
    ]
  },
  {
    title: "Portable Settlement Proofs",
    body: [
      "A PSP is a content-addressed JSON receipt signed by an issuer. Digest, UID, and signature self-consistency prove that the document has not changed since that issuer signed it; they do not prove that the embedded issuer is trustworthy.",
      "Trusted offline verification requires an issuer address from independent configuration. It explicitly reports settlement as not checked. Full online settlement verification also requires a matching PspVerifier v2 claim and a configured onchain registry."
    ],
    points: [
      "Lookup by UID: /api/psp?uid=psp:...",
      "Lookup by request requires /api/psp?request_id=<uuid> plus the QR request capability header.",
      "Viewer: /api/psp-viewer?uid=psp:...",
      "CLI: npx @disburse/psp-verify proof.json --issuer 0xIndependentlyTrustedIssuer",
      "The public API supports lookup by an unguessable PSP identifier; database-wide PSP enumeration is disabled."
    ]
  },
  {
    title: "Payment confirmation",
    body: [
      "Server-backed QR confirmation accepts a caller-supplied transaction hash only as a candidate. It fetches the receipt and block, rejects reverted transactions, and requires the exact token contract, transaction hash, payer, recipient, amount, start block, and block timestamp.",
      "The payer signs an EIP-712 authorization over the canonical request. The database then atomically prevents transaction reuse, inserts the receipt, updates paid state, and records the event. A bad candidate hash returns an error without failing the invoice."
    ],
    points: [
      "Paid: canonical server confirmation committed the exact transfer atomically.",
      "Submitted: a transaction may exist, but trusted confirmation is still pending.",
      "Expired: no valid in-window transfer was confirmed.",
      "Imported or legacy data never creates a trusted paid state."
    ],
    code: "match = log.address == token && log.transactionHash == txHash && log.args.from == payer && log.args.to == recipient && log.args.value == amount"
  },
  {
    title: "API and webhooks",
    body: [
      "Sensitive APIs are authenticated by scope. QR status and mutations require the request capability; QR creation, history, statements, notifications, and webhook management require short-lived wallet signatures. PSP retrieval remains capability-like by unguessable UID.",
      "Webhooks are wallet-owned and may subscribe only to PSPs received by that wallet. HTTPS destinations are DNS-vetted and IP-pinned to prevent private-network SSRF and DNS rebinding. Redirects are rejected.",
      "Each webhook delivery signs the exact JSON body with HMAC-SHA256. Statements filter in the database before pagination, require the authorizing wallet as payer or recipient, and keep mixed-token totals separate."
    ],
    points: [
      "GET /api/psp?uid=... or ?request_id=... fetches a proof.",
      "POST /api/psp/verify?issuer=0x... requires an independently trusted issuer and does not claim an onchain settlement check.",
      "GET or POST /api/statements requires signed wallet, expiry, and signature headers.",
      "GET, POST, and DELETE /api/webhooks require signed owner authorization; returned secrets and URLs are redacted.",
      "Webhook delivery uses bounded concurrency and a five-second timeout."
    ]
  }
];

export const docsSummaryItems: DocsSummaryItem[] = [
  {
    label: "Network",
    value: `Arc Testnet ${ARC_CHAIN_ID}`
  },
  {
    label: "Assets",
    value: "USDC and EURC"
  },
  {
    label: "Custody",
    value: "Wallet signed, non-custodial"
  },
  {
    label: "Receipts",
    value: "Verified from Arc Testnet logs"
  }
];
