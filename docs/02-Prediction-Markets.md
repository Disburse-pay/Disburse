# Prediction Markets (Beta)

Disburse includes a beta Prediction Markets feature built on Arc Testnet. This feature allows users to trade on binary YES/NO outcomes using USDC.

## How Binary Markets Work

Each market asks a specific question with a binary outcome. For example: "Will Arc mainnet launch by 2026-07-01?"

Users trade shares that resolve to exactly 1 USDC if correct, or 0 USDC if incorrect.

## Trading Mechanics

* **Minting**: You can mint a pair of YES and NO shares by depositing USDC.
* **Orderbook**: Trade YES or NO shares on an on-chain central limit orderbook.
* **Prices**: Prices range from 0.00 to 1.00 USDC, representing the probability of the outcome.
* **Fixed-Point Scaling**: Shares and USDC use 1e6 fixed-point scaling (1.00 USDC equals 1,000,000 micros).

## Resolution and Claims

When the closing date is reached, an authorized resolver determines the winning outcome. 

Once resolved, holders of the winning shares can claim their payout at 1 USDC per share. The losing shares become worthless.

When a claim is processed, Disburse issues a Portable Settlement Proof (PSP) verifying the payout.
