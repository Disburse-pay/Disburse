/**
 * Markets — Claims indexer
 *
 * Consumes a user-submitted Arc tx hash, decodes the MarketClaimed event,
 * persists the claim row, and (when ENABLE_PSP=1) issues the PSP that proves
 * the payout off-chain. This is the entry point invoked by
 * `api/markets-claims.ts`.
 *
 * The whole flow is idempotent on `market_claims.tx_hash` — replaying the
 * same submission returns the already-stored claim and its PSP UID.
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
import type { Market, MarketClaim } from "../../src/lib/markets/types.js";
import { tryIssueMarketClaimPsp } from "../psp/hook.js";
import {
  applyPositionDelta,
  getClaimByTxHash,
  getMarketById,
  getPositionByUserMarket,
  insertClaim,
  outcomeFromInt,
} from "./repo.js";
import { createServerArcPublicClient } from "./rpc.js";
import {
  clampShareReduction,
  costBasisForShareReduction,
  prorateAmount,
} from "./accounting.js";

const MARKET_CLAIMED_EVENT = parseAbiItem(
  "event MarketClaimed(bytes32 indexed settlementId, bytes32 indexed marketId, address indexed claimant, uint256 amount, uint8 outcome)"
);

const MARKET_CLAIMED_SELECTOR = keccak256(
  stringToBytes("MarketClaimed(bytes32,bytes32,address,uint256,uint8)")
);

type EventTopics = [] | [Hex, ...Hex[]];
type ReceiptLogWithTopics = {
  address: Address;
  data: Hex;
  topics: EventTopics;
};

export type IndexClaimResult = {
  claim: MarketClaim;
  market: Market;
  pspUid?: string;
  isNew: boolean;
};

/**
 * Index a claim transaction:
 *   1. Look up the market by off-chain UUID.
 *   2. Fetch the Arc receipt and locate the MarketClaimed log emitted by
 *      that market's contract.
 *   3. Validate the event's onchain marketId matches keccak256(marketId).
 *   4. Insert (upsert) the market_claims row.
 *   5. Fire the PSP issuance hook; non-fatal if the feature flag is off.
 */
export async function indexClaim(input: {
  marketId: string;
  txHash: Hash;
}): Promise<IndexClaimResult> {
  const market = await getMarketById(input.marketId);
  if (!market) {
    throw new HttpError(404, `Market ${input.marketId} not found`);
  }

  // Short-circuit: if the claim is already indexed, return the cached row
  // plus any existing PSP UID. This keeps the endpoint cheap on retries.
  const existing = await getClaimByTxHash(input.txHash);
  if (existing && existing.marketId === market.id) {
    return {
      claim: existing,
      market,
      pspUid: existing.pspUid,
      isNew: false,
    };
  }

  const publicClient = createServerArcPublicClient();
  const receipt = await publicClient.getTransactionReceipt({
    hash: input.txHash,
  });
  if (receipt.status !== "success") {
    throw new HttpError(409, `Claim tx ${input.txHash} did not succeed`);
  }

  const logs = receipt.logs as unknown as ReceiptLogWithTopics[];
  const claimedLog = logs.find(
    (log) =>
      log.address.toLowerCase() === market.onchainAddress.toLowerCase() &&
      log.topics[0]?.toLowerCase() === MARKET_CLAIMED_SELECTOR.toLowerCase()
  );
  if (!claimedLog) {
    throw new HttpError(
      409,
      `No MarketClaimed log found in tx ${input.txHash} for market ${market.onchainAddress}`
    );
  }

  const decoded = decodeEventLog({
    abi: [MARKET_CLAIMED_EVENT],
    data: claimedLog.data,
    topics: claimedLog.topics,
  }) as {
    args: {
    settlementId: Hex;
    marketId: Hex;
    claimant: Address;
    amount: bigint;
    outcome: number;
    };
  };
  const args = decoded.args;

  // Sanity check: the on-chain bytes32 marketId must match keccak256(uuid).
  // Mismatch means either the wrong market id was passed by the caller or
  // the contract is rogue — either way refuse to index.
  const expectedOnchainId = keccak256(stringToBytes(market.id));
  if (args.marketId.toLowerCase() !== expectedOnchainId.toLowerCase()) {
    throw new HttpError(
      409,
      `MarketClaimed event marketId ${args.marketId} does not match expected ${expectedOnchainId} for market ${market.id}`
    );
  }

  const outcomeInt = (args.outcome === 1 ? 1 : 0) as 0 | 1;

  const claim = await insertClaim({
    marketId: market.id,
    userAddress: getAddress(args.claimant),
    outcome: outcomeInt,
    shares: args.amount, // 1 share burned per 1 USDC payout in v1 (see Market.claim)
    payout: args.amount,
    txHash: input.txHash,
    blockNumber: String(receipt.blockNumber),
    settlementId: args.settlementId,
  });

  await applyClaimToCachedPosition({
    marketId: market.id,
    userAddress: getAddress(args.claimant),
    outcome: outcomeInt,
    shares: args.amount,
    payout: args.amount,
  });

  // Fire the PSP hook. The market must already be resolved with a winning
  // outcome for the hook to actually produce a PSP — otherwise it throws
  // internally and the catch in tryIssueMarketClaimPsp swallows it so the
  // claim row still gets returned to the caller.
  const pspUid = await tryIssueMarketClaimPsp(claim, market);

  return {
    claim: { ...claim, pspUid: pspUid ?? claim.pspUid },
    market,
    pspUid,
    isNew: true,
  };
}

/**
 * Standalone helper for endpoints that want to re-trigger PSP issuance for
 * an already-indexed claim (e.g. retry after PSP signing key was misconfigured
 * at original index time). Idempotent via issuePsp's market_claim_id key.
 */
export async function reissuePspForClaim(
  txHash: Hash
): Promise<{ pspUid?: string }> {
  const claim = await getClaimByTxHash(txHash);
  if (!claim) {
    throw new HttpError(404, `No indexed claim for tx ${txHash}`);
  }
  const market = await getMarketById(claim.marketId);
  if (!market) {
    throw new HttpError(404, `Market ${claim.marketId} not found`);
  }
  const pspUid = await tryIssueMarketClaimPsp(claim, market);
  return { pspUid };
}

// Re-export for use in tests / debugging.
export { MARKET_CLAIMED_SELECTOR };

// Suppress unused warnings on internal helpers exposed by repo barrel.
void outcomeFromInt;

async function applyClaimToCachedPosition(input: {
  marketId: string;
  userAddress: Address;
  outcome: 0 | 1;
  shares: bigint;
  payout: bigint;
}): Promise<void> {
  const position = await getPositionByUserMarket(input.marketId, input.userAddress);
  if (!position) return;

  const shareReduction = clampShareReduction(position, input.outcome, input.shares);
  if (shareReduction <= 0n) return;

  const basisReduction = costBasisForShareReduction(
    position,
    input.outcome,
    shareReduction
  );
  const payout = prorateAmount(input.payout, shareReduction, input.shares);

  await applyPositionDelta({
    marketId: input.marketId,
    userAddress: input.userAddress,
    outcome: input.outcome,
    shareDelta: -shareReduction,
    costBasisDelta: -basisReduction,
    realizedPnlDelta: payout - basisReduction,
  });
}
