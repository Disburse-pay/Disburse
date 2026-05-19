import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_RPC_ENDPOINTS, TOKENS } from "../../lib/arc";
import { PAYMENT_VALIDITY_MINUTES } from "../../lib/payments";
import { PRODUCTION_DOCS_HOSTNAME } from "../../lib/routing";
import type { DocsSection, DocsSummaryItem } from "./types";

export const docsSections: DocsSection[] = [
  {
    title: "Project scope",
    body: [
      "Disburse is an Arc Testnet proof layer for stablecoin payments. Its primary job is to turn a settled QR invoice into a Portable Settlement Proof (PSP) that software, accountants, auditors, or smart contracts can verify.",
      "The current build is intentionally narrow. The browser prepares the request, the wallet signs the transaction, and payment status is verified against Arc Testnet data. Cross-chain testnet routes use source escrow plus prefunded Arc settlement liquidity."
    ],
    points: [
      "Primary app routes: /qr-payments, /pay, /statements, and /docs.",
      `Documentation is served from ${PRODUCTION_DOCS_HOSTNAME}.`,
      "Supported actions: QR request creation, wallet payment, Arc Testnet verification, PSP lookup, statement bundle generation, UBL/PDF/JSON export, import/export, and direct transfer utility.",
      "Out of scope for this release: custodial balances, Permit2, backend-enforced 402 flows, MPP rails, and server-side replay protection."
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
      "Direct Payments do not create QR request records in the local ledger."
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
    title: "QR request payload",
    body: [
      "A QR code contains a /pay URL with a base64url JSON payload in the r query parameter. The payload is only a portable request description; it never contains a private key, wallet approval, token balance, or signed transaction.",
      "The request records the token, amount, recipient, label, creation time, and start block. That start block limits verification to transfers that happened after the request was created."
    ],
    points: [
      "Required fields: version, id, recipient, token, amount, label, createdAt, and startBlock.",
      "Optional fields: note, invoiceDate, expiresAt, and dueAt.",
      `Default expiry: ${PAYMENT_VALIDITY_MINUTES} minutes after creation. A submitted payment attempt that started before expiry can still be verified.`
    ],
    code: "/pay?r=<base64url({ version, id, recipient, token, amount, label, note?, invoiceDate?, expiresAt?, dueAt?, createdAt, startBlock })>"
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
    title: "Local ledger and realtime",
    body: [
      "QR requests and receipts are stored in browser localStorage so the requester can manage work without creating an account. The ledger supports JSON export and import for backup or migration.",
      "When Supabase is configured, QR requests can also be written through Vercel API functions. Realtime events allow the requester view to close a QR code when the payer submits, confirms, fails, or expires a request."
    ],
    points: [
      "Storage keys: disburse.requests and disburse.receipts.",
      "Legacy keys are still read: arc-pay-desk.requests and arc-pay-desk.receipts.",
      "Requests are keyed by request id. Receipts are upserted by request id or transaction hash.",
      "Imported explorer URLs are regenerated from the verified Arcscan transaction hash."
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
      "A PSP is the machine-verifiable receipt artifact. It is a signed, content-addressed JSON document proving that a specific invoice settled on Arc Testnet.",
      "The same proof can be verified by API, CLI, or the on-chain verifier contract without depending on Disburse's hosted UI."
    ],
    points: [
      "Lookup by UID: /api/psp?uid=psp:...",
      "Lookup by request: /api/psp?request_id=<uuid>.",
      "Viewer: /api/psp-viewer?uid=psp:...",
      "CLI: npx @disburse/psp-verify proof.json --issuer 0x..."
    ]
  },
  {
    title: "Verification",
    body: [
      "Verification first checks a known transaction hash. If no hash is present, it scans ERC-20 Transfer logs in 10,000-block windows from the request start block to latest and compares recipient plus exact token amount.",
      "A request is marked paid only when the token contract, recipient, and amount match. Transfers to the right recipient with a different amount are surfaced separately so the user can review them without treating them as settled."
    ],
    points: [
      "Paid: exact transfer to the recipient for the requested token amount.",
      "Possible match: transfer to the recipient exists, but the amount differs.",
      "Open: no matching transfer was found from the request start block."
    ],
    code: "match = log.address == token && log.args.to == recipient && log.args.value == parseUnits(amount, token.decimals)"
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
