/**
 * Legacy cross-chain metadata. The Polymer settlement stack is retired; new
 * payments settle on Arc only. This module keeps the chain labels, explorer
 * links, and event shapes needed to display and verify records created while
 * remote-source QR payments were live (stored requests, receipts, PSPs).
 */
import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
  parseAbiItem,
  stringToHex,
  type Hash,
  type Hex
} from "viem";
import { ARC_CHAIN_ID, ARC_EXPLORER_URL, ARC_RPC_URL, arcTestnet } from "./arc.js";

export const BASE_SEPOLIA_CHAIN_ID = 84_532;
export const MONAD_TESTNET_CHAIN_ID = 10_143;
export const ARC_DESTINATION_CHAIN_ID = ARC_CHAIN_ID;
export const REMOTE_PAYMENT_SOURCE_CHAIN_IDS = [BASE_SEPOLIA_CHAIN_ID, MONAD_TESTNET_CHAIN_ID] as const;
export const PAYMENT_SOURCE_CHAIN_IDS = [ARC_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, MONAD_TESTNET_CHAIN_ID] as const;

export type PaymentSourceChainId = (typeof PAYMENT_SOURCE_CHAIN_IDS)[number];
export type RemotePaymentSourceChainId = (typeof REMOTE_PAYMENT_SOURCE_CHAIN_IDS)[number];
export type CrossChainPaymentStage = "submitted" | "proving" | "settling" | "settled" | "failed";

export type CrossChainPaymentState = {
  sourceChainId?: PaymentSourceChainId;
  destinationChainId: typeof ARC_DESTINATION_CHAIN_ID;
  sourceTxHash?: Hash;
  sourceBlockNumber?: string;
  sourceLogIndex?: number;
  proofJobId?: string;
  destinationTxHash?: Hash;
  destinationBlockNumber?: string;
  stage?: CrossChainPaymentStage;
  failureReason?: string;
};

export const baseSepolia = defineChain({
  id: BASE_SEPOLIA_CHAIN_ID,
  name: "Base Sepolia",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ["https://sepolia.base.org"]
    }
  },
  blockExplorers: {
    default: {
      name: "Base Sepolia Explorer",
      url: "https://sepolia-explorer.base.org"
    }
  },
  testnet: true
});

export const monadTestnet = defineChain({
  id: MONAD_TESTNET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: {
    name: "Monad",
    symbol: "MON",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ["https://testnet-rpc.monad.xyz"]
    }
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url: "https://testnet.monadscan.com"
    }
  },
  testnet: true
});

export const CROSSCHAIN_CHAINS = {
  [ARC_CHAIN_ID]: {
    id: ARC_CHAIN_ID,
    key: "arc-testnet",
    label: "Arc Testnet",
    chain: arcTestnet,
    rpcUrl: ARC_RPC_URL,
    explorerUrl: ARC_EXPLORER_URL,
    nativeSymbol: "USDC"
  },
  [BASE_SEPOLIA_CHAIN_ID]: {
    id: BASE_SEPOLIA_CHAIN_ID,
    key: "base-sepolia",
    label: "Base Sepolia",
    chain: baseSepolia,
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia-explorer.base.org",
    nativeSymbol: "ETH"
  },
  [MONAD_TESTNET_CHAIN_ID]: {
    id: MONAD_TESTNET_CHAIN_ID,
    key: "monad-testnet",
    label: "Monad Testnet",
    chain: monadTestnet,
    rpcUrl: "https://testnet-rpc.monad.xyz",
    explorerUrl: "https://testnet.monadscan.com",
    nativeSymbol: "MON"
  }
} as const;

export const qrPaymentInitiatedEvent = parseAbiItem(
  "event QrPaymentInitiated(bytes32 indexed requestId,address indexed payer,address indexed recipient,address token,uint256 amount,uint256 destinationChainId,uint256 nonce)"
);

export function isPaymentSourceChainId(value: unknown): value is PaymentSourceChainId {
  return value === ARC_CHAIN_ID || value === BASE_SEPOLIA_CHAIN_ID || value === MONAD_TESTNET_CHAIN_ID;
}

export function isRemotePaymentSourceChainId(value: unknown): value is RemotePaymentSourceChainId {
  return value === BASE_SEPOLIA_CHAIN_ID || value === MONAD_TESTNET_CHAIN_ID;
}

export function getCrossChainLabel(chainId: PaymentSourceChainId | undefined): string {
  return chainId ? CROSSCHAIN_CHAINS[chainId]?.label ?? `Chain ${chainId}` : "Unknown chain";
}

export function getCrossChainExplorerTxUrl(chainId: PaymentSourceChainId, txHash: Hash): string {
  return `${CROSSCHAIN_CHAINS[chainId].explorerUrl}/tx/${txHash}`;
}

export function requestIdToBytes32(id: string): Hex {
  return keccak256(stringToHex(id));
}

/** Read-only client for a legacy source chain (PSP verification of old receipts). */
export function createCrossChainPublicClient(chainId: PaymentSourceChainId) {
  const config = CROSSCHAIN_CHAINS[chainId];
  return createPublicClient({ chain: config.chain, transport: http(config.rpcUrl, { timeout: 20_000 }) });
}
