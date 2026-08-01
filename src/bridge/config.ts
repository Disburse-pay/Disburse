import { TransferSpeed, type BridgeConfig } from "@circle-fin/bridge-kit";
import { getAddress, type Address } from "viem";

export type BridgeChainId = 11_155_111 | 5_042_002;
export type BridgeChainKey = "Ethereum_Sepolia" | "Arc_Testnet";

export type BridgeRoute = {
  source: BridgeChainKey;
  destination: BridgeChainKey;
};

export const BRIDGE_CHAINS: Record<BridgeChainKey, {
  chainId: BridgeChainId;
  label: string;
  shortLabel: string;
  explorerUrl: string;
  gasToken: string;
}> = {
  Ethereum_Sepolia: {
    chainId: 11_155_111,
    label: "Ethereum Sepolia",
    shortLabel: "Ethereum",
    explorerUrl: "https://sepolia.etherscan.io",
    gasToken: "ETH"
  },
  Arc_Testnet: {
    chainId: 5_042_002,
    label: "Arc Testnet",
    shortLabel: "Arc",
    explorerUrl: "https://testnet.arcscan.app",
    gasToken: "USDC"
  }
};

export const INITIAL_BRIDGE_ROUTE: BridgeRoute = {
  source: "Ethereum_Sepolia",
  destination: "Arc_Testnet"
};

export const TESTNET_BRIDGE_CONFIG: Readonly<BridgeConfig> = {
  transferSpeed: TransferSpeed.SLOW,
  maxFee: "0"
};

export const TESTNET_PLATFORM_FEE_USDC = "0";

export function reverseBridgeRoute(route: BridgeRoute): BridgeRoute {
  return { source: route.destination, destination: route.source };
}

export function isSupportedBridgeRoute(route: BridgeRoute): boolean {
  return route.source !== route.destination
    && ((route.source === "Ethereum_Sepolia" && route.destination === "Arc_Testnet")
      || (route.source === "Arc_Testnet" && route.destination === "Ethereum_Sepolia"));
}

export function normalizeBridgeAmount(value: string): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new Error("Enter a base-10 USDC amount with up to 6 decimals.");
  }
  const [whole, fraction = ""] = value.split(".");
  if (BigInt(whole) === 0n && !/[1-9]/.test(fraction)) {
    throw new Error("Amount must be greater than zero.");
  }
  return fraction ? `${BigInt(whole)}.${fraction}` : BigInt(whole).toString();
}

export function normalizeBridgeRecipient(value: string): Address {
  return getAddress(value);
}
