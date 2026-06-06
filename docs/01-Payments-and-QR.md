# Payments and QR

## The Flow

Disburse operates on a simple flow for payments:

1. **Request**: The requester generates a QR payload with recipient, token, amount, label, invoice date, and expiry.
2. **Pay**: The payer scans the QR, picks a source chain (Arc, Base, or Monad), and signs a standard ERC-20 transfer. No signup is required.
3. **Settle**: On Arc the transfer is direct. On Base and Monad, Polymer proves the source escrow event and a relayer submits `settle(proof)` to the Arc settlement contract.
4. **Verify**: Disburse matches the exact token contract, recipient, and amount against the onchain `Transfer` log. Fuzzy matches never auto-settle.
5. **Receipt**: A Verifiable Settlement Receipt (VSR) is produced. Export as JSON proof, UBL 2.1 XML, or PDF.

## Direct Send versus QR Payments

**Direct Send** is for immediate wallet-to-wallet transfers. You select the recipient and amount, then sign the transaction. The app verifies the transaction hash and produces a receipt.

Direct sends (including those performed by the Disburse CLI for agents) now support custom `label` + `note` and can produce full signed Portable Settlement Proofs (PSP) + Invoice PDFs via the same issuance pipeline used by QR payments. See the `@disburse/cli` package and `/api/disburse` endpoint.

**QR Payments** are for creating a structured invoice. A QR code contains a `/pay` URL with a base64url JSON payload. The payer scans this code to view a locked payment request. Once paid, the request is marked complete.

## Cross-Chain Routing

QR Payments are USDC-only and always settle on Arc Testnet.

* **Arc Testnet**: Direct ERC-20 transfer. Settles in about 15 seconds.
* **Base Sepolia**: Cross-chain source. Settles on Arc via Polymer cryptographic proofs in 2 to 5 minutes.
* **Monad Testnet**: Cross-chain source. Settles on Arc via Polymer cryptographic proofs in 2 to 5 minutes.
