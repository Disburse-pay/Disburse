# Smart Contracts

Disburse relies on several smart contracts deployed on Arc Testnet to facilitate settlements, verification, and prediction markets.

## Payment Contracts

* **QrPaymentSettlement**: The main settlement contract on Arc Testnet. It receives proofs from remote chains or handles direct Arc payments.
* **QrPaymentSource**: The source escrow contract deployed on remote chains (Base Sepolia, Monad Testnet). It escrows funds and emits events for Polymer to prove.

## Verification Contracts

* **PspVerifier**: An on-chain verifier for Portable Settlement Proofs (PSPs). It recovers the signer from the EIP-191 signed digest, checks the issuer, and confirms the settlement occurred.

## Prediction Market Contracts

* **Exchange**: The central limit orderbook for trading YES and NO shares.
* **MarketFactory**: Deploys new markets and manages administrative functions.
* **Market**: Represents a single binary prediction market.
* **OutcomeToken**: The ERC-20 contract for the YES and NO shares.
* **AdminResolver**: Handles the resolution of markets by authorized administrators.
