import { LENDING_MAX_LTV_BPS, LENDING_LIQ_THRESHOLD_BPS, LENDING_RESERVE_FACTOR_BPS } from "../../lib/lending/types";
import type { DocsPage } from "./types";

/**
 * Bet category — docs for the prediction-markets + lending product served
 * from bet.disburse.online. Authored in English; the gitbook layout falls
 * back to these pages when a translation is not yet available.
 */

const LTV_PCT = Number(LENDING_MAX_LTV_BPS) / 100;
const LIQ_PCT = Number(LENDING_LIQ_THRESHOLD_BPS) / 100;
const RESERVE_PCT = Number(LENDING_RESERVE_FACTOR_BPS) / 100;

export const betPages: DocsPage[] = [
  {
    slug: "overview",
    title: "Overview",
    sections: [
      {
        title: "What is bet.disburse.online",
        body: [
          "bet.disburse.online is the trading and lending surface of the Disburse stack. It runs on Arc Testnet and is built around two complementary products: binary prediction markets, and a single-asset lending pool that uses cirBTC as collateral to mint USDC loans.",
          "The shell is open beta: any connected wallet can place orders, take positions, lend, or borrow. The earlier whitelist gate has been retired so the testnet experience matches what a mainnet launch would feel like.",
        ],
        points: [
          "Primary routes: /markets, /markets/positions, /markets/resolved, /markets/lending.",
          "Order matching, orderbook depth, and settlement are all on-chain; no off-chain matching engine sits in the middle.",
          "Lending is a single pool — supply USDC to earn yield, or deposit cirBTC to borrow against it.",
        ],
      },
      {
        title: "Mental model",
        body: [
          "Think of bet.disburse.online as two thin UIs sitting on top of one Arc account. Predictions and lending share the same wallet, the same fee model, and the same monochrome design language.",
          "Markets are zero-sum: every USDC you win on a YES contract is paid by a NO holder, minus a small protocol fee. Lending is positive-sum within the pool: borrowers pay interest that flows to suppliers, with a small reserve factor retained by the protocol.",
        ],
      },
    ],
  },
  {
    slug: "markets",
    title: "Prediction markets",
    sections: [
      {
        title: "Market structure",
        body: [
          "Every market resolves to one of two outcomes: YES or NO. A position is just a tokenized claim that pays $1 if the outcome matches and $0 otherwise.",
          "Markets are listed on /markets. Each card shows the current YES price (in $, between 0 and 1) and the implied probability. Click through for the detail page with orderbook depth, recent fills, and a price chart.",
        ],
        points: [
          "Markets list: /markets",
          "Open a position: /markets/[id]",
          "Track positions: /markets/positions",
          "Browse settled markets: /markets/resolved",
        ],
      },
      {
        title: "Placing and managing orders",
        body: [
          "The trade panel accepts limit prices in USDC. A maker order rests on the orderbook until matched; a taker order crosses the spread immediately. Orders are signed by the connected wallet — Disburse never holds custody.",
          "Open positions can be sold any time before settlement. The sell sheet quotes the best available bid for your size and shows the slippage you would absorb.",
        ],
      },
      {
        title: "Settlement",
        body: [
          "When a market resolves, the contract emits a Resolved event with the winning outcome. Holders of the winning side can claim $1 per contract from the market detail page. Losing-side contracts become worthless on resolution.",
          "Resolved markets stay browsable under /markets/resolved so you can audit historical resolutions.",
        ],
      },
    ],
  },
  {
    slug: "lending",
    title: "Lending — cirBTC → USDC",
    sections: [
      {
        title: "What you can do",
        body: [
          "The lending product is a single pool with two roles: Lender and Borrower. As a lender, you supply USDC and earn variable APR sourced from borrower interest. As a borrower, you deposit cirBTC as collateral and draw USDC against it.",
          "Lending interest accrues every block via supply and borrow indices. There is no claim step — your aUSDC balance grows continuously until you withdraw.",
        ],
        points: [
          "Supply USDC: receive aUSDC, which appreciates against USDC over time.",
          "Withdraw USDC: burn aUSDC, get the underlying back at the current exchange rate.",
          "Deposit cirBTC: the contract holds your collateral until you borrow against it or withdraw it.",
          `Borrow USDC: up to ${LTV_PCT.toFixed(0)}% of your collateral's USD value.`,
          "Repay USDC: pay back any portion of your debt at any time.",
        ],
      },
      {
        title: "Health factor",
        body: [
          "A position's health factor (HF) is the ratio of (collateral value × liquidation threshold) to debt. HF = 1.0 means you are at the liquidation line; below 1.0 your position is liquidatable.",
          "The lending UI labels HF for quick reading: At risk (< 1), Healthy (1 – 2), Strong (≥ 2). Watch the BTC price feed — sharp drops compress HF without you doing anything.",
        ],
      },
    ],
  },
  {
    slug: "tvl-apr",
    title: "TVL & APR mechanics",
    sections: [
      {
        title: "Total Value Locked",
        body: [
          "TVL is the sum of all USDC currently held by the pool — both idle cash and outstanding borrows. The TVL chart on the lending page reads pool snapshots indexed every five minutes and renders the series for the selected window (1D / 7D / 30D / ALL).",
          "TVL does not include cirBTC collateral. Collateral lives on the contract's books but is not 'value locked' in the USDC sense — it is a margin deposit, not productive capital.",
        ],
        code: "TVL = cash_usdc + total_borrows_usdc",
      },
      {
        title: "Utilization curve",
        body: [
          "Utilization U = total_borrows / (cash + total_borrows). The interest-rate model is a kinked linear function of U: gentle slope below the kink, steep slope above it, so high utilization triggers a strong borrow-APR response that pulls more supply in and pushes borrows out.",
          `Supply APR = borrow APR × U × (1 − reserve factor). The reserve factor (currently ${RESERVE_PCT.toFixed(0)}%) is the protocol's cut.`,
        ],
      },
    ],
  },
  {
    slug: "risk",
    title: "Risk & liquidation",
    sections: [
      {
        title: "Loan-to-value limits",
        body: [
          `Maximum LTV at borrow time is ${LTV_PCT.toFixed(0)}%. You cannot pull a loan that would put you above this threshold; the borrow form clamps and shows the maximum you can draw.`,
          `Liquidation threshold is ${LIQ_PCT.toFixed(0)}%. If your debt-to-collateral ratio crosses this number — because debt grew via interest, or because cirBTC price dropped — your position becomes liquidatable.`,
        ],
      },
      {
        title: "Pyth oracle",
        body: [
          "Collateral value is priced from the Pyth BTC/USD feed. The lending page surfaces the latest oracle observation, with a “price stale” label if the feed has not updated recently. Stale prices block new borrows so positions cannot be opened against unreliable data.",
        ],
      },
      {
        title: "Liquidation flow",
        body: [
          "A liquidator repays a portion of an unhealthy position's debt and receives the equivalent value in cirBTC plus a 5% liquidation bonus, paid out of the position's collateral.",
          "There is no grace period at the liquidation line. To stay safe, leave headroom — operating around HF 1.5+ gives you room for normal BTC volatility without triggering a margin call.",
        ],
      },
    ],
  },
];
