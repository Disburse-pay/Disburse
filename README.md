<div align="center">

<img src="public/disburse-logo.png" alt="Disburse" width="96" />

# Disburse

**A receipt layer for stablecoin payments.**

Issue a QR invoice. The payer settles in USDC from any supported chain. Disburse turns the onchain transfer into a structured, verifiable receipt. This receipt is a document your accountant, auditor, or tax office can file.

[App](https://app.disburse.online) &middot; [Docs](https://docs.disburse.online) &middot; [X](https://x.com/Disburs3) &middot; [GitHub](https://github.com/Disburse-pay)

</div>

---

## Documentation

For full details on how Disburse works, please refer to our documentation:

1. [Payments and QR](docs/01-Payments-and-QR.md)
2. [Prediction Markets (Beta)](docs/02-Prediction-Markets.md)
3. [Compliance and Receipts](docs/03-Compliance-and-Receipts.md)
4. [Milestones](docs/04-Milestones.md)
5. [Webhooks and API](docs/05-Webhooks-and-API.md)
6. [Smart Contracts](docs/06-Smart-Contracts.md)

## Development Setup

### Scripts

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # Vitest
npm run build
```

The dev server binds to `0.0.0.0` and routes all paths to `index.html` via `vercel.json`.

Documentation is served from `docs.disburse.online` on the same Vercel project. The app treats that subdomain as the docs site.

Supabase backed QR realtime and the `/api/*` handlers require a Vercel context. Run `vercel dev` locally or deploy to Vercel. Plain Vite dev still supports the local only QR fallback.

## License

MIT. See [`LICENSE`](LICENSE) if present, otherwise all rights reserved pending license selection.

---

<sub>Disburse is an independent project built on the USDC ecosystem. Not affiliated with Circle Internet Financial.</sub>
