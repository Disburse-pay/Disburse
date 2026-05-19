/**
 * Markets — Fills indexer
 *
 * Consumes a user-submitted tx hash that called `Exchange.fillOrder` (or a
 * multicall thereof) and indexes every `Filled` event found on the configured
 * Exchange contract. Idempotent on `(tx_hash, order_hash, size)`.
 *
 * Called by `POST /api/markets-fills` after the taker submits a fill on
 * Arc; not invoked automatically (no chain watcher in v1).
 */

import {
  decodeEventLog,
  getAddress,
  keccak256,
  parseAbiItem,
  stringToBytes,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { HttpError } from "../http.js";
import {
  applyPositionDelta,
  applyFillToOrder,
  getMarketByAddress,
  getOrderByHash,
  insertFill,
} from "./repo.js";
import { createServerArcPublicClient } from "./rpc.js";

const FILLED_EVENT = parseAbiItem(
  "event Filled(bytes32 indexed orderHash, address indexed maker, address indexed taker, address market, uint8 outcome, uint8 side, uint256 price, uint256 fillSize, uint256 totalUsdc)"
);

const FILLED_SELECTOR = keccak256(
  stringToBytes(
    "Filled(bytes32,address,address,address,uint8,uint8,uint256,uint256,uint256)"
  )
);

type EventTopics = [] | [Hex, ...Hex[]];
type ReceiptLogWithTopics = {
  address: Address;
  data: Hex;
  topics: EventTopics;
};

function getExchangeAddress(): Address {
  const addr = process.env.MARKETS_EXCHANGE;
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new HttpError(503, "MARKETS_EXCHANGE is not configured.");
  }
  return getAddress(addr);
}

export type IndexedFill = {
  orderHash: Hex;
  maker: Address;
  taker: Address;
  market: Address;
  outcome: 0 | 1;
  side: 0 | 1;
  price: bigint;
  fillSize: bigint;
  totalUsdc: bigint;
};

export type IndexFillsResult = {
  txHash: Hash;
  blockNumber: string;
  fills: IndexedFill[];
  insertedCount: number;
};

/**
 * Index all Filled events emitted by the Exchange in `txHash`. Returns the
 * decoded fills plus a count of how many were newly persisted (vs already
 * indexed on a prior call). Throws if no Filled events are found.
 */
export async function indexFills(txHash: Hash): Promise<IndexFillsResult> {
  const exchange = getExchangeAddress();
  const publicClient = createServerArcPublicClient();
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new HttpError(409, `Fill tx ${txHash} did not succeed`);
  }

  const logs = receipt.logs as unknown as ReceiptLogWithTopics[];
  const filledLogs = logs.filter(
    (log) =>
      log.address.toLowerCase() === exchange.toLowerCase() &&
      log.topics[0]?.toLowerCase() === FILLED_SELECTOR.toLowerCase()
  );
  if (filledLogs.length === 0) {
    throw new HttpError(
      409,
      `No Filled events found in tx ${txHash} from Exchange ${exchange}`
    );
  }

  const fills: IndexedFill[] = [];
  let insertedCount = 0;

  for (const log of filledLogs) {
    const decoded = decodeEventLog({
      abi: [FILLED_EVENT],
      data: log.data,
      topics: log.topics,
    }) as {
      args: {
      orderHash: Hex;
      maker: Address;
      taker: Address;
      market: Address;
      outcome: number;
      side: number;
      price: bigint;
      fillSize: bigint;
      totalUsdc: bigint;
      };
    };
    const args = decoded.args;

    const outcome = (args.outcome === 1 ? 1 : 0) as 0 | 1;
    const side = (args.side === 1 ? 1 : 0) as 0 | 1;
    const fill: IndexedFill = {
      orderHash: args.orderHash,
      maker: getAddress(args.maker),
      taker: getAddress(args.taker),
      market: getAddress(args.market),
      outcome,
      side,
      price: args.price,
      fillSize: args.fillSize,
      totalUsdc: args.totalUsdc,
    };
    fills.push(fill);

    // Look up the order row to find the market_id (uuid) and current `filled`.
    // If the order is unknown to the backend (i.e. someone signed it
    // externally and a taker filled it without it ever being POSTed to
    // /api/markets-orders), there's no row to update — we still record the
    // fill so the chart and price feed reflect reality.
    const orderRow = await getOrderByHash(fill.orderHash);
    const market = await getMarketByAddress(fill.market);
    if (!market) {
      throw new HttpError(
        409,
        `Filled event references unknown market ${fill.market} — index the market first`
      );
    }

    const inserted = await insertFill({
      marketId: market.id,
      orderHash: fill.orderHash,
      taker: fill.taker,
      maker: fill.maker,
      outcome: fill.outcome,
      side: fill.side,
      price: fill.price,
      size: fill.fillSize,
      totalUsdc: fill.totalUsdc,
      txHash,
      blockNumber: String(receipt.blockNumber),
    });
    if (inserted) {
      insertedCount += 1;
      await applyFillToPositions({
        marketId: market.id,
        maker: fill.maker,
        taker: fill.taker,
        outcome: fill.outcome,
        side: fill.side,
        size: fill.fillSize,
        totalUsdc: fill.totalUsdc,
      });

      if (orderRow) {
        const newFilled = orderRow.filled + fill.fillSize;
        await applyFillToOrder(fill.orderHash, newFilled, orderRow.size);
      }
    }
  }

  return {
    txHash,
    blockNumber: String(receipt.blockNumber),
    fills,
    insertedCount,
  };
}

async function applyFillToPositions(input: {
  marketId: string;
  maker: Address;
  taker: Address;
  outcome: 0 | 1;
  side: 0 | 1;
  size: bigint;
  totalUsdc: bigint;
}): Promise<void> {
  const buyer = input.side === 0 ? input.maker : input.taker;
  const seller = input.side === 0 ? input.taker : input.maker;

  await applyPositionDelta({
    marketId: input.marketId,
    userAddress: buyer,
    outcome: input.outcome,
    shareDelta: input.size,
    costBasisDelta: input.totalUsdc,
    realizedPnlDelta: 0n,
  });

  await applyPositionDelta({
    marketId: input.marketId,
    userAddress: seller,
    outcome: input.outcome,
    shareDelta: -input.size,
    costBasisDelta: 0n,
    realizedPnlDelta: input.totalUsdc,
  });
}
