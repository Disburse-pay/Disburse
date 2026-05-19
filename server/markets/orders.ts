/**
 * Markets — Order EIP-712 helpers
 *
 * The Exchange contract uses EIP-712 typed-data signatures over the Order
 * struct. This module mirrors the on-chain domain/typehash so the backend
 * can verify maker signatures before queueing an order, and so the API can
 * normalize wire-format orders (strings) into the canonical bigint shape.
 *
 * Stays in lockstep with `contracts/src/markets/Exchange.sol` — any change to
 * the struct or domain there MUST be mirrored here, otherwise signatures
 * recovered off-chain will not match what `Exchange.fillOrder` accepts.
 */

import {
  hashTypedData,
  isAddress,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { ARC_CHAIN_ID } from "../../src/lib/arc.js";
import { HttpError } from "../http.js";

// ---------- Constants (mirror Exchange.sol) ----------

export const EXCHANGE_DOMAIN_NAME = "Disburse Markets";
export const EXCHANGE_DOMAIN_VERSION = "1";

/** 1e6 fixed-point base for price and size. */
export const PRICE_SCALE = 1_000_000n;

export const SIDE_BUY = 0 as const;
export const SIDE_SELL = 1 as const;
export const OUTCOME_NO = 0 as const;
export const OUTCOME_YES = 1 as const;

/**
 * EIP-712 type definition matching the on-chain ORDER_TYPEHASH:
 *   "Order(address maker,address market,uint8 outcome,uint8 side,uint256 price,uint256 size,uint64 expiry,uint256 salt)"
 *
 * Field order matters for the hash — keep it identical to the Solidity
 * encoding in `Exchange.hashOrder`.
 */
export const ORDER_EIP712_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "market", type: "address" },
    { name: "outcome", type: "uint8" },
    { name: "side", type: "uint8" },
    { name: "price", type: "uint256" },
    { name: "size", type: "uint256" },
    { name: "expiry", type: "uint64" },
    { name: "salt", type: "uint256" },
  ],
} as const;

// ---------- Types ----------

/** Canonical Order shape used for hashing and signature recovery. */
export type OrderTypedData = {
  maker: Address;
  market: Address;
  outcome: 0 | 1;
  side: 0 | 1;
  /** 1e6-scale price; 0 < price < PRICE_SCALE. */
  price: bigint;
  /** Share quantity at 1e6 scale. */
  size: bigint;
  /** Unix seconds; must be in the future at fill time. */
  expiry: bigint;
  /** Maker-chosen nonce that distinguishes otherwise-identical orders. */
  salt: bigint;
};

/** Order + signature, ready to ship to the chain or verify off-chain. */
export type SignedOrder = OrderTypedData & {
  signature: Hex;
};

/**
 * Wire-format order shape — the JSON shape POSTed to /api/markets-orders.
 * uint256/uint64 fields arrive as decimal strings to survive JSON without
 * precision loss.
 */
export type WireOrder = {
  maker: string;
  market: string;
  outcome: number;
  side: number;
  price: string;
  size: string;
  expiry: string;
  salt: string;
  signature: string;
};

// ---------- Domain ----------

export function getExchangeDomain(exchange: Address) {
  return {
    name: EXCHANGE_DOMAIN_NAME,
    version: EXCHANGE_DOMAIN_VERSION,
    chainId: ARC_CHAIN_ID,
    verifyingContract: exchange,
  } as const;
}

// ---------- Hashing ----------

/**
 * Compute the EIP-712 digest for an order — the same bytes `Exchange.hashOrder`
 * produces on-chain. Used as the primary key in `market_orders.hash`.
 */
export function hashOrder(order: OrderTypedData, exchange: Address): Hex {
  return hashTypedData({
    domain: getExchangeDomain(exchange),
    types: ORDER_EIP712_TYPES,
    primaryType: "Order",
    message: order,
  });
}

// ---------- Verification ----------

/**
 * Verify a maker signature over an Order. Returns true if `recover(signature)`
 * equals `order.maker`. Mirrors `Exchange._verifySignature` semantics.
 */
export async function verifyOrderSignature(
  order: SignedOrder,
  exchange: Address
): Promise<boolean> {
  return verifyTypedData({
    address: order.maker,
    domain: getExchangeDomain(exchange),
    types: ORDER_EIP712_TYPES,
    primaryType: "Order",
    message: {
      maker: order.maker,
      market: order.market,
      outcome: order.outcome,
      side: order.side,
      price: order.price,
      size: order.size,
      expiry: order.expiry,
      salt: order.salt,
    },
    signature: order.signature,
  });
}

// ---------- Validation ----------

/**
 * Throw an HttpError(400) if any field is out of bounds. Catches malformed
 * orders BEFORE we waste an RPC call to verify the signature.
 *
 * Mirrors the on-chain `require`s in `Exchange.fillOrder` so an order that
 * passes here will not revert at fill time on these checks.
 */
export function assertOrderBounds(order: OrderTypedData): void {
  if (order.price <= 0n || order.price >= PRICE_SCALE) {
    throw new HttpError(
      400,
      `Order price out of range: must satisfy 0 < price < ${PRICE_SCALE} (got ${order.price})`
    );
  }
  if (order.size <= 0n) {
    throw new HttpError(400, "Order size must be positive");
  }
  if (order.outcome !== OUTCOME_NO && order.outcome !== OUTCOME_YES) {
    throw new HttpError(400, `Invalid outcome ${order.outcome}: must be 0 (NO) or 1 (YES)`);
  }
  if (order.side !== SIDE_BUY && order.side !== SIDE_SELL) {
    throw new HttpError(400, `Invalid side ${order.side}: must be 0 (BUY) or 1 (SELL)`);
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (order.expiry <= now) {
    throw new HttpError(400, "Order is already expired");
  }
  if (!isAddress(order.maker)) {
    throw new HttpError(400, `Invalid maker address: ${order.maker}`);
  }
  if (!isAddress(order.market)) {
    throw new HttpError(400, `Invalid market address: ${order.market}`);
  }
}

// ---------- Wire <-> typed conversion ----------

/**
 * Parse a wire-format order (string-encoded bigints) into the canonical typed
 * shape. Throws HttpError(400) on malformed input. Does NOT verify the
 * signature — that's a separate step after a successful parse.
 */
export function parseWireOrder(wire: unknown): SignedOrder {
  if (typeof wire !== "object" || wire === null) {
    throw new HttpError(400, "Order must be a JSON object");
  }
  const w = wire as Partial<WireOrder>;
  if (typeof w.maker !== "string" || !isAddress(w.maker)) {
    throw new HttpError(400, "Order.maker must be an EVM address");
  }
  if (typeof w.market !== "string" || !isAddress(w.market)) {
    throw new HttpError(400, "Order.market must be an EVM address");
  }
  if (w.outcome !== 0 && w.outcome !== 1) {
    throw new HttpError(400, "Order.outcome must be 0 or 1");
  }
  if (w.side !== 0 && w.side !== 1) {
    throw new HttpError(400, "Order.side must be 0 or 1");
  }
  if (typeof w.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(w.signature)) {
    throw new HttpError(400, "Order.signature must be a 65-byte hex string");
  }

  const price = parseDecimalBigInt(w.price, "price");
  const size = parseDecimalBigInt(w.size, "size");
  const expiry = parseDecimalBigInt(w.expiry, "expiry");
  const salt = parseDecimalBigInt(w.salt, "salt");

  return {
    maker: w.maker,
    market: w.market,
    outcome: w.outcome,
    side: w.side,
    price,
    size,
    expiry,
    salt,
    signature: w.signature as Hex,
  };
}

function parseDecimalBigInt(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new HttpError(400, `Order.${field} must be a non-negative decimal string`);
  }
  return BigInt(value);
}
