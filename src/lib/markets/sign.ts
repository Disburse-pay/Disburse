/**
 * Browser-side EIP-712 signing for the markets Exchange.
 *
 * The wallet-side typed-data envelope MUST match `server/markets/orders.ts`
 * byte-for-byte — any divergence means the signature recovers to a different
 * address and the order is rejected. The struct field order (maker, market,
 * outcome, side, price, size, expiry, salt) mirrors the on-chain
 * `Exchange.ORDER_TYPEHASH`.
 *
 * Why both client and server hold the literal types: this is a security
 * boundary. Both halves of the protocol must agree, and importing
 * server-side helpers into the browser would pull node-only deps. Keep the
 * two copies tiny and add a CI test if they ever drift.
 */

import type { Address, Hex } from "viem";
import { ARC_CHAIN_ID } from "../arc";
import type { EthereumProvider } from "../onchain";

export const EXCHANGE_DOMAIN_NAME = "Disburse Markets";
export const EXCHANGE_DOMAIN_VERSION = "1";

/** 1e6-scale base for price and size in this module. */
export const PRICE_SCALE = 1_000_000n;

export const ORDER_EIP712_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "market", type: "address" },
    { name: "outcome", type: "uint8" },
    { name: "side", type: "uint8" },
    { name: "price", type: "uint256" },
    { name: "size", type: "uint256" },
    { name: "expiry", type: "uint64" },
    { name: "salt", type: "uint256" }
  ]
} as const;

export type ClientOrder = {
  maker: Address;
  market: Address;
  outcome: 0 | 1; // 0 = NO, 1 = YES
  side: 0 | 1; // 0 = BUY, 1 = SELL
  price: bigint; // 1e6 scale
  size: bigint; // 1e6 scale
  expiry: bigint; // unix seconds
  salt: bigint; // uint256 nonce
};

/**
 * Sign an Order with the connected wallet via `eth_signTypedData_v4`.
 *
 * Risk #1 from the plan: not every Dynamic SDK wallet connector
 * (in-app vs WalletConnect vs MetaMask vs Coinbase) forwards
 * `eth_signTypedData_v4`. If the wallet doesn't support it, this throws and
 * the caller renders a "use external wallet" hint.
 *
 * The 1193 RPC convention requires the typed-data payload to be a JSON string
 * in `params[1]` — bigints in `message` are serialized as decimal strings.
 */
export async function signOrder(
  provider: EthereumProvider,
  order: ClientOrder,
  exchangeAddress: Address
): Promise<Hex> {
  const typedData = {
    domain: {
      name: EXCHANGE_DOMAIN_NAME,
      version: EXCHANGE_DOMAIN_VERSION,
      chainId: ARC_CHAIN_ID,
      verifyingContract: exchangeAddress
    },
    // EIP712Domain is part of the on-the-wire envelope even though viem's
    // hashTypedData infers it. MetaMask and other wallets require it
    // explicitly.
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      Order: ORDER_EIP712_TYPES.Order
    },
    primaryType: "Order",
    message: {
      maker: order.maker,
      market: order.market,
      outcome: order.outcome,
      side: order.side,
      // Wallets serialize uint256 fields as numeric strings by convention.
      price: order.price.toString(),
      size: order.size.toString(),
      expiry: order.expiry.toString(),
      salt: order.salt.toString()
    }
  };

  const signature = (await provider.request({
    method: "eth_signTypedData_v4",
    params: [order.maker, JSON.stringify(typedData)]
  })) as unknown;

  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error("Wallet did not return a 65-byte signature");
  }
  return signature as Hex;
}

/** Generate a fresh uint256 nonce. */
export function randomSalt(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}
