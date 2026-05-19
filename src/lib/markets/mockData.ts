/**
 * Mock data for the prediction-markets frontend phase.
 *
 * Replaced in the integration phase by:
 *   - GET /api/markets               -> Market[]
 *   - GET /api/markets-detail        -> Market + Orderbook + Fill[]
 *   - GET /api/markets-orderbook     -> Orderbook
 *   - GET /api/markets-fills         -> Fill[]
 *   - GET /api/markets-positions     -> Position[]
 *
 * Until then, every page reads from this module via the helpers below.
 * Keep this file the SINGLE source of frontend mock state so swapping it
 * for real APIs touches one import per page.
 */

import type { Address, Hex } from "viem";
import type {
  Fill,
  Market,
  MarketClaim,
  Orderbook,
  OrderbookLevel,
  Position
} from "./types";

const USDC = 1_000_000;

const ADDR_A = "0x1234567890123456789012345678901234567890" as Address;
const ADDR_B = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
const ADDR_C = "0x9876543210987654321098765432109876543210" as Address;
const ADDR_RECIPIENT = "0xfedcbafedcbafedcbafedcbafedcbafedcbafedc" as Address;

const TX_1 = "0xaaaa11112222333344445555666677778888999900001111aaaabbbbccccdddd" as Hex;
const TX_2 = "0xbbbb22223333444455556666777788889999000011112222bbbbccccddddeeee" as Hex;
const TX_3 = "0xcccc33334444555566667777888899990000111122223333ccccddddeeeeffff" as Hex;

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function isoDaysAgo(days: number): string {
  return isoDaysFromNow(-days);
}

export const MOCK_MARKETS: Market[] = [
  {
    id: "0a0d1bf2-1a8e-4d6a-9d0c-4f1f25a3b71a",
    onchainAddress: "0x1111111111111111111111111111111111111111" as Address,
    question: "Will Arc mainnet launch by 2026-07-01?",
    description: "Resolves YES if Arc's mainnet network is publicly operational with at least one block producer by July 1, 2026, 00:00 UTC.",
    category: "Crypto",
    closesAt: isoDaysFromNow(28),
    status: "open",
    yesPriceMicros: 620_000, // $0.62
    noPriceMicros: 380_000,
    volumeMicros: 12_450 * USDC,
    openInterestMicros: 4_120 * USDC,
    createdAt: isoDaysAgo(14)
  },
  {
    id: "1b2c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e",
    onchainAddress: "0x2222222222222222222222222222222222222222" as Address,
    question: "Will USDC overtake USDT in monthly transfer volume in Q3 2026?",
    description: "Resolves YES if onchain USDC monthly transfer volume exceeds USDT for any month in Jul–Sep 2026 per Artemis.",
    category: "Stablecoins",
    closesAt: isoDaysFromNow(72),
    status: "open",
    yesPriceMicros: 240_000,
    noPriceMicros: 760_000,
    volumeMicros: 8_300 * USDC,
    openInterestMicros: 2_800 * USDC,
    createdAt: isoDaysAgo(20)
  },
  {
    id: "2c3d4e5f-6a7b-8c9d-0e1f-2a3b4c5d6e7f",
    onchainAddress: "0x3333333333333333333333333333333333333333" as Address,
    question: "Will the PSP v1.1 spec ship with categorical-outcome support?",
    description: "Resolves YES if a PSP spec with `marketClaim.outcome` allowing more than two values is published before 2026-08-31.",
    category: "Disburse",
    closesAt: isoDaysFromNow(102),
    status: "open",
    yesPriceMicros: 480_000,
    noPriceMicros: 520_000,
    volumeMicros: 3_120 * USDC,
    openInterestMicros: 1_500 * USDC,
    createdAt: isoDaysAgo(6)
  },
  {
    id: "3d4e5f6a-7b8c-9d0e-1f2a-3b4c5d6e7f8a",
    onchainAddress: "0x4444444444444444444444444444444444444444" as Address,
    question: "Will Ethereum gas fees average under 5 gwei in May 2026?",
    description: "Resolves YES if the monthly average base fee for May 2026 is below 5 gwei per Etherscan.",
    category: "Crypto",
    closesAt: isoDaysFromNow(12),
    status: "open",
    yesPriceMicros: 710_000,
    noPriceMicros: 290_000,
    volumeMicros: 21_900 * USDC,
    openInterestMicros: 7_300 * USDC,
    createdAt: isoDaysAgo(28)
  },
  {
    id: "4e5f6a7b-8c9d-0e1f-2a3b-4c5d6e7f8a9b",
    onchainAddress: "0x5555555555555555555555555555555555555555" as Address,
    question: "Will the next FOMC meeting cut rates by 25bp?",
    description: "Resolves YES if the Federal Reserve cuts the target federal funds rate by exactly 25 basis points at the next FOMC meeting.",
    category: "Macro",
    closesAt: isoDaysFromNow(45),
    status: "open",
    yesPriceMicros: 350_000,
    noPriceMicros: 650_000,
    volumeMicros: 58_400 * USDC,
    openInterestMicros: 18_900 * USDC,
    createdAt: isoDaysAgo(35)
  },
  {
    id: "5f6a7b8c-9d0e-1f2a-3b4c-5d6e7f8a9b0c",
    onchainAddress: "0x6666666666666666666666666666666666666666" as Address,
    question: "Will Polymer mainnet bridge cross 1M USDC TVL by Q3 2026?",
    description: "Resolves YES if Polymer's mainnet bridge passes 1,000,000 USDC in total value locked any time before 2026-10-01.",
    category: "Crypto",
    closesAt: isoDaysFromNow(135),
    status: "open",
    yesPriceMicros: 430_000,
    noPriceMicros: 570_000,
    volumeMicros: 6_700 * USDC,
    openInterestMicros: 2_100 * USDC,
    createdAt: isoDaysAgo(3)
  },
  {
    id: "6a7b8c9d-0e1f-2a3b-4c5d-6e7f8a9b0c1d",
    onchainAddress: "0x7777777777777777777777777777777777777777" as Address,
    question: "Did Disburse exceed 1,000 PSPs issued by 2026-04-30?",
    description: "Resolved YES — public Disburse dashboard reported 1,247 PSPs issued through April.",
    category: "Disburse",
    closesAt: isoDaysAgo(18),
    resolvesAt: isoDaysAgo(15),
    status: "resolved",
    winningOutcome: "YES",
    yesPriceMicros: 1_000_000,
    noPriceMicros: 0,
    volumeMicros: 14_200 * USDC,
    openInterestMicros: 0,
    createdAt: isoDaysAgo(40)
  },
  {
    id: "7b8c9d0e-1f2a-3b4c-5d6e-7f8a9b0c1d2e",
    onchainAddress: "0x8888888888888888888888888888888888888888" as Address,
    question: "Will Base sequencer downtime exceed 30 minutes in April 2026?",
    description: "Resolved NO — Base reported 99.97% uptime for April 2026 with no incident over 10 minutes.",
    category: "Crypto",
    closesAt: isoDaysAgo(9),
    resolvesAt: isoDaysAgo(7),
    status: "resolved",
    winningOutcome: "NO",
    yesPriceMicros: 0,
    noPriceMicros: 1_000_000,
    volumeMicros: 9_400 * USDC,
    openInterestMicros: 0,
    createdAt: isoDaysAgo(50)
  }
];

export function getMockMarkets(): Market[] {
  return MOCK_MARKETS;
}

export function getMockMarketById(id: string): Market | undefined {
  return MOCK_MARKETS.find((m) => m.id === id);
}

// Construct a plausible orderbook around a market's last price.
export function getMockOrderbook(marketId: string, outcome: "YES" | "NO"): Orderbook {
  const market = getMockMarketById(marketId);
  const mid = market
    ? outcome === "YES"
      ? market.yesPriceMicros
      : market.noPriceMicros
    : 500_000;

  const bids: OrderbookLevel[] = [];
  const asks: OrderbookLevel[] = [];
  for (let i = 1; i <= 6; i++) {
    const bidPrice = Math.max(10_000, mid - i * 10_000);
    const askPrice = Math.min(990_000, mid + i * 10_000);
    bids.push({ priceMicros: bidPrice, sizeMicros: (80 + i * 35) * USDC });
    asks.push({ priceMicros: askPrice, sizeMicros: (60 + i * 28) * USDC });
  }
  return { marketId, outcome, bids, asks };
}

export function getMockFills(marketId: string, count = 12): Fill[] {
  const market = getMockMarketById(marketId);
  const basePrice = market?.yesPriceMicros ?? 500_000;
  const fills: Fill[] = [];
  for (let i = 0; i < count; i++) {
    const drift = Math.round((Math.sin(i / 2) + Math.cos(i / 3)) * 35_000);
    const price = Math.max(20_000, Math.min(980_000, basePrice + drift));
    fills.push({
      id: `fill-${marketId}-${i}`,
      marketId,
      outcome: i % 3 === 0 ? "NO" : "YES",
      priceMicros: price,
      sizeMicros: (40 + Math.floor(Math.random() * 80)) * USDC,
      taker: i % 2 === 0 ? ADDR_A : ADDR_B,
      maker: i % 2 === 0 ? ADDR_B : ADDR_A,
      txHash: TX_1,
      blockNumber: String(42_000_000 + i * 17),
      filledAt: new Date(Date.now() - (count - i) * 2_700_000).toISOString()
    });
  }
  return fills;
}

export function getMockPositions(): Position[] {
  return [
    {
      marketId: MOCK_MARKETS[0].id,
      userAddress: ADDR_RECIPIENT,
      yesSharesMicros: 250 * USDC,
      noSharesMicros: 0,
      costBasisMicros: 142 * USDC,
      realizedPnlMicros: 0
    },
    {
      marketId: MOCK_MARKETS[3].id,
      userAddress: ADDR_RECIPIENT,
      yesSharesMicros: 0,
      noSharesMicros: 180 * USDC,
      costBasisMicros: 54 * USDC,
      realizedPnlMicros: 0
    },
    {
      marketId: MOCK_MARKETS[4].id,
      userAddress: ADDR_RECIPIENT,
      yesSharesMicros: 100 * USDC,
      noSharesMicros: 0,
      costBasisMicros: 36 * USDC,
      realizedPnlMicros: 0
    }
  ];
}

export function getMockClaims(): MarketClaim[] {
  return [
    {
      id: "claim-1",
      marketId: MOCK_MARKETS[6].id, // resolved YES
      userAddress: ADDR_RECIPIENT,
      outcome: "YES",
      sharesMicros: 50 * USDC,
      payoutMicros: 50 * USDC,
      txHash: TX_2,
      blockNumber: "42500120",
      settlementId: "0xdeadbeefcafe000000000000000000000000000000000000000000000000beef" as Hex,
      pspUid: "psp:9a3f1b2e0c7d6584",
      claimedAt: isoDaysAgo(14)
    },
    {
      id: "claim-2",
      marketId: MOCK_MARKETS[7].id, // resolved NO
      userAddress: ADDR_RECIPIENT,
      outcome: "NO",
      sharesMicros: 75 * USDC,
      payoutMicros: 75 * USDC,
      txHash: TX_3,
      blockNumber: "42600810",
      settlementId: "0xcafebabe0000000000000000000000000000000000000000000000000000babe" as Hex,
      pspUid: "psp:e7c2a045b9d83110",
      claimedAt: isoDaysAgo(6)
    }
  ];
}

export const MOCK_CATEGORIES = ["All", "Crypto", "Stablecoins", "Macro", "Disburse"] as const;
