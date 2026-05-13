import { getAddress, isAddress, type Address } from "viem";
import {
  BASE_SEPOLIA_CHAIN_ID,
  MONAD_TESTNET_CHAIN_ID,
  type RemotePaymentSourceChainId,
  type CrossChainRouteConfig
} from "./crosschain.js";

type ViteEnv = Record<string, string | boolean | undefined>;

const env = (import.meta as any).env as ViteEnv;

export function getCrossChainBrowserRoute(chainId: RemotePaymentSourceChainId): CrossChainRouteConfig {
  const prefix =
    chainId === BASE_SEPOLIA_CHAIN_ID ? "BASE_SEPOLIA" : chainId === MONAD_TESTNET_CHAIN_ID ? "MONAD" : undefined;
  if (!prefix) {
    throw new Error(`Unsupported cross-chain source route ${chainId}.`);
  }
  return {
    chainId,
    sourceContract: readAddress(`VITE_${prefix}_QR_PAYMENT_SOURCE`),
    tokenAddress: readAddress(`VITE_${prefix}_USDC_ADDRESS`)
  };
}

export function requireCrossChainBrowserRoute(chainId: RemotePaymentSourceChainId) {
  const route = getCrossChainBrowserRoute(chainId);
  const missing: string[] = [];
  if (!route.tokenAddress) {
    missing.push("USDC token address");
  }
  if (!route.sourceContract) {
    missing.push("source contract");
  }

  if (missing.length) {
    throw new Error(`Cross-chain source route for chain ${chainId} is missing ${missing.join(", ")}.`);
  }

  return route as CrossChainRouteConfig & {
    tokenAddress: Address;
    sourceContract: Address;
  };
}

function readAddress(key: string): Address | undefined {
  const value = env[key];
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  if (!isAddress(value)) {
    throw new Error(`${key} must be a valid 0x address.`);
  }
  return getAddress(value);
}
