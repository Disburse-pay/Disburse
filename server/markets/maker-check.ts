/**
 * Markets — Maker inventory pre-check
 *
 * Verifies that a maker who's posting a signed Order actually holds the
 * inventory they're promising AND has approved the Exchange to move it.
 *
 * Without this check, the off-chain orderbook can advertise orders that are
 * guaranteed to revert at fill time: a taker walks the book, builds a fill
 * plan, signs `Exchange.fillOrders(...)`, and the tx reverts on the maker's
 * `transferFrom` step. The taker eats gas; the bad order keeps poisoning
 * the book until expiry.
 *
 * Polymarket's CLOB Operator does the equivalent validation before accepting
 * an order. We can't do quite the same thing (no operator role on-chain),
 * but we can do the read-only checks here so a bad order never makes it
 * into `market_orders` in the first place.
 *
 * Side semantics (mirrors Exchange.sol):
 *   BUY  (side=0): maker promises USDC = price * size / 1e6
 *                  → check USDC balance + allowance(maker, Exchange)
 *   SELL (side=1): maker promises `size` shares of (market, outcome)
 *                  → check OutcomeToken balanceOf(maker, tokenId)
 *                    + isApprovedForAll(maker, Exchange)
 *
 * Naive in v1: we do NOT subtract this maker's OTHER open orders from their
 * available inventory. With MM-bot quote sizes (~$10) against double-digit
 * inventories the false-negative cost (rejecting a borderline-valid order)
 * outweighs the false-positive cost (admitting an order that double-spends
 * the same balance), and we save 1 RPC per post. Revisit if we onboard
 * human makers signing large orders against thin inventory.
 */

import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbi,
  type Address,
} from "viem";
import { HttpError } from "../http.js";
import { createServerArcPublicClient } from "./rpc.js";
import { PRICE_SCALE, type OrderTypedData } from "./orders.js";
import { TOKENS } from "../../src/lib/arc.js";

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

const ERC1155_ABI = parseAbi([
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
  "function isApprovedForAll(address account, address operator) external view returns (bool)",
]);

/**
 * Mirror of `OutcomeToken.tokenIdFor(market, outcome)`:
 *   uint256(keccak256(abi.encode(market, outcome)))
 *
 * Kept identical to the browser version in `src/lib/markets/onchain.ts`.
 * If you change one, change both — and add a Solidity test that pins the
 * derivation, since divergence is silent (the Exchange will revert at fill
 * with "insufficient" rather than a tokenId mismatch).
 */
export function tokenIdFor(market: Address, outcome: 0 | 1): bigint {
  const encoded = encodeAbiParameters(
    [{ type: "address" }, { type: "uint8" }],
    [market, outcome]
  );
  return BigInt(keccak256(encoded));
}

function getOutcomeTokenAddress(): Address {
  const raw = process.env.MARKETS_OUTCOME_TOKEN;
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new HttpError(503, "MARKETS_OUTCOME_TOKEN is not configured.");
  }
  return getAddress(raw);
}

function getCollateralAddress(): Address {
  const raw = process.env.MARKETS_COLLATERAL_ADDRESS ?? TOKENS.USDC.address;
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new HttpError(503, "MARKETS_COLLATERAL_ADDRESS is not configured.");
  }
  return getAddress(raw);
}

/**
 * Minimal RPC surface that the inventory check needs — typed so we can
 * inject a stub in unit tests without spinning up an actual chain client.
 */
export type InventoryReader = {
  readContract: (args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<unknown>;
};

export type AssertMakerInventoryOptions = {
  /** Pre-built RPC client. Defaults to the standard Arc fallback client. */
  client?: InventoryReader;
  /** Override collateral (USDC) address. Defaults to env or TOKENS.USDC. */
  collateral?: Address;
  /** Override OutcomeToken address. Defaults to MARKETS_OUTCOME_TOKEN. */
  outcomeToken?: Address;
};

/**
 * Throw HttpError(400) if the maker doesn't have the balance + approval to
 * back this order. Performs exactly two RPC reads — balance + allowance for
 * BUY, balance + isApprovedForAll for SELL — in parallel.
 *
 * Tests: see `maker-check.test.ts` — pass a stub `InventoryReader` to avoid
 * hitting Arc.
 */
export async function assertMakerInventory(
  order: OrderTypedData,
  exchangeAddress: Address,
  options: AssertMakerInventoryOptions = {}
): Promise<void> {
  const client: InventoryReader =
    options.client ?? createServerArcPublicClient({ timeoutMs: 8_000 });

  if (order.side === 0) {
    // BUY: maker pays USDC on fill.
    const usdc = options.collateral ?? getCollateralAddress();
    const required = (order.price * order.size) / PRICE_SCALE;

    const [balance, allowance] = (await Promise.all([
      client.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [order.maker],
      }),
      client.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [order.maker, exchangeAddress],
      }),
    ])) as [bigint, bigint];

    if (balance < required) {
      throw new HttpError(
        400,
        `Maker ${order.maker} USDC balance ${balance} is below the order's required ${required} (price * size / 1e6).`
      );
    }
    if (allowance < required) {
      throw new HttpError(
        400,
        `Maker ${order.maker} must approve Exchange ${exchangeAddress} to spend at least ${required} USDC (current allowance: ${allowance}).`
      );
    }
    return;
  }

  // SELL: maker delivers `size` shares of (market, outcome) on fill.
  const outcomeToken = options.outcomeToken ?? getOutcomeTokenAddress();
  const id = tokenIdFor(order.market, order.outcome);

  const [shares, approved] = (await Promise.all([
    client.readContract({
      address: outcomeToken,
      abi: ERC1155_ABI,
      functionName: "balanceOf",
      args: [order.maker, id],
    }),
    client.readContract({
      address: outcomeToken,
      abi: ERC1155_ABI,
      functionName: "isApprovedForAll",
      args: [order.maker, exchangeAddress],
    }),
  ])) as [bigint, boolean];

  if (shares < order.size) {
    const label = order.outcome === 1 ? "YES" : "NO";
    throw new HttpError(
      400,
      `Maker ${order.maker} holds ${shares} ${label} shares but order requires ${order.size}.`
    );
  }
  if (!approved) {
    throw new HttpError(
      400,
      `Maker ${order.maker} must call setApprovalForAll(${exchangeAddress}, true) on OutcomeToken ${outcomeToken} before posting SELL orders.`
    );
  }
}
