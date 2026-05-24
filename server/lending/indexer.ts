/**
 * Lending indexer — pulls LendingPool event logs from Arc, mirrors them into
 * Supabase, refreshes per-user position cache, and writes a pool snapshot.
 *
 * Designed to be invoked by a cron (one-shot per call) — Vercel cron at
 * /api/lending-index OR a systemd timer on the VPS. Idempotent on rerun.
 *
 * Pseudocode per run:
 *   fromBlock = lastScanned + 1
 *   toBlock   = currentBlock
 *   for chunk in chunks(fromBlock, toBlock, CHUNK):
 *     logs = pool.getLogs(chunk)
 *     events, affectedUsers = decode(logs)
 *     insertEvents(events)
 *     for user in affectedUsers:
 *       refreshPosition(user)
 *   snapshot = readPoolState()
 *   insertPoolSnapshot(snapshot)
 *   setLastScannedBlock(toBlock)
 */
import { decodeEventLog, getAddress, parseAbiItem, type Address, type Hex } from "viem";
import { createServerArcPublicClient } from "../markets/rpc.js";
import {
  LENDING_POOL_ABI,
  IRM_ABI,
  PRICE_ADAPTER_ABI,
  LENDING_RESERVE_FACTOR_BPS,
  lendingAddresses,
} from "./contract.js";
import {
  getLastScannedBlock,
  insertEvents,
  insertPoolSnapshot,
  setLastScannedBlock,
  upsertPosition,
  type LendingEventRow,
  type LendingPosition,
  type LendingPoolSnapshot,
} from "./repo.js";

/** Max blocks per getLogs call. Arc public RPC accepts up to ~10k cleanly. */
const CHUNK_SIZE = 5_000n;

/** WAD = 1e18, used for HF comparison. */
const WAD = 10n ** 18n;

type RunResult = {
  fromBlock: bigint;
  toBlock: bigint;
  eventsInserted: number;
  positionsRefreshed: number;
  snapshotWritten: boolean;
};

export async function runLendingIndexer(options: { client?: ReturnType<typeof createServerArcPublicClient> } = {}): Promise<RunResult> {
  const client = options.client ?? createServerArcPublicClient({ timeoutMs: 15_000 });
  const addrs = lendingAddresses();

  const lastScanned = await getLastScannedBlock();
  const currentBlock = await client.getBlockNumber();

  // First-run safety: if last_scanned is 0, start from the LendingPool deploy
  // block (passed via env) rather than block 0 — saves the indexer from
  // walking the whole chain on first launch.
  const deployBlock = BigInt(process.env.LENDING_DEPLOY_BLOCK ?? "0");
  const fromBlock = lastScanned > 0n ? lastScanned + 1n : (deployBlock || currentBlock);

  if (fromBlock > currentBlock) {
    return { fromBlock, toBlock: currentBlock, eventsInserted: 0, positionsRefreshed: 0, snapshotWritten: false };
  }

  const affectedUsers = new Set<string>();
  let eventsInserted = 0;

  // ── Scan logs in chunks ────────────────────────────────────────────────
  for (let start = fromBlock; start <= currentBlock; start += CHUNK_SIZE) {
    const end = start + CHUNK_SIZE - 1n < currentBlock ? start + CHUNK_SIZE - 1n : currentBlock;
    const logs = await client.getLogs({
      address: addrs.pool,
      fromBlock: start,
      toBlock: end,
    });

    const rows: LendingEventRow[] = [];
    const blockTimes = new Map<bigint, Date>();

    for (const log of logs) {
      let decoded;
      try {
        decoded = decodeEventLog({
          abi: LENDING_POOL_ABI,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        // Unknown event signature (e.g. governance event added later) — skip.
        continue;
      }

      const blockNumber = log.blockNumber!;
      let blockTime = blockTimes.get(blockNumber);
      if (!blockTime) {
        const blk = await client.getBlock({ blockNumber });
        blockTime = new Date(Number(blk.timestamp) * 1000);
        blockTimes.set(blockNumber, blockTime);
      }

      const row = mapEventToRow({
        eventName: decoded.eventName,
        args: decoded.args as Record<string, unknown>,
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
        blockNumber,
        blockTime,
      });
      if (row) {
        rows.push(row);
        if (row.userAddress) affectedUsers.add(row.userAddress.toLowerCase());
        if (row.relatedAddress) affectedUsers.add(row.relatedAddress.toLowerCase());
      }
    }

    if (rows.length > 0) {
      eventsInserted += await insertEvents(rows);
    }
  }

  // ── Refresh affected users' position cache ─────────────────────────────
  let positionsRefreshed = 0;
  for (const user of affectedUsers) {
    try {
      const userAddr = getAddress(user);
      const pos = await readPosition(client, addrs.pool, userAddr, currentBlock);
      await upsertPosition(pos);
      positionsRefreshed++;
    } catch (err) {
      // Don't crash the indexer on one bad user — log and continue.
      console.error(`refreshPosition(${user}) failed:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Pool snapshot ──────────────────────────────────────────────────────
  let snapshotWritten = false;
  try {
    const snap = await readPoolSnapshot(client, addrs, currentBlock);
    await insertPoolSnapshot(snap);
    snapshotWritten = true;
  } catch (err) {
    console.error("poolSnapshot failed:", err instanceof Error ? err.message : err);
  }

  // ── Mark scan complete ─────────────────────────────────────────────────
  await setLastScannedBlock(currentBlock);

  return {
    fromBlock,
    toBlock: currentBlock,
    eventsInserted,
    positionsRefreshed,
    snapshotWritten,
  };
}

/**
 * Map a decoded event to a DB row. Returns null for events we don't index
 * (e.g. InterestAccrued — too noisy; we capture it via supplyIndex deltas
 * in pool snapshots instead).
 */
function mapEventToRow(input: {
  eventName: string;
  args: Record<string, unknown>;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTime: Date;
}): LendingEventRow | null {
  const { eventName, args, txHash, logIndex, blockNumber, blockTime } = input;
  const base = { txHash, logIndex, blockNumber, blockTime, eventType: eventName };

  switch (eventName) {
    case "Deposited":
      // (user, usdcAmount, sharesMinted)
      return {
        ...base,
        userAddress: args.user as Address,
        amountA: args.usdcAmount as bigint,
        amountB: args.sharesMinted as bigint,
      };
    case "Withdrew":
      // (user, sharesBurned, usdcAmount)
      return {
        ...base,
        userAddress: args.user as Address,
        amountA: args.sharesBurned as bigint,
        amountB: args.usdcAmount as bigint,
      };
    case "CollateralDeposited":
    case "CollateralWithdrew":
      return {
        ...base,
        userAddress: args.user as Address,
        amountA: args.cirBtcAmount as bigint,
      };
    case "Borrowed":
      return {
        ...base,
        userAddress: args.user as Address,
        amountA: args.usdcAmount as bigint,
      };
    case "Repaid":
      // (payer, user, usdcAmount) — credit goes to user; payer is related
      return {
        ...base,
        userAddress: args.user as Address,
        relatedAddress: args.payer as Address,
        amountA: args.usdcAmount as bigint,
      };
    case "Liquidated":
      // (liquidator, borrower, usdcRepaid, cirBtcSeized, bonusBtc)
      return {
        ...base,
        userAddress: args.borrower as Address,
        relatedAddress: args.liquidator as Address,
        amountA: args.usdcRepaid as bigint,
        amountB: args.cirBtcSeized as bigint,
        amountC: args.bonusBtc as bigint,
      };
    case "ReservesWithdrawn":
      return {
        ...base,
        relatedAddress: args.to as Address,
        amountA: args.amount as bigint,
      };
    case "InterestAccrued":
      // High frequency — skip the event log table to avoid bloat; pool
      // snapshots capture the same data.
      return null;
    default:
      return null;
  }
}

/**
 * Read the on-chain state for one user. Robust to price-stale: if the
 * adapter reverts (Pyth not pushed in `maxAgeSeconds`), debt and collateral
 * amounts still come back; only the USD-denominated cache is null.
 */
async function readPosition(
  client: ReturnType<typeof createServerArcPublicClient>,
  pool: Address,
  user: Address,
  blockNumber: bigint
): Promise<LendingPosition> {
  const [collateral, scaledBorrow, debtUsdc] = await Promise.all([
    client.readContract({ address: pool, abi: LENDING_POOL_ABI, functionName: "collateral", args: [user] }) as Promise<bigint>,
    client.readContract({ address: pool, abi: LENDING_POOL_ABI, functionName: "scaledBorrow", args: [user] }) as Promise<bigint>,
    client.readContract({ address: pool, abi: LENDING_POOL_ABI, functionName: "userDebtUsdc", args: [user] }) as Promise<bigint>,
  ]);

  let collateralUsdc = 0n;
  let healthFactor: bigint | null = null;
  let isLiquidatable = false;
  try {
    const [c, hf] = await Promise.all([
      client.readContract({ address: pool, abi: LENDING_POOL_ABI, functionName: "collateralValueUsdc", args: [user] }) as Promise<bigint>,
      client.readContract({ address: pool, abi: LENDING_POOL_ABI, functionName: "healthFactor", args: [user] }) as Promise<bigint>,
    ]);
    collateralUsdc = c;
    healthFactor = hf;
    // HF < 1e18 means unhealthy. Note: contracts/PythPriceAdapter returns
    // type(uint256).max when debt == 0 (i.e. healthy infinity).
    isLiquidatable = debtUsdc > 0n && healthFactor < WAD;
  } catch {
    // Oracle stale — leave HF null + isLiquidatable false. The keeper bot
    // will push a Pyth update before any liquidation attempt.
  }

  return {
    userAddress: user,
    collateralAmount: collateral,
    scaledBorrow: scaledBorrow,
    cachedDebtUsdc: debtUsdc,
    cachedCollateralUsdc: collateralUsdc,
    cachedHealthFactor: healthFactor,
    isLiquidatable,
    lastUpdatedBlock: blockNumber,
    lastUpdatedAt: new Date().toISOString(),
  };
}

async function readPoolSnapshot(
  client: ReturnType<typeof createServerArcPublicClient>,
  addrs: ReturnType<typeof lendingAddresses>,
  blockNumber: bigint
): Promise<LendingPoolSnapshot> {
  const [cash, borrows, reserves, supplyIdx, borrowIdx] = await Promise.all([
    client.readContract({ address: addrs.pool, abi: LENDING_POOL_ABI, functionName: "availableCash" }) as Promise<bigint>,
    client.readContract({ address: addrs.pool, abi: LENDING_POOL_ABI, functionName: "totalBorrows" }) as Promise<bigint>,
    client.readContract({ address: addrs.pool, abi: LENDING_POOL_ABI, functionName: "totalReserves" }) as Promise<bigint>,
    client.readContract({ address: addrs.pool, abi: LENDING_POOL_ABI, functionName: "supplyIndex" }) as Promise<bigint>,
    client.readContract({ address: addrs.pool, abi: LENDING_POOL_ABI, functionName: "borrowIndex" }) as Promise<bigint>,
  ]);

  const [util, borrowApr, supplyApr] = await Promise.all([
    client.readContract({
      address: addrs.irm,
      abi: IRM_ABI,
      functionName: "utilization",
      args: [cash, borrows, reserves],
    }) as Promise<bigint>,
    client.readContract({
      address: addrs.irm,
      abi: IRM_ABI,
      functionName: "getBorrowRatePerYear",
      args: [cash, borrows, reserves],
    }) as Promise<bigint>,
    client.readContract({
      address: addrs.irm,
      abi: IRM_ABI,
      functionName: "getSupplyRatePerYear",
      args: [cash, borrows, reserves, LENDING_RESERVE_FACTOR_BPS],
    }) as Promise<bigint>,
  ]);

  let btcPriceWad: bigint | null = null;
  try {
    btcPriceWad = (await client.readContract({
      address: addrs.priceAdapter,
      abi: PRICE_ADAPTER_ABI,
      functionName: "getPrice",
    })) as bigint;
  } catch {
    // Pyth stale — store null. Keeper bot pushes updates to fix.
  }

  return {
    blockNumber,
    cashUsdc: cash,
    totalBorrowsUsdc: borrows,
    totalReservesUsdc: reserves,
    supplyIndex: supplyIdx,
    borrowIndex: borrowIdx,
    utilizationWad: util,
    borrowAprWad: borrowApr,
    supplyAprWad: supplyApr,
    btcPriceWad,
  };
}

/**
 * Full-refresh: re-read every known position and update its cached HF. Used
 * by the keeper after pushing a Pyth update, so liquidation candidates pick
 * up the new price.
 */
export async function refreshAllPositions(
  users: Address[],
  options: { client?: ReturnType<typeof createServerArcPublicClient> } = {}
): Promise<number> {
  const client = options.client ?? createServerArcPublicClient({ timeoutMs: 15_000 });
  const { pool } = lendingAddresses();
  const block = await client.getBlockNumber();
  let count = 0;
  for (const user of users) {
    try {
      const pos = await readPosition(client, pool, getAddress(user), block);
      await upsertPosition(pos);
      count++;
    } catch (err) {
      console.error(`refreshAllPositions(${user}) failed:`, err instanceof Error ? err.message : err);
    }
  }
  return count;
}
