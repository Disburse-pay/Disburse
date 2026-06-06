<div align="center">

<img src="public/disburse-logo.png" alt="Disburse" width="96" />

# Disburse

**A receipt layer for stablecoin payments.**

Issue a QR invoice. The payer settles in USDC from any supported chain. Disburse turns the onchain transfer into a structured, verifiable receipt. This receipt is a document your accountant, auditor, or tax office can file.

[App](https://app.disburse.online) &middot; [Docs](https://docs.disburse.online) &middot; [X](https://x.com/Disburs3) &middot; [GitHub](https://github.com/Disburse-pay)

</div>

---

## Technical Overview

Disburse is a cryptographic receipt and settlement layer for stablecoin transactions. It validates onchain transfers of USDC across different EVM testnets and produces content-addressed, mathematically verifiable PDF, XML (UBL 2.1), and JSON documents.

### Key Features

1. **Structured QR Invoicing**: Generates signed JSON invoices containing metadata (recipient, amount, label, invoice date, expiry) packed into base64url payloads inside QR codes.
2. **Cross-Chain Payments**: Payers can pay from **Base Sepolia** or **Monad Testnet** using remote escrows that route settlements to **Arc Testnet** via Polymer cryptographic state proofs in 2 to 5 minutes.
3. **Direct Send (Wallet-to-Wallet)**: Direct peer-to-peer payments on Arc Testnet, generating immediate verifiable receipts.
4. **Portable Settlement Proofs (PSP)**: Cryptographically signed, content-addressed JSON proofs verifying stablecoin settlement without relying on Disburse infrastructure.
5. **Milestone Invoice Chains**: Sequential payment flows where the settlement proof of milestone $N-1$ acts as the cryptographic unlock condition for milestone $N$.
6. **Prediction Markets (Beta)**: Binary YES/NO outcome markets with orderbooks operating on Arc Testnet, allowing shares to be minted, traded, and claimed, generating specialized market-claim PSPs.
7. **Webhooks & APIs**: Secure event notification using HMAC-SHA256 signatures with automatic retry policies and deactivation limits.

---

## Cryptographic Specifications

### Portable Settlement Proof (PSP) v1.0
A PSP proves that a specific invoice was paid by a specific onchain transfer. It is structured, content-addressed, and independently verifiable.

#### Structure
A PSP document contains:
- `version` (currently `1`)
- `networkMode` (`"testnet"` or `"mainnet"`)
- `issuer` information including EVM public signing key
- `invoice` metadata (payer, recipient, amount, note, dates)
- `settlement` data (block number, transaction hash, settlement ID)
- `signature` containing a compact 65-byte EVM signature (`secp256k1-keccak256`) over the canonicalized document digest

#### Verification Flow
Verification requires no interaction with Disburse servers:
1. **Omit ephemeral fields**: Remove `digest`, `signature`, `uid`, and `createdAt` from the document.
2. **Canonicalize**: Deterministically sort keys lexicographically, strip whitespace, lowercase hex strings, and format as JSON.
3. **Prepend Domain Separator**: Prepend `"DISBURSE-PSP-v1\n" + networkMode + "\n"`.
4. **Compute Digest**: Compute the `keccak256` hash of the canonical bytes.
5. **Recover Signer**: Recover the EVM address from the EIP-191 personal sign signature and assert it matches the registered `issuer.publicKey`.
6. **Onchain Check**: (Optional) Verify via [PspVerifier.sol](file:///d:/Stressed/contracts/src/PspVerifier.sol) on Arc to ensure the settlement transaction was recorded.

### PSP v1.1 Markets Addendum
Extends PSPs to support prediction-market claims. Instead of an `invoice` block, the proof includes a `marketClaim` block specifying:
- `marketId` (off-chain UUID)
- `onchainMarket` (address of the [Market.sol](file:///d:/Stressed/contracts/src/markets/Market.sol) contract)
- `outcome` and `winningOutcome` redeemed
- `sharesRedeemed` and `payoutAmount` (using 1e6 fixed-point scale)
- Payout transactions emit `MarketClaimed` events matched by [MarketsPspVerifier.sol](file:///d:/Stressed/contracts/src/markets/MarketsPspVerifier.sol).

---

## Repository Architecture

The project is structured as a TypeScript monorepo containing smart contracts, frontend client apps, Vercel API handlers, and background helper scripts:

```
├── .env.example                       # Base environment template
├── api/                               # Main API routing
│   └── index.ts                       # Vercel serverless request router
├── api-handlers/                      # Vercel serverless endpoint controllers
│   ├── markets*.ts                    # Prediction markets read/write handlers
│   ├── psp*.ts                        # PSP document retrieval & verification handlers
│   └── qr*.ts                         # QR invoice registration and event streams
├── contracts/                         # Solidity smart contracts
│   ├── README.md                      # Contract deployment guides
│   └── src/                           # Solidity source directory
│       ├── PspVerifier.sol            # Onchain validation of EIP-191 signatures
│       ├── QrPaymentSettlement.sol    # Arc settlement & cross-chain proof verification
│       ├── QrPaymentSource.sol        # Cross-chain remote token escrow
│       └── markets/                   # Central Limit Orderbook prediction market suite
├── deployments/                       # Compiled ABIs and contract deployment logs
├── docs/                              # In-depth technical articles and specifications
├── packages/                          # Monorepo packages
│   └── psp-verify/                    # Standalone TS validator & CLI utility
├── public/                            # Static asset directory
├── scripts/                           # Maintenance and simulation helper scripts
├── server/                            # Persistent Node.js/Express backend service
│   ├── markets/                       # Market order-book processing and repo engine
│   ├── psp/                           # Background PSP issuance and event monitoring
│   └── crosschain.ts                  # Polymer proof listener and relay routines
├── src/                               # Frontend application directory
│   ├── App.tsx                        # Main payments app client interface
│   ├── BetApp.tsx                     # Whitelist gated prediction markets portal
│   ├── LandingPage.tsx                # Marketing landing page
│   ├── lib/                           # Frontend shared utility libraries
│   └── pages/                         # Sub-application page modules
└── supabase/                          # Database configuration and migrations
```

---

## Component Directories

### 1. Smart Contracts (`contracts/`)
Disburse settles payments and validates claims onchain.
- [QrPaymentSource.sol](file:///d:/Stressed/contracts/src/QrPaymentSource.sol): Deployed on source chains (**Base Sepolia**, **Monad Testnet**). Escrows payment tokens and emits `QrPaymentInitiated` for Polymer to bridge.
- [QrPaymentSettlement.sol](file:///d:/Stressed/contracts/src/QrPaymentSettlement.sol): Deployed on destination (**Arc Testnet**). Validates Polymer state proofs, prevents double spending, and disburses USDC to recipients from its prefunded liquidity pool.
- [PspVerifier.sol](file:///d:/Stressed/contracts/src/PspVerifier.sol): Exposes onchain verification interface to check signatures of payment settlement receipts.
- [Exchange.sol](file:///d:/Stressed/contracts/src/markets/Exchange.sol): Central limit orderbook for binary markets YES/NO shares.
- [Market.sol](file:///d:/Stressed/contracts/src/markets/Market.sol): Models share minting, resolution, and settlement payouts.
- [MarketsPspVerifier.sol](file:///d:/Stressed/contracts/src/markets/MarketsPspVerifier.sol): Validates market claims and records settlement details.

### 2. Frontend Client (`src/`)
Built with React, Vite, and Dynamic SDK for Web3 authentication.
- [App.tsx](file:///d:/Stressed/src/App.tsx): Contains direct send forms, invoice generators, statement tools, and real-time payment timelines.
- [BetApp.tsx](file:///d:/Stressed/src/BetApp.tsx): A separate subdomain layout gating access to prediction markets via whitelist verification.
- [lib/compliance.ts](file:///d:/Stressed/src/lib/compliance.ts): Handles client-side PSP generation, verification, and PDF/UBL-XML/JSON exporting.
- [lib/crosschain.ts](file:///d:/Stressed/src/lib/crosschain.ts): Cross-chain route estimation and config matching.
- [lib/realtime.ts](file:///d:/Stressed/src/lib/realtime.ts): Integrates with Supabase database listeners to stream payment state.

### 3. Server (`server/`)
Runs the background operations.
- [server/crosschain.ts](file:///d:/Stressed/server/crosschain.ts): Listens to remote chains, constructs Polymer proofs, and submits them to Arc.
- [server/qr.ts](file:///d:/Stressed/server/qr.ts): Monitors direct payments and tracks remote invoice updates.
- [server/markets/operator.ts](file:///d:/Stressed/server/markets/operator.ts): Manages orderbooks, matches buyer/seller limits, and updates caches.
- [server/psp/issue.ts](file:///d:/Stressed/server/psp/issue.ts): Monitors transaction logs and issues signed PSP structures.

### 4. Database Config (`supabase/`)
Uses Supabase PostgreSQL for tracking state:
- [migrations](file:///d:/Stressed/supabase/migrations/): Sets up SQL tables for `payment_requests`, `psp_documents`, `market_fills`, and `market_positions` with triggers for realtime feeds.

---

## Development Setup

### Prerequisite Environment Configuration
Copy `.env.example` to `.env.local` and configure your API keys and private keys:

```bash
cp .env.example .env.local
```

Important variables include:
- `VITE_DYNAMIC_ENVIRONMENT_ID`: Dynamic authentication config.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`: Supabase API connection.
- `DISBURSE_PSP_SIGNING_KEY`: Private key used by the backend to sign generated PSPs.
- `QR_DEPLOYER_PRIVATE_KEY`: Key used to deploy and configure smart contracts.

### Commands

Install dependencies:
```bash
npm install
```

Start the Vite development frontend server:
```bash
npm run dev
```

Run typescript typechecking:
```bash
npm run typecheck
```

Execute the Vitest test suites:
```bash
npm test
```

Build the production bundle:
```bash
npm run build
```

---

## Smart Contract Administration

### Deploying Cross-Chain Settlement
To deploy the cross-chain contracts (Source on Base/Monad, Settlement on Arc):
```bash
# Compile contracts first
npm run deploy:qr-contracts -- --compile-only

# Perform a full deployment to Arc, Base Sepolia, and Monad Testnet
npm run deploy:qr-contracts -- --full
```

### Deploys & Upgrades for Prediction Markets
- [deploy-markets.mjs](file:///d:/Stressed/scripts/deploy-markets.mjs): Deploys prediction market factory and routers.
- [deploy-exchange-upgrade.mjs](file:///d:/Stressed/scripts/deploy-exchange-upgrade.mjs): Upgrades the exchange logic contracts on Arc Testnet.
- [create-market.ts](file:///d:/Stressed/scripts/create-market.ts): Helper tool to construct new binary markets:
  ```bash
  npm run markets:create
  ```

---

## Testing & Automation Tools

### Standalone PSP verification CLI
You can test PSP verification locally using the packaged CLI tool inside [packages/psp-verify](file:///d:/Stressed/packages/psp-verify/src/verify.ts):

```bash
# Run CLI verification
npx --workspace packages/psp-verify psp-verify proof.json --issuer 0xYourIssuerAddress
```

### Prediction Market Smoke Testing
Disburse includes a full integration smoke test for prediction markets. It deploys, mints, resolutions, claims, and verifies claim PSPs locally:

```bash
# Run markets integration smoke test
npx tsx scripts/smoke-markets.ts
```

### Market Making Bot
You can boot the trading bot simulator to execute market-making operations on Arc Testnet:

```bash
# Launch bot
npx tsx scripts/mm-bot.ts
```

---

## License

This repository is licensed under the MIT License. See [LICENSE](file:///d:/Stressed/LICENSE) for more details.

---

<sub>Disburse is an independent project built on the USDC ecosystem. Not affiliated with Circle Internet Financial.</sub>
