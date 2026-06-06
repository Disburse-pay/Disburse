# @disburse/cli

Command-line interface for **direct stablecoin disbursements** on Arc Testnet with first-class **Invoice PDFs** and **Portable Settlement Proofs (PSP)**.

Use it from agents, scripts, CI, or any automated system that needs to send USDC (or EURC), attach a Label + Note, and emit independently verifiable proofs.

## Install / Usage (no global install required)

```bash
# Via npx (recommended for agents)
npx @disburse/cli send \
  --to 0xRecipientAddress \
  --amount 25.5 \
  --label "Invoice 1" \
  --note "Subscription - May 2026" \
  --private-key 0xYourFundedArcTestnetPrivateKey

# Or with private key via environment variable (safer for logs/history)
DISBURSE_PRIVATE_KEY=0x... npx @disburse/cli send --to 0x... --amount 10 --label "Payout"
```

After `npm install -g @disburse/cli` you can also use the `disburse` command directly.

### Install from GitHub (before npm publish)

```bash
# Install directly from the monorepo (auto-builds via prepare script)
npm install github:Disburse-pay/Disburse#main --workspace=packages/cli
# Or globally
npm install -g github:Disburse-pay/Disburse#main
```

For agents that just need to run it once without installing globally:

```bash
git clone https://github.com/Disburse-pay/Disburse.git /tmp/disburse
cd /tmp/disburse/packages/cli && npm install && npm run build
node bin/cli.mjs send --to 0x... --amount 10 --label "Payout" \
  --private-key $DISBURSE_PRIVATE_KEY
```

## Example agent flow (as described by users)

```text
User: "Hermes, use Disburse CLI and send some usdc to this address
       Label: Invoice 1, Note: Subscription. Make sure the transaction
       is verified using PSP from Disburse CLI too."

Hermes (with funded Arc testnet wallet):
  DISBURSE_PRIVATE_KEY=... npx @disburse/cli send \
    --to 0x742d35Cc6634C0532925a3b844Bc9e7595f8fA4c \
    --amount 42 \
    --label "Invoice 1" \
    --note "Subscription"

Hermes replies with:
  • tx hash + explorer link
  • disburse-psp-....json  (signed PSP)
  • disburse-invoice-....pdf
  • verification command: npx @disburse/psp-verify ...
```

The recipient (or any auditor) can verify the proof **without trusting Hermes or Disburse infrastructure**:

```bash
npx @disburse/psp-verify disburse-psp-abc123.json
# or pipe from the public API
curl -s "https://app.disburse.online/api/psp?uid=psp:..." | npx @disburse/psp-verify --stdin
```

## What the CLI does

1. Performs a plain ERC-20 `transfer` of the chosen token on Arc Testnet using your private key (headless, no browser wallet).
2. Waits for 1 confirmation.
3. Registers the transfer + your `label`/`note` with Disburse via the public API.
4. Receives a **cryptographically signed PSP** (Portable Settlement Proof) that includes:
   - The exact payer, recipient, token, amount from the on-chain Transfer event
   - Your label and note
   - Settlement details (tx hash, block, timestamp)
   - Issuer signature (secp256k1 + keccak256) over a canonical representation
5. Locally generates a matching one-page **Invoice PDF** (same renderer used by the web app) that embeds the PSP digest and verification instructions in the footer.

Both artifacts are written to disk. The PSP is the durable, portable source of truth.

## Options

```
--recipient, --to <0x...>   Destination address (required)
--amount <number>           Amount in human units, e.g. 10 or 0.01 (required)
--label <text>              Invoice label (required, max ~80 chars)
--note <text>               Optional note (max ~240 chars)
--token <USDC|EURC>         Default: USDC
--private-key <0x...>       Signing key (or use DISBURSE_PRIVATE_KEY env)
--out-dir <path>            Where to write proof.json + PDF (default: current dir)
--rpc <url>                 Override Arc RPC endpoint
--yes                       Skip interactive confirmations (future)
```

## Security notes (important for agents)

- **Never** commit private keys or pass them on command lines in shared logs/CI.
- Prefer `DISBURSE_PRIVATE_KEY=0x...` in a scoped environment variable.
- The CLI only uses the key to sign the `transfer` transaction. It never sends the key to Disburse.
- Proofs are verifiable by anyone with the JSON + the issuer address printed in the document.
- Disburse does **not** custody funds. A successful debit (on-chain transfer) is not the same as fulfillment of any off-chain obligation.

## PSP + Invoice for direct payments (not only QR)

This CLI (and the underlying `/api/disburse` registration endpoint) exists precisely so that **direct** wallet-to-wallet transfers receive the same first-class Invoice + signed PSP treatment previously available only for QR invoice flows.

- The server verifies the on-chain Transfer event.
- It constructs a `PaymentRequest` + `Receipt` using the `label`/`note` you supplied.
- It issues a normal PSP using the same signing key and canonicalization used for all other settlements.
- The resulting documents are queryable via the normal `/api/psp?uid=...` and `/api/psp?request_id=direct-...` endpoints and verifiable with the standalone `@disburse/psp-verify` package.

## Development (inside this repo)

```bash
cd packages/cli
npm install
npm run build
node bin/cli.mjs --help
# For live TS during development:
npx tsx bin/cli.mjs send ...
```

The package vendors a minimal copy of the pure libraries it needs (`arc`, `payments`, `invoice`) so it remains small and has no dependency on the web app bundle.

## Related

- Verify proofs: `@disburse/psp-verify` (also available as `npx @disburse/psp-verify`)
- Web UI + docs: https://disburse.app (or the current deployment)
- Full PSP specification and on-chain verifier live in the main repository.

## License

MIT
