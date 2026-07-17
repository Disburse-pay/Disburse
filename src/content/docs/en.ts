import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_RPC_ENDPOINTS, TOKENS } from "../../lib/arc";
import { PAYMENT_VALIDITY_MINUTES } from "../../lib/payments";
import { PRODUCTION_DOCS_HOSTNAME } from "../../lib/routing";
import type { DocsSection, DocsSummaryItem } from "./types";

export const docsSections: DocsSection[] = [
  {
    title: "What Disburse is",
    body: [
      "Disburse is a payments and receipts layer for stablecoins on Arc. It does three things: it lets anyone publish a payment request as a QR invoice, it lets anyone send USDC or EURC directly, and it turns every settled payment into a Portable Settlement Proof that software can verify without trusting Disburse.",
      "The wallet keeps custody and signs every transaction. Disburse prepares requests, checks the network before signing, verifies settlement against chain data afterwards, and issues the paperwork: invoices, statement bundles, and signed proofs. No balances are held and no keys ever leave the wallet.",
      "The near-term direction is Circle Gateway and CCTP V2. Gateway provides a unified USDC balance across chains without Disburse custodying funds, and CCTP V2 covers one-shot payments into Arc from other chains. Deposit, withdraw, transfer, and batch transfer against a Disburse ID are the four verbs this build is growing toward."
    ],
    points: [
      "Live today: QR invoicing, direct send, settlement verification, PSP issuance, statements, webhooks.",
      `Documentation is served from ${PRODUCTION_DOCS_HOSTNAME}.`,
      "Planned next: Gateway-backed deposit and withdraw, batch payouts in one transaction, handle-based recipients.",
      "Out of scope for this release: custodial balances, Permit2, backend-enforced 402 flows, and server-side replay protection."
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
      "Three contracts back this build. PspVerifier anchors proof checking on-chain: it reconstructs a PSP digest from the document fields, recovers the issuer from the signature, and confirms the referenced settlement actually happened. It is view-only, holds no funds, and cannot be paused, so a proof stays checkable even if every Disburse server disappears.",
      "QrPaymentSource and QrPaymentSettlement carry the cross-chain testnet route. The source contract escrows the payer's funds on the origin chain; the settlement contract pays the recipient on Arc from prefunded liquidity once the escrow is proven. This pair is scheduled for retirement: once deposits and transfers run through Circle Gateway, the escrow route has no job left."
    ],
    points: [
      "PspVerifier: on-chain verification of signed settlement proofs, digest plus ecrecover plus settlement lookup.",
      "QrPaymentSource: origin-chain escrow for cross-chain QR payments.",
      "QrPaymentSettlement: Arc-side payout from prefunded liquidity."
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
  },
  {
    title: "API and webhooks",
    body: [
      "The API is a small JSON surface and is unauthenticated in this testnet build. QR request state, PSP lookup, statement bundles, and webhook management are all plain HTTPS endpoints served by the same Vercel dispatcher.",
      "Webhooks fire when a PSP is issued. Each delivery is signed with HMAC-SHA256 using the webhook's secret and carries the signature in the X-Disburse-Signature header, so the receiver can check integrity before acting. Statement bundles aggregate PSP proofs over a date range with filters for recipient, payer, and token."
    ],
    points: [
      "GET /api/psp?uid=... or ?request_id=... fetches a proof.",
      "POST /api/statements builds a statement bundle; GET works for simple queries via query params.",
      "GET, POST, and DELETE on /api/webhooks manage endpoints; secrets are masked on read.",
      "Webhook deliveries time out after 10 seconds and are signed per delivery."
    ]
  }
];

/**
 * Arcade docs: Cluck Run, the coin-op game on Arc Testnet. Written from the
 * actual source in the separate arcade repo; deployed at arcade.disburse.online.
 */
export const arcadeSections: DocsSection[] = [
  {
    title: "Cluck Run",
    body: [
      "Cluck Run is a coin-op arcade game on Arc Testnet, deployed at arcade.disburse.online as its own build, separate from the payments app. It is an endless lane runner: grass, roads, rails, and rivers scroll ahead of a chicken, and the score is the number of rows crossed before the run ends.",
      "The arcade exists to prove the payment rail in the most literal way possible. One play costs one coin, the coin is a real on-chain payment in native USDC, and the day's prize pot is simply the sum of the day's coins."
    ],
    points: [
      "Runs at arcade.disburse.online as a separate deployment.",
      "Wallet connection via Dynamic; chain access via viem.",
      "Built with React 19 and Vite; the game itself is plain TypeScript on a canvas renderer."
    ]
  },
  {
    title: "The coin slot",
    body: [
      "CoinSlot is the single contract behind the game. insertCoin() is payable and requires exactly pricePerPlay in native USDC, currently 1 USDC. Every coin increments an on-chain counter and emits CoinInserted, and the contract balance is the prize pot.",
      "Prizes are paid by an operator account. payPrize sends part of the pot to a winner and emits PrizePaid tagged with the day it covers, so payouts are auditable from event logs alone. The owner can change the price and rotate the operator, and both changes emit events."
    ],
    points: [
      "Contract: 0xb69a635c1e39e2a96e1707335be1d5a0199e645a on Arc Testnet (5042002).",
      "insertCoin() reverts unless msg.value equals pricePerPlay.",
      "prizePot() is the contract balance; there is no separate accounting.",
      "PrizePaid(player, amount, day) makes daily payouts verifiable from logs."
    ],
    code: "function insertCoin() external payable;\nevent CoinInserted(address indexed player, uint256 amount, uint256 indexed nonce);\nevent PrizePaid(address indexed player, uint256 amount, uint256 indexed day);"
  },
  {
    title: "Runs and the leaderboard",
    body: [
      "A run starts server-side. The client submits the coin transaction hash; the server reads the receipt, confirms the transaction targeted the coin slot and that its CoinInserted event names the player's wallet, then issues a run id and a random seed. One transaction buys exactly one run, and reusing a spent hash is rejected.",
      "Scores are checked against physics before they reach the board. The server caps the score by elapsed time, using a ceiling of 4 rows per second plus a small start allowance, and by an absolute maximum, so impossible scores are refused. The leaderboard is daily by UTC date, shows the top ten, and lives in Supabase alongside runs and profiles."
    ],
    points: [
      "Usernames are claimed by signing cluckrun:username:v1:<name> with the wallet.",
      "Username rules: 3 to 16 characters, letters, digits, underscore; taken names return a conflict.",
      "Runs, daily scores, and profiles are stored in Supabase keyed by wallet address."
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
