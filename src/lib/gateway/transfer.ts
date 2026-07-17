import { encodeFunctionData, getAddress, numberToHex, type Address, type Hash, type Hex } from "viem";
import {
  readPendingNonce,
  requestWalletTransaction,
  waitForTransactionConfirmation,
  type EthereumProvider,
  type WalletTransferTransaction
} from "../onchain.js";
import { TOKENS } from "../arc.js";
import {
  ARC_GATEWAY_DOMAIN,
  BURN_INTENT_DOMAIN,
  BURN_INTENT_HEIGHT_BUFFER,
  BURN_INTENT_TYPES,
  DEFAULT_MAX_FEE,
  GATEWAY_API_URL,
  GATEWAY_MINTER_ADDRESS,
  GATEWAY_WALLET_ADDRESS,
  addressToBytes32,
  gatewayMinterAbi,
  stringifyWithBigints,
  type BurnIntent,
  type GatewayAttestation
} from "./types.js";

/**
 * Gateway transfer on Arc: sign a burn intent (EIP-712), POST it to
 * /v1/transfer for an attestation, then mint to the recipient via
 * GatewayMinter. Same-domain Arc→Arc; the attestation typically arrives in
 * well under a second. A transfer to your own address is the instant
 * withdraw path.
 */

export type GatewayTransferParams = {
  /** Recipient of the minted USDC on Arc. */
  recipient: Address;
  /** USDC base units (6 decimals). */
  amount: bigint;
  /** Cap on Gateway's fee, USDC base units. The API rejects the transfer if the fee would exceed it. */
  maxFee?: bigint;
};

export type GatewayTransferResult = {
  mintHash: Hash;
  burnIntent: BurnIntent;
};

export async function transferViaGateway(
  provider: EthereumProvider,
  account: Address,
  params: GatewayTransferParams
): Promise<GatewayTransferResult> {
  if (params.amount <= 0n) {
    throw new Error("Transfer amount must be greater than zero.");
  }

  const burnIntent = await buildBurnIntent(account, params);
  const signature = await signBurnIntent(provider, account, burnIntent);
  const attestation = await requestAttestation(burnIntent, signature);
  const mintHash = await mintOnArc(provider, account, attestation);

  return { mintHash, burnIntent };
}

/**
 * Build a same-domain (Arc→Arc) burn intent. maxBlockHeight comes from
 * /v1/info plus a buffer: Arc's sub-second blocks make the reported height
 * stale in about a second, and the API's check is a minimum.
 */
export async function buildBurnIntent(
  account: Address,
  params: GatewayTransferParams
): Promise<BurnIntent> {
  const response = await fetch(`${GATEWAY_API_URL}/info`);
  if (!response.ok) {
    throw new Error(`Gateway info lookup failed (${response.status}).`);
  }
  const info = (await response.json()) as {
    domains?: Array<{ domain?: number; burnIntentExpirationHeight?: string | number }>;
  };
  const arcInfo = info.domains?.find((d) => d.domain === ARC_GATEWAY_DOMAIN);
  if (arcInfo?.burnIntentExpirationHeight === undefined) {
    throw new Error("Gateway did not report an expiration height for Arc.");
  }

  const owner = addressToBytes32(getAddress(account));
  return {
    maxBlockHeight: BigInt(arcInfo.burnIntentExpirationHeight) + BURN_INTENT_HEIGHT_BUFFER,
    maxFee: params.maxFee ?? DEFAULT_MAX_FEE,
    spec: {
      version: 1,
      sourceDomain: ARC_GATEWAY_DOMAIN,
      destinationDomain: ARC_GATEWAY_DOMAIN,
      sourceContract: addressToBytes32(GATEWAY_WALLET_ADDRESS),
      destinationContract: addressToBytes32(GATEWAY_MINTER_ADDRESS),
      sourceToken: addressToBytes32(TOKENS.USDC.address),
      destinationToken: addressToBytes32(TOKENS.USDC.address),
      sourceDepositor: owner,
      destinationRecipient: addressToBytes32(getAddress(params.recipient)),
      sourceSigner: owner,
      destinationCaller: addressToBytes32("0x0000000000000000000000000000000000000000"),
      value: params.amount,
      salt: randomSalt(),
      hookData: "0x"
    }
  };
}

/**
 * Sign the burn intent with the wallet. The EIP-712 domain is Circle's:
 * { name: "GatewayWallet", version: "1" } with no chainId — chain binding
 * lives in spec.sourceDomain. eth_signTypedData_v4 wants every uint as a
 * string, hence the stringified message.
 */
export async function signBurnIntent(
  provider: EthereumProvider,
  account: Address,
  burnIntent: BurnIntent
): Promise<Hex> {
  const typedData = stringifyWithBigints({
    domain: BURN_INTENT_DOMAIN,
    types: {
      ...BURN_INTENT_TYPES,
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" }
      ]
    },
    primaryType: "BurnIntent",
    message: burnIntent
  });

  const signature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [getAddress(account), typedData]
  });

  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error("Wallet did not return a valid burn intent signature.");
  }
  return signature as Hex;
}

/** POST the signed burn intent set (array, ≤16 entries; 201 on success). */
export async function requestAttestation(
  burnIntent: BurnIntent,
  signature: Hex
): Promise<GatewayAttestation> {
  const response = await fetch(`${GATEWAY_API_URL}/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stringifyWithBigints([{ burnIntent, signature }])
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gateway transfer was rejected (${response.status}): ${text.slice(0, 300)}`);
  }

  const out = JSON.parse(text) as {
    attestation?: Hex;
    signature?: Hex;
    transfer?: { attestation?: Hex; signature?: Hex };
  };
  const attestation = out.attestation ?? out.transfer?.attestation;
  const operatorSignature = out.signature ?? out.transfer?.signature;
  if (!attestation || !operatorSignature) {
    throw new Error("Gateway response is missing the attestation.");
  }
  return { attestation, signature: operatorSignature };
}

/** Redeem the attestation on Arc: GatewayMinter.gatewayMint mints to the recipient. */
export async function mintOnArc(
  provider: EthereumProvider,
  account: Address,
  attestation: GatewayAttestation
): Promise<Hash> {
  const owner = getAddress(account);
  const transaction: WalletTransferTransaction = {
    from: owner,
    to: GATEWAY_MINTER_ADDRESS,
    data: encodeFunctionData({
      abi: gatewayMinterAbi,
      functionName: "gatewayMint",
      args: [attestation.attestation, attestation.signature]
    }),
    value: "0x0",
    nonce: numberToHex(await readPendingNonce(owner))
  };

  const hash = await requestWalletTransaction(provider, transaction);
  await waitForTransactionConfirmation(hash);
  return hash;
}

function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
