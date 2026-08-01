# @disburse/cli

Command-line interface for **direct stablecoin disbursements** on Arc Testnet with first-class **Invoice PDFs** and **Portable Settlement Proofs (PSP)**.

Use it from agents, scripts, CI, or any automated system that needs to send USDC (or EURC), attach a Label + Note, and emit independently verifiable proofs.

## Install / Usage (no global install required)

```bash
# Inject DISBURSE_PRIVATE_KEY through a scoped secret store first.
# The CLI shows a full preflight and asks you to type SEND.
npx @disburse/cli send \
  --to 0xRecipientAddress \
  --amount 25.5 \
  --label "Invoice 1" \
  --note "Subscription - May 2026"

# Or stream the key without placing it in argv or shell history.
secret-tool lookup service disburse | npx @disburse/cli send \
  --private-key-stdin --dry-run --to 0x... --amount 10 --label "Payout"
```

After `npm install -g @disburse/cli` you can also use the `disburse` command directly.

## Batch disbursements

Agents can send a safe sequential batch and receive one complete batch PDF plus individual PSP JSON files:

```bash
# DISBURSE_PRIVATE_KEY is already available in this scoped process.
npx @disburse/cli batch --csv payouts.csv --dry-run
```

CSV format:

```csv
to,amount,label,note,token
0x742d35Cc6634C0532925a3b844Bc9e7595f8fA4c,10,Invoice 1,May salary,USDC
0x1111111111111111111111111111111111111111,5,Bonus,Q2 performance,EURC
```

Safety behavior:
- The full CSV is validated before any transaction is sent.
- Required token balances are summed by token and checked before the first transfer.
- Transfers run sequentially only, avoiding nonce conflicts.
- The batch stops on the first failure. A post-broadcast failure is classified
  separately as `reconciliationRequired` and always includes the transaction
  hash; it is never reported as an unpaid row that is safe to resend.
- One batch PDF contains summary totals and all successful payment PSP details.

## Example agent flow (as described by users)

```text
User: "Hermes, use Disburse CLI and send some usdc to this address
       Label: Invoice 1, Note: Subscription. Make sure the transaction
       is verified using PSP from Disburse CLI too."

Hermes (with funded Arc testnet wallet):
  # DISBURSE_PRIVATE_KEY was injected by a scoped secret store.
  npx @disburse/cli send \
    --to 0x742d35Cc6634C0532925a3b844Bc9e7595f8fA4c \
    --amount 42 \
    --label "Invoice 1" \
    --note "Subscription"

Hermes replies with:
  • tx hash + explorer link
  • disburse-psp-....json  (signed PSP)
  • disburse-invoice-....pdf
  • verification command pinned to an independently trusted PSP issuer
```

The recipient (or any auditor) can verify the proof against an issuer address obtained from independent trusted configuration:

```bash
# Never source this address from the PSP being checked.
npx @disburse/psp-verify disburse-psp-abc123.json \
  --issuer "$DISBURSE_TRUSTED_PSP_ISSUER"
# or pipe from the public API
curl --fail --silent --show-error "https://app.disburse.online/api/psp?uid=psp:..." \
  | npx @disburse/psp-verify --stdin --issuer "$DISBURSE_TRUSTED_PSP_ISSUER"
```

## What the CLI does

1. Performs a plain ERC-20 `transfer` of the chosen token on Arc Testnet using your private key (headless, no browser wallet).
2. Waits for 1 confirmation.
3. Immediately journals the transaction hash to
   `disburse-recovery-<hash>.json`, then registers the transfer + your
   `label`/`note` with Disburse via the public API.
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
--invoice-date <YYYY-MM-DD> Optional invoice date
--token <USDC|EURC>         Default: USDC
--private-key-stdin         Read the key from stdin; pair with --yes or --dry-run
--out-dir <path>            Where to write proof.json + PDF (default: current dir)
--rpc <url>                 Override Arc RPC endpoint
--trusted-psp-issuer <0x...> Independently trusted issuer for generated verification commands
--json                      Print machine-readable JSON for agents
--dry-run                   Validate balances and print the full plan without broadcasting
--yes                       Skip the typed confirmation for reviewed unattended use
```

## Security notes (important for agents)

- **Never** commit private keys or pass them on command lines in shared logs/CI. The CLI rejects `--private-key`.
- Inject `DISBURSE_PRIVATE_KEY` from a scoped secret store or use `--private-key-stdin`.
- Run with `--dry-run` first. Interactive sends require typing `SEND` or `BATCH`; use `--yes` only after review.
- The output directory is checked before broadcast. After broadcast, every RPC,
  registration, or artifact failure returns `success: false`,
  `broadcast: true`, the transaction hash, and a recovery path. **Do not resend
  that payment**; reconcile the same hash.
- The CLI only uses the key to sign the `transfer` transaction. It never sends the key to Disburse.
- Verify PSP signatures only against `--trusted-psp-issuer` or `DISBURSE_TRUSTED_PSP_ISSUER` obtained independently. An issuer address printed inside a PSP is not a trust anchor.
- Disburse does **not** custody funds. A successful debit (on-chain transfer) is not the same as fulfillment of any off-chain obligation.

## PSP + Invoice for direct payments (not only QR)

This CLI (and the underlying `/api/disburse` registration endpoint) exists precisely so that **direct** wallet-to-wallet transfers receive the same first-class Invoice + signed PSP treatment previously available only for QR invoice flows.

- The server verifies the on-chain Transfer event.
- It constructs a `PaymentRequest` + `Receipt` using the `label`/`note` you supplied.
- It issues a normal PSP using the same signing key and canonicalization used for all other settlements.
- The resulting documents are queryable via the normal `/api/psp?uid=...` endpoint and verifiable with the standalone `@disburse/psp-verify` package.

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
