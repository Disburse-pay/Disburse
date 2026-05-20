import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { indexFills } from "./fills.js";

const mocks = vi.hoisted(() => {
  const client = {
    getTransactionReceipt: vi.fn(),
  };
  return {
    client,
    createServerArcPublicClient: vi.fn(() => client),
    getOrderByHash: vi.fn(),
    getMarketByAddress: vi.fn(),
    getPositionByUserMarket: vi.fn(),
    insertFill: vi.fn(),
    applyFillToOrder: vi.fn(),
    applyPositionDelta: vi.fn(),
  };
});

vi.mock("./rpc.js", () => ({
  createServerArcPublicClient: mocks.createServerArcPublicClient,
}));

vi.mock("./repo.js", () => ({
  getOrderByHash: mocks.getOrderByHash,
  getMarketByAddress: mocks.getMarketByAddress,
  getPositionByUserMarket: mocks.getPositionByUserMarket,
  insertFill: mocks.insertFill,
  applyFillToOrder: mocks.applyFillToOrder,
  applyPositionDelta: mocks.applyPositionDelta,
}));

const EXCHANGE = "0xACC7D7441d869080EFf853E4edF6A836C49172Fb" as Address;
const MARKET = "0x1111111111111111111111111111111111111111" as Address;
const MAKER = "0x2222222222222222222222222222222222222222" as Address;
const TAKER = "0x3333333333333333333333333333333333333333" as Address;
const ORDER_HASH = `0x${"a".repeat(64)}` as Hex;
const TX_HASH = `0x${"b".repeat(64)}` as Hex;
const marketRow = { id: "7e7b5b2f-9df1-4ea1-a0da-0889fb6bd4fd" };

const FILLED_EVENT = parseAbiItem(
  "event Filled(bytes32 indexed orderHash, address indexed maker, address indexed taker, address market, uint8 outcome, uint8 side, uint256 price, uint256 fillSize, uint256 totalUsdc)"
);

describe("markets fills indexer", () => {
  beforeEach(() => {
    process.env.MARKETS_EXCHANGE = EXCHANGE;
    vi.clearAllMocks();
    mocks.getMarketByAddress.mockResolvedValue(marketRow);
    mocks.getOrderByHash.mockResolvedValue({
      hash: ORDER_HASH,
      filled: 0n,
      size: 10n,
    });
    mocks.getPositionByUserMarket.mockResolvedValue({
      yesShares: 5n,
      noShares: 0n,
      costBasis: 2_000_000n,
      realizedPnl: 0n,
    });
    mocks.insertFill.mockResolvedValue(true);
  });

  it("indexes a BUY fill and applies buyer/seller position deltas once", async () => {
    mocks.client.getTransactionReceipt.mockResolvedValue(
      receiptWithLogs([filledLog({ side: 0, outcome: 1, fillSize: 2n, totalUsdc: 900_000n })])
    );

    const result = await indexFills(TX_HASH);

    expect(result.insertedCount).toBe(1);
    expect(mocks.insertFill).toHaveBeenCalledWith(
      expect.objectContaining({
        marketId: marketRow.id,
        maker: MAKER,
        taker: TAKER,
        outcome: 1,
        side: 0,
        size: 2n,
        totalUsdc: 900_000n,
      })
    );
    expect(mocks.applyPositionDelta).toHaveBeenNthCalledWith(1, {
      marketId: marketRow.id,
      userAddress: MAKER,
      outcome: 1,
      shareDelta: 2n,
      costBasisDelta: 900_000n,
      realizedPnlDelta: 0n,
    });
    expect(mocks.applyPositionDelta).toHaveBeenNthCalledWith(2, {
      marketId: marketRow.id,
      userAddress: TAKER,
      outcome: 1,
      shareDelta: -2n,
      costBasisDelta: -800_000n,
      realizedPnlDelta: 100_000n,
    });
    expect(mocks.applyFillToOrder).toHaveBeenCalledWith(ORDER_HASH, 2n, 10n);
  });

  it("indexes a SELL fill with taker as buyer", async () => {
    mocks.getPositionByUserMarket.mockResolvedValue({
      yesShares: 0n,
      noShares: 5n,
      costBasis: 2_000_000n,
      realizedPnl: 0n,
    });
    mocks.client.getTransactionReceipt.mockResolvedValue(
      receiptWithLogs([filledLog({ side: 1, outcome: 0, fillSize: 3n, totalUsdc: 1_200_000n })])
    );

    await indexFills(TX_HASH);

    expect(mocks.applyPositionDelta).toHaveBeenNthCalledWith(1, {
      marketId: marketRow.id,
      userAddress: TAKER,
      outcome: 0,
      shareDelta: 3n,
      costBasisDelta: 1_200_000n,
      realizedPnlDelta: 0n,
    });
    expect(mocks.applyPositionDelta).toHaveBeenNthCalledWith(2, {
      marketId: marketRow.id,
      userAddress: MAKER,
      outcome: 0,
      shareDelta: -3n,
      costBasisDelta: -1_200_000n,
      realizedPnlDelta: 0n,
    });
  });

  it("does not create negative cached seller rows when the seller has no cached shares", async () => {
    mocks.getPositionByUserMarket.mockResolvedValue(null);
    mocks.client.getTransactionReceipt.mockResolvedValue(
      receiptWithLogs([filledLog({ side: 1, outcome: 0, fillSize: 3n, totalUsdc: 1_200_000n })])
    );

    await indexFills(TX_HASH);

    expect(mocks.applyPositionDelta).toHaveBeenCalledTimes(1);
    expect(mocks.applyPositionDelta).toHaveBeenCalledWith({
      marketId: marketRow.id,
      userAddress: TAKER,
      outcome: 0,
      shareDelta: 3n,
      costBasisDelta: 1_200_000n,
      realizedPnlDelta: 0n,
    });
  });

  it("does not reapply cache or order deltas on duplicate fill replay", async () => {
    mocks.insertFill.mockResolvedValue(false);
    mocks.client.getTransactionReceipt.mockResolvedValue(
      receiptWithLogs([filledLog({ side: 0, outcome: 1, fillSize: 2n, totalUsdc: 900_000n })])
    );

    const result = await indexFills(TX_HASH);

    expect(result.insertedCount).toBe(0);
    expect(mocks.applyPositionDelta).not.toHaveBeenCalled();
    expect(mocks.applyFillToOrder).not.toHaveBeenCalled();
  });

  it("rejects reverted fill receipts", async () => {
    mocks.client.getTransactionReceipt.mockResolvedValue({
      status: "reverted",
      blockNumber: 123n,
      logs: [],
    });

    await expect(indexFills(TX_HASH)).rejects.toThrow(/did not succeed/);
  });

  it("rejects receipts without Exchange Filled logs", async () => {
    mocks.client.getTransactionReceipt.mockResolvedValue(receiptWithLogs([]));

    await expect(indexFills(TX_HASH)).rejects.toThrow(/No Filled events/);
  });
});

function receiptWithLogs(logs: unknown[]) {
  return {
    status: "success",
    blockNumber: 123n,
    logs,
  };
}

function filledLog(input: {
  side: 0 | 1;
  outcome: 0 | 1;
  fillSize: bigint;
  totalUsdc: bigint;
}) {
  const topics = encodeEventTopics({
    abi: [FILLED_EVENT],
    eventName: "Filled",
    args: {
      orderHash: ORDER_HASH,
      maker: MAKER,
      taker: TAKER,
    },
  });
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint8" },
      { type: "uint8" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [MARKET, input.outcome, input.side, 500_000n, input.fillSize, input.totalUsdc]
  );

  return {
    address: EXCHANGE,
    data,
    topics,
    logIndex: 0,
  };
}
