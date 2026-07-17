import { getAddress, pad, parseAbi, type Address, type Hex } from "viem";

/**
 * Circle Gateway on Arc — constants and wire types.
 *
 * Gateway is permissionless (no API key) and non-custodial. A Disburse
 * balance IS a Gateway unified USDC balance; deposit/transfer/withdraw all
 * go through the contracts and API below. Values were proven end-to-end on
 * Arc testnet by scripts/gateway-spike.mjs (Phase 0).
 */

export const GATEWAY_API_URL = "https://gateway-api-testnet.circle.com/v1";

/** Circle Gateway domain id for Arc (from GET /v1/info). */
export const ARC_GATEWAY_DOMAIN = 26;

export const GATEWAY_WALLET_ADDRESS: Address = getAddress("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
export const GATEWAY_MINTER_ADDRESS: Address = getAddress("0x0022222ABE238Cc2C7Bb1f21003F0a260052475B");

/**
 * Default cap on Gateway's transfer fee, in USDC base units (6 decimals).
 * Gateway charges a real fee even for same-domain transfers (~0.0035 USDC
 * observed on a 0.5 USDC transfer in the Phase 0 spike). The API rejects the
 * transfer if the actual fee would exceed this cap.
 */
export const DEFAULT_MAX_FEE = 100_000n; // 0.1 USDC

/**
 * Buffer added to burnIntentExpirationHeight from /v1/info. Arc mints
 * sub-second blocks, so the reported height goes stale in ~1s and the API
 * rejects it as "maxBlockHeight is too low". The check is a minimum, not an
 * exact match, so a generous buffer is safe.
 */
export const BURN_INTENT_HEIGHT_BUFFER = 10_000n;

export const gatewayWalletAbi = parseAbi(["function deposit(address token, uint256 value)"]);
export const gatewayMinterAbi = parseAbi(["function gatewayMint(bytes attestationPayload, bytes signature)"]);

/**
 * EIP-712 domain for burn intents. Circle deliberately defines it with no
 * chainId and no verifyingContract — chain binding lives in
 * spec.sourceDomain. Do NOT "fix" this to match Disburse's own EIP-712
 * conventions; signatures would stop verifying.
 */
export const BURN_INTENT_DOMAIN = { name: "GatewayWallet", version: "1" } as const;

export const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" }
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" }
  ]
} as const;

export type TransferSpec = {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: Hex;
  destinationContract: Hex;
  sourceToken: Hex;
  destinationToken: Hex;
  sourceDepositor: Hex;
  destinationRecipient: Hex;
  sourceSigner: Hex;
  destinationCaller: Hex;
  value: bigint;
  salt: Hex;
  hookData: Hex;
};

export type BurnIntent = {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: TransferSpec;
};

export type GatewayAttestation = {
  attestation: Hex;
  signature: Hex;
};

/** Left-pad an address to the bytes32 form Gateway's TransferSpec uses. */
export function addressToBytes32(address: Address): Hex {
  return pad(getAddress(address), { size: 32 });
}

/** JSON.stringify that renders bigints as decimal strings (Gateway's format). */
export function stringifyWithBigints(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}
