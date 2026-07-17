import { createPublicClient, defineChain, fallback, http, parseAbi, parseAbiItem, parseGwei, type Address } from "viem";

export const ARC_CHAIN_ID = 5_042_002;
export const ARC_RPC_ENDPOINTS = [
  {
    id: "public",
    label: "Arc public",
    url: "https://rpc.testnet.arc.network",
    webSocketUrl: "wss://rpc.testnet.arc.network"
  },
  {
    id: "blockdaemon",
    label: "Blockdaemon",
    url: "https://rpc.blockdaemon.testnet.arc.network"
  },
  {
    id: "drpc",
    label: "dRPC",
    url: "https://rpc.drpc.testnet.arc.network",
    webSocketUrl: "wss://rpc.drpc.testnet.arc.network"
  },
  {
    id: "quicknode",
    label: "QuickNode",
    url: "https://rpc.quicknode.testnet.arc.network",
    webSocketUrl: "wss://rpc.quicknode.testnet.arc.network"
  }
] as const;
export const ARC_RPC_URL = ARC_RPC_ENDPOINTS[0].url;
export const ARC_EXPLORER_URL = "https://testnet.arcscan.app";
export const ARC_FAUCET_URL = "https://faucet.circle.com";
export const ARC_DOCS_URL = "https://docs.arc.network/arc/references/connect-to-arc";
export const ARC_MIN_GAS_PRICE_GWEI = "20";
export const ARC_MIN_GAS_PRICE = parseGwei(ARC_MIN_GAS_PRICE_GWEI);

export type ArcRpcEndpoint = (typeof ARC_RPC_ENDPOINTS)[number];

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ARC_RPC_ENDPOINTS.map((endpoint) => endpoint.url),
      webSocket: ARC_RPC_ENDPOINTS.flatMap((endpoint) => ("webSocketUrl" in endpoint ? [endpoint.webSocketUrl] : []))
    }
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: ARC_EXPLORER_URL
    }
  },
  testnet: true
});

export const TOKENS = {
  USDC: {
    symbol: "USDC",
    label: "USD Coin",
    address: "0x3600000000000000000000000000000000000000" as Address,
    decimals: 6
  },
  EURC: {
    symbol: "EURC",
    label: "Euro Coin",
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address,
    decimals: 6
  }
} as const;

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

export const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(
    ARC_RPC_ENDPOINTS.map((endpoint) =>
      http(endpoint.url, {
        timeout: 8_000
      })
    ),
    {
      retryCount: 2
    }
  )
});
