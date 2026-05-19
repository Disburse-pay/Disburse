<div align="center">

<img src="public/disburse-logo.png" alt="Disburse" width="96" />

# Disburse

**A receipt layer for stablecoin payments.**

Issue a QR invoice. The payer settles in USDC from any supported chain. Disburse turns the onchain transfer into a structured, verifiable receipt &mdash; a document your accountant, auditor, or tax office can file.

[App](https://app.disburse.online) &middot; [Docs](https://docs.disburse.online) &middot; [X](https://x.com/Disburs3) &middot; [GitHub](https://github.com/Disburse-pay)

</div>

---

## The problem

Stablecoin volume is on track to settle trillions of dollars a year. The accounting infrastructure around it is not. A block explorer link is not evidence an invoice was paid &mdash; not for an auditor, not for a tax office, not for an enterprise AP system.

Freelancers rebuild spreadsheets by hand. DAOs reconcile from Discord screenshots. Enterprises pay accountants to re-derive what already exists on chain. Every settlement happens twice: once on the chain, once in a shadow ledger.

**Disburse closes that gap.** A transaction hash becomes a signed, structured, auditor-ready receipt that any third party can independently re-derive from raw chain data.

## How it works

| Step | What happens |
| --- | --- |
| **1. Request** | The requester generates a QR payload with recipient, token, amount, label, invoice date, and expiry. |
| **2. Pay** | The payer scans the QR, picks a source chain (Arc, Base, or Monad), and signs a standard ERC-20 transfer. No signup. |
| **3. Settle** | On Arc the transfer is direct. On Base and Monad, Polymer proves the source escrow event and a relayer submits `settle(proof)` to the Arc settlement contract. |
| **4. Verify** | Disburse matches the exact token contract, recipient, and amount against the onchain `Transfer` log. Fuzzy matches never auto-settle. |
| **5. Receipt** | A Verifiable Settlement Receipt (VSR) is produced. Export as JSON proof, UBL 2.1 XML, or PDF. |

## Why it matters

- **Wallet-signed.** Disburse never receives private keys. Arc-native payments go wallet-to-recipient; cross-chain testnet routes use source escrow plus prefunded Arc settlement liquidity.
- **Arc Testnet as the proof layer.** Cross-chain payers see one invoice, pay from a supported testnet source, and the recipient receives USDC through Arc settlement.
- **Compliance-ready exports.** UBL 2.1 drops into existing EU e-invoicing pipelines. PDFs go to finance inboxes. JSON proofs are SHA-256 fingerprinted so third parties can re-verify independently.
- **Built on Arc.** The settlement contract lives on Arc, aligning the product with Circle's economic OS for the internet.

## Stack

- Vite + React 19 + TypeScript
- viem for wallet / RPC / contract calls
- Supabase Realtime for cross-device QR payment status updates
- Polymer Prove API for testnet cross-chain event proofs
- qrcode for QR image generation
- pdf-lib for local invoice PDFs
- Vitest for unit tests

## Scripts

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # Vitest
npm run markets:create -- --question "Will Arc mainnet launch by 2026-07-01?" --closes-at "2026-07-01T00:00:00.000Z"
npm run build
```

The dev server binds to `0.0.0.0` and routes all paths to `index.html` via `vercel.json`.

Documentation is served from `docs.disburse.online` on the same Vercel project. The app treats that subdomain as the docs site.

Supabase-backed QR realtime and the `/api/*` handlers require a Vercel context. Run `vercel dev` locally or deploy to Vercel; plain Vite dev still supports the local-only QR fallback.

### Prediction markets admin

Create a market with the admin helper after applying the markets Supabase migrations and deploying the markets contracts:

```bash
npm run markets:create -- \
  --question "Will Arc mainnet launch by 2026-07-01?" \
  --closes-at "2026-07-01T00:00:00.000Z" \
  --category Crypto \
  --description "Resolves YES if Arc mainnet is publicly operational by the close time."
```

For an M2 smoke probe, create a short-lived market and use the printed `MARKETS_SMOKE_MARKET_ID`:

```bash
npm run markets:create -- \
  --question "Smoke market" \
  --close-in-minutes 8 \
  --category Smoke

node --env-file=.env.local --import tsx scripts/smoke-markets.ts
```

Required env for creation: `ADMIN_API_KEY`, `SUPABASE_URL` or `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MARKETS_FACTORY`, and `MARKETS_RELAYER_PRIVATE_KEY`.

The Vercel Hobby plan only allows daily cron jobs, so `vercel.json` schedules `/api/markets-expire-orders` once per day. On Vercel Pro, change the schedule to `*/5 * * * *` for five-minute expiry sweeps.

## Environment

### Realtime

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Apply `supabase/migrations/202604300001_qr_realtime.sql` to create the payment request, receipt, and realtime event tables before enabling the production realtime flow.
Apply `supabase/migrations/202604300002_crosschain_qr_payments.sql` to add Arc-settlement columns and the proving/settling realtime event types.

### Arc-settlement QR (cross-chain)

```bash
POLYMER_TESTNET_API_KEY=
QR_DEPLOYER_PRIVATE_KEY=

ARC_QR_PAYMENT_SETTLEMENT=
ARC_RELAYER_PRIVATE_KEY=

VITE_BASE_SEPOLIA_USDC_ADDRESS=
VITE_BASE_SEPOLIA_QR_PAYMENT_SOURCE=
BASE_SEPOLIA_USDC_ADDRESS=
BASE_SEPOLIA_QR_PAYMENT_SOURCE=

VITE_MONAD_USDC_ADDRESS=0x534b2f3A21130d7a60830c2Df862319e593943A3
VITE_MONAD_QR_PAYMENT_SOURCE=
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_USDC_ADDRESS=0x534b2f3A21130d7a60830c2Df862319e593943A3
MONAD_QR_PAYMENT_SOURCE=
```

### Contract deployment helper

```bash
npm run deploy:qr-contracts -- --compile-only
npm run deploy:qr-contracts -- --add-monad-source
```

The Monad migration helper reads `QR_DEPLOYER_PRIVATE_KEY`, `ARC_QR_PAYMENT_SETTLEMENT`, Monad USDC / source settings, the old MegaETH source address if overridden, and optional RPC overrides from local env files or the process environment. It deploys only the Monad `QrPaymentSource`, configures the existing Arc settlement contract, disables the old MegaETH source authorization, writes deployment metadata to `deployments/`, and writes public contract addresses to `.env.qr-contracts.generated`. Use `npm run deploy:qr-contracts -- --full` only when intentionally deploying a fresh Arc / Base / Monad contract set.

### Current testnet deployment

- Arc settlement contract: `0x8c535227ed2b2963a3c1176510bc59e7a7fef07d`
- Base Sepolia source contract: `0x8c535227ed2b2963a3c1176510bc59e7a7fef07d`
- Monad Testnet source contract: set `MONAD_QR_PAYMENT_SOURCE` after running the Monad deployment helper.
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Monad Testnet USDC: `0x534b2f3A21130d7a60830c2Df862319e593943A3`
- Arc USDC: `0x3600000000000000000000000000000000000000`
- Arc settlement liquidity: `10 USDC`

Existing Arc/Base deployment metadata is recorded in `deployments/qr-contracts-1777594760061.json`; the Monad migration helper will add a new deployment JSON. The generated public env file is `.env.qr-contracts.generated`; it is ignored by git and should be copied into local or Vercel environment settings as needed.

## Routes

- `/`. Landing page.
- `/payments`. direct wallet transfer flow.
- `/qr-payments`. create, preview, export, import, and manage QR payment requests.
- `/pay?r=<payload>`. payer page opened from a QR code.
- `docs.disburse.online`. project documentation for the current build.

## Network and assets

Disburse is pinned to Arc Testnet as the settlement chain.

- Chain ID: `5042002`
- Explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com`
- Native gas symbol: `USDC` with 18 decimals
- ERC-20 USDC: `0x3600000000000000000000000000000000000000`
- ERC-20 EURC: `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`
- ERC-20 token decimals: `6`

RPC failover is configured across Arc public, Blockdaemon, dRPC, and QuickNode testnet endpoints. The app probes endpoint health and displays live block, safe gas, chain, RPC, and token decimal status.

QR payment source choices currently target:

- Arc Testnet: chain ID `5042002`, RPC failover listed above, explorer `https://testnet.arcscan.app`.
- Base Sepolia: chain ID `84532`, RPC `https://sepolia.base.org`, explorer `https://sepolia-explorer.base.org`.
- Monad Testnet: chain ID `10143`, RPC `https://testnet-rpc.monad.xyz`, explorer `https://testnet.monadscan.com`, gas token `MON`.
- Polymer testnet prover: `0x03Fb5bFA4EB2Cba072A477A372bB87880A60fC96`.

QR Payments are USDC-only and always settle on Arc Testnet. Arc source payments use the existing Arc ERC-20 transfer path. Base Sepolia and Monad source payments use a configured 6-decimal ERC-20 source token, `QrPaymentSource` escrow, Polymer proof, and a prefunded Arc `QrPaymentSettlement` contract. Polymer proves the source escrow event; it does not supply liquidity by itself. Monad payers need Monad Testnet `MON` for gas and Monad Testnet USDC from Circle's faucet.

## Portable Settlement Proofs (PSP)

Every settled payment can produce a **Portable Settlement Proof** — a signed, content-addressed JSON document verifiable three ways:

1. **Offline** — `verify(psp)` in the `@disburse/psp-verify` npm package
2. **CLI** — `npx @disburse/psp-verify proof.json --issuer 0x…`
3. **On-chain** — `PspVerifier.verify(digest, signature, fields)` on Arc

No trust in Disburse infrastructure required. The open spec lives at [`spec/psp-v1.md`](./spec/psp-v1.md).

### PSP environment

```bash
ENABLE_PSP=1
DISBURSE_PSP_SIGNING_KEY=0x...   # secp256k1 key (signs proofs, does NOT hold funds)
PSP_NETWORK_MODE=testnet
ARC_SETTLEMENT_CONTRACT=0x8c535227ed2b2963a3c1176510bc59e7a7fef07d
```

### PSP verifier deployment

```bash
node scripts/deploy-psp-verifier.mjs
```

Requires `QR_DEPLOYER_PRIVATE_KEY`, `DISBURSE_PSP_SIGNING_KEY`, and `ARC_SETTLEMENT_CONTRACT`.

### Verify a PSP

```bash
# Offline
npx @disburse/psp-verify proof.json --issuer 0xYourIssuerAddress

# From the API
curl -s https://disburse.app/api/psp?uid=psp:abc123def456abcd | npx @disburse/psp-verify --stdin
```

## Wallet flow

The app expects an injected EIP-1193 wallet.

1. `eth_requestAccounts` connects the wallet.
2. `wallet_switchEthereumChain` switches to Arc Testnet.
3. `wallet_addEthereumChain` is used as a fallback when Arc Testnet is not already known by the wallet.
4. Transfers submit `eth_sendTransaction` with ERC-20 `transfer(recipient, parsedAmount)` calldata.
5. viem estimates gas and applies the configured Arc gas-price floor.
6. The app saves the transaction hash as soon as the wallet returns it, then waits for one confirmation.

The app never receives private keys and does not custody funds.

## QR payment requests

A QR code contains a `/pay` URL with a base64url JSON payload in the `r` query parameter.

Legacy payload version `1` is still accepted for imported and already shared Arc QR requests:

```ts
{
  version: 1,
  id: string,
  recipient: `0x${string}`,
  token: "USDC" | "EURC",
  amount: string,
  label: string,
  note?: string,
  invoiceDate?: string,
  expiresAt?: string,
  dueAt?: string,
  createdAt: string,
  startBlock: string
}
```

Current QR requests use payload version `2`:

```ts
{
  version: 2,
  id: string,
  recipient: `0x${string}`,
  token: "USDC",
  amount: string,
  label: string,
  note?: string,
  invoiceDate?: string,
  expiresAt?: string,
  dueAt?: string,
  createdAt: string,
  destinationChainId: 5042002,
  allowedSourceChainIds: Array<5042002 | 84532 | 10143>
}
```

QR requests default to a 15 minute validity window. A payment attempt that starts before expiry can still be verified after the expiry timestamp.

The scanned payer page locks the request details. The payer can connect a wallet, estimate, send, verify, and download the invoice after payment.

When Supabase is configured, QR requests are also written through Vercel API functions. The payer reports submitted transaction hashes and the selected source chain to `/api/qr-submissions`; after confirmation, `/api/qr-confirmations` either verifies Arc Testnet ERC-20 transfer logs or settles a remote source payment on Arc. Requester screens subscribe to `payment_request_events`, so paid, failed, and expired states close the QR and replace it with a final status panel.

For Base Sepolia and Monad sources, `/api/qr-confirmations` reads the source-chain `QrPaymentInitiated` log, requests a Polymer proof, submits `settle(proof)` to the Arc settlement contract from the configured backend relayer, and stores the Arc settlement receipt. Realtime event types include `submitted`, `proving`, `settling`, `paid`, `failed`, and `expired`.

## Local data

QR requests and receipts are stored in browser localStorage:

- `disburse.requests`
- `disburse.receipts`

Legacy keys are still read for migration:

- `arc-pay-desk.requests`
- `arc-pay-desk.receipts`

The QR ledger supports JSON export/import. Import recovery normalizes valid requests and receipts, drops malformed records, and regenerates receipt explorer URLs from Arcscan transaction hashes.

Direct Payments do not create QR request records. The page only keeps the latest direct transfer hash in the current browser session.

## Verification

Direct and Arc-source QR verification checks Arc Testnet ERC-20 `Transfer` logs. Base Sepolia and Monad-source QR verification checks the source escrow event and the relayed Arc settlement receipt.

If a request has a known transaction hash, Disburse reads that transaction receipt first. Otherwise it scans logs from the request `startBlock` to latest in 10,000-block windows.

Status rules:

- `paid`: exact transfer to the request recipient for the requested token amount.
- `failed`: submitted transaction reverted, did not pay the request, or paid the recipient with the wrong amount.
- `possible_match`: local log scan found a transfer to the recipient with a different amount before a submitted transaction was known.
- `open`: no matching transfer was found.
- `expired`: request is past its expiry and no pre-expiry payment attempt was submitted.

Receipts contain request id, transaction hash, payer, recipient, token, amount, block number, confirmation time, and Arcscan URL.

## Receipts and invoices

A successful verification produces three export formats, all derived from the same underlying onchain fact:

| Format | Audience | Contents |
| --- | --- | --- |
| **VSR (JSON)** | Auditors, third-party verifiers | Structured settlement record with a SHA-256 fingerprint. Re-derivable from the transaction hash without Disburse. |
| **UBL 2.1 (XML)** | EU e-invoicing pipelines | Machine-readable invoice compatible with existing public sector and enterprise AP systems. |
| **PDF** | Humans, finance inboxes | Clean one-page receipt with amount, parties, tx hash, and Arcscan link. |

Invoice files are generated in the browser. They are not uploaded or emailed by the app.

## Roadmap

The testnet MVP covers end-to-end payment, verification, and receipt export. What comes next:

- **Mainnet launch on Arc** once Arc mainnet is available.
- **More source chains**. additional Polymer-supported chains as routes expand.
- **Recurring invoices and retainers** using Permit2 for scheduled pulls.
- **Team accounts**. multi-recipient workspaces without custody.
- **Webhook + API**. push paid-state events into QuickBooks, Xero, Notion, and Zapier.
- **Attestation marketplace**. attach external attestations (KYC, business registry, sanctions screening) to a VSR.

## License

MIT. see [`LICENSE`](LICENSE) if present, otherwise all rights reserved pending license selection.

---

<sub>Disburse is an independent project built on the USDC ecosystem. Not affiliated with Circle Internet Financial.</sub>
