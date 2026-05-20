import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseAbiItem,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { indexClaim } from "./claims.js";

const mocks = vi.hoisted(() => {
  const client = {
    getTransactionReceipt: vi.fn(),
  };
  return {
    client,
    createServerArcPublicClient: vi.fn(() => client),
    getClaimByTxHash: vi.fn(),
    getMarketById: vi.fn(),
    insertClaim: vi.fn(),
    getPositionByUserMarket: vi.fn(),
    applyPositionDelta: vi.fn(),
    tryIssueMarketClaimPsp: vi.fn(),
  };
});

vi.mock("./rpc.js", () => ({
  createServerArcPublicClient: mocks.createServerArcPublicClient,
}));

vi.mock("./repo.js", () => ({
  getClaimByTxHash: mocks.getClaimByTxHash,
  getMarketById: mocks.getMarketById,
  insertClaim: mocks.insertClaim,
  getPositionByUserMarket: mocks.getPositionByUserMarket,
  applyPositionDelta: mocks.applyPositionDelta,
  outcomeFromInt: (n: number) => (n === 1 ? "YES" : "NO"),
}));

vi.mock("../psp/hook.js", () => ({
  tryIssueMarketClaimPsp: mocks.tryIssueMarketClaimPsp,
}));

const MARKET_ID = "7e7b5b2f-9df1-4ea1-a0da-0889fb6bd4fd";
const MARKET = "0x1111111111111111111111111111111111111111" as Address;
const CLAIMANT = "0x2222222222222222222222222222222222222222" as Address;
const TX_HASH = `0x${"b".repeat(64)}` as Hex;
const SETTLEMENT_ID = `0x${"c".repeat(64)}` as Hex;
const PSP_UID = "psp:abcdef1234567890";

const market = {
  id: MARKET_ID,
  onchainAddress: MARKET,
  question: "Will this smoke test resolve?",
  category: "Smoke",
  closesAt: "2026-05-19T00:00:00.000Z",
  status: "resolved",
  winningOutcome: "YES",
  resolvesAt: "2026-05-19T00:10:00.000Z",
  yesPriceMicros: 0,
  noPriceMicros: 0,
  volumeMicros: 0,
  openInterestMicros: 0,
  createdAt: "2026-05-18T00:00:00.000Z",
};

const claim = {
  id: "2f06c2f1-0682-4f94-9a5f-63ba9cde3d42",
  marketId: MARKET_ID,
  userAddress: CLAIMANT,
  outcome: "YES",
  sharesMicros: 1_000_000,
  payoutMicros: 1_000_000,
  txHash: TX_HASH,
  blockNumber: "123",
  settlementId: SETTLEMENT_ID,
  claimedAt: "2026-05-19T00:11:00.000Z",
};

const MARKET_CLAIMED_EVENT = parseAbiItem(
  "event MarketClaimed(bytes32 indexed settlementId, bytes32 indexed marketId, address indexed claimant, uint256 amount, uint8 outcome)"
);

describe("markets claims indexer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMarketById.mockResolvedValue(market);
    mocks.getClaimByTxHash.mockResolvedValue(null);
    mocks.insertClaim.mockResolvedValue(claim);
    mocks.getPositionByUserMarket.mockResolvedValue({
      yesShares: 2_000_000n,
      noShares: 0n,
      costBasis: 800_000n,
      realizedPnl: 0n,
    });
    mocks.tryIssueMarketClaimPsp.mockResolvedValue(PSP_UID);
    mocks.client.getTransactionReceipt.mockResolvedValue(
      receiptWithLogs([claimLog({ marketId: onchainMarketId(MARKET_ID) })])
    );
  });

  it("indexes a MarketClaimed receipt and returns the issued PSP UID", async () => {
    const result = await indexClaim({ marketId: MARKET_ID, txHash: TX_HASH });

    expect(result).toMatchObject({
      claim: { ...claim, pspUid: PSP_UID },
      market,
      pspUid: PSP_UID,
      isNew: true,
    });
    expect(mocks.insertClaim).toHaveBeenCalledWith({
      marketId: MARKET_ID,
      userAddress: CLAIMANT,
      outcome: 1,
      shares: 1_000_000n,
      payout: 1_000_000n,
      txHash: TX_HASH,
      blockNumber: "123",
      settlementId: SETTLEMENT_ID,
    });
    expect(mocks.tryIssueMarketClaimPsp).toHaveBeenCalledWith(claim, market);
    expect(mocks.applyPositionDelta).toHaveBeenCalledWith({
      marketId: MARKET_ID,
      userAddress: CLAIMANT,
      outcome: 1,
      shareDelta: -1_000_000n,
      costBasisDelta: -400_000n,
      realizedPnlDelta: 600_000n,
    });
  });

  it("short-circuits already indexed claims without reading RPC", async () => {
    mocks.getClaimByTxHash.mockResolvedValue({ ...claim, pspUid: PSP_UID });

    const result = await indexClaim({ marketId: MARKET_ID, txHash: TX_HASH });

    expect(result.isNew).toBe(false);
    expect(result.pspUid).toBe(PSP_UID);
    expect(mocks.client.getTransactionReceipt).not.toHaveBeenCalled();
    expect(mocks.insertClaim).not.toHaveBeenCalled();
    expect(mocks.applyPositionDelta).not.toHaveBeenCalled();
  });

  it("rejects reverted claim receipts", async () => {
    mocks.client.getTransactionReceipt.mockResolvedValue({
      status: "reverted",
      blockNumber: 123n,
      logs: [],
    });

    await expect(indexClaim({ marketId: MARKET_ID, txHash: TX_HASH })).rejects.toThrow(
      /did not succeed/
    );
  });

  it("rejects receipts missing MarketClaimed logs", async () => {
    mocks.client.getTransactionReceipt.mockResolvedValue(receiptWithLogs([]));

    await expect(indexClaim({ marketId: MARKET_ID, txHash: TX_HASH })).rejects.toThrow(
      /No MarketClaimed log/
    );
  });

  it("rejects MarketClaimed logs for a different market id", async () => {
    mocks.client.getTransactionReceipt.mockResolvedValue(
      receiptWithLogs([claimLog({ marketId: `0x${"d".repeat(64)}` as Hex })])
    );

    await expect(indexClaim({ marketId: MARKET_ID, txHash: TX_HASH })).rejects.toThrow(
      /does not match expected/
    );
  });
});

function receiptWithLogs(logs: unknown[]) {
  return {
    status: "success",
    blockNumber: 123n,
    logs,
  };
}

function claimLog(input: { marketId: Hex }) {
  const topics = encodeEventTopics({
    abi: [MARKET_CLAIMED_EVENT],
    eventName: "MarketClaimed",
    args: {
      settlementId: SETTLEMENT_ID,
      marketId: input.marketId,
      claimant: CLAIMANT,
    },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint8" }],
    [1_000_000n, 1]
  );

  return {
    address: MARKET,
    data,
    topics,
    logIndex: 0,
  };
}

function onchainMarketId(marketId: string): Hex {
  return keccak256(stringToBytes(marketId));
}
