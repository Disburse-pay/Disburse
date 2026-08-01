import { TransferSpeed, resolveChainIdentifier, type BridgeConfig } from "@circle-fin/bridge-kit";
import { getAddress, type Address } from "viem";

export const EXECUTABLE_BRIDGE_SOURCE_KEYS = [
  "Ethereum_Sepolia",
  "Arbitrum_Sepolia",
  "Avalanche_Fuji",
  "Base_Sepolia",
  "Codex_Testnet",
  "Edge_Testnet",
  "HyperEVM_Testnet",
  "Injective_Testnet",
  "Ink_Testnet",
  "Linea_Sepolia",
  "Monad_Testnet",
  "Morph_Testnet",
  "Optimism_Sepolia",
  "Pharos_Testnet",
  "Plume_Testnet",
  "Polygon_Amoy_Testnet",
  "Sei_Testnet",
  "Solana_Devnet",
  "Sonic_Testnet",
  "Unichain_Sepolia",
  "World_Chain_Sepolia",
  "XDC_Apothem"
] as const;

export type BridgeSourceKey = (typeof EXECUTABLE_BRIDGE_SOURCE_KEYS)[number];
export type BridgeChainKey = BridgeSourceKey | "Arc_Testnet";
export type BridgeWalletFamily = "evm" | "solana";

export type BridgeRoute = {
  source: BridgeSourceKey;
  destination: "Arc_Testnet";
};

export type BridgeChainMetadata = {
  chainId?: number;
  domain: number;
  label: string;
  shortLabel: string;
  mark: string;
  explorerUrl: string;
  gasToken: string;
  walletFamily: BridgeWalletFamily;
  standardFinality: string;
  longWait: boolean;
};

type ChainDisplayMetadata = Omit<BridgeChainMetadata, "chainId" | "domain" | "explorerUrl" | "walletFamily">;

const CHAIN_DISPLAY: Record<BridgeChainKey, ChainDisplayMetadata> = {
  Ethereum_Sepolia: chainDisplay("Ethereum Sepolia", "Ethereum", "ETH", "15–19 min", true, "ETH"),
  Arbitrum_Sepolia: chainDisplay("Arbitrum Sepolia", "Arbitrum", "ARB", "15–19 min", true, "ETH"),
  Avalanche_Fuji: chainDisplay("Avalanche Fuji", "Avalanche", "AVAX", "~8 sec", false, "AVAX"),
  Base_Sepolia: chainDisplay("Base Sepolia", "Base", "BASE", "15–19 min", true, "ETH"),
  Codex_Testnet: chainDisplay("Codex Testnet", "Codex", "CX", "15–19 min", true, "ETH"),
  Edge_Testnet: chainDisplay("EDGE Testnet", "EDGE", "EDGE", "16–21 min", true, "USDT"),
  HyperEVM_Testnet: chainDisplay("HyperEVM Testnet", "HyperEVM", "HYPE", "~5 sec", false, "HYPE"),
  Injective_Testnet: chainDisplay("Injective Testnet", "Injective", "INJ", "~0.65 sec", false, "INJ"),
  Ink_Testnet: chainDisplay("Ink Sepolia", "Ink", "INK", "~30 min", true, "ETH"),
  Linea_Sepolia: chainDisplay("Linea Sepolia", "Linea", "LINEA", "6–32 hr", true, "ETH"),
  Monad_Testnet: chainDisplay("Monad Testnet", "Monad", "MON", "~5 sec", false, "MON"),
  Morph_Testnet: chainDisplay("Morph Hoodi", "Morph", "MORPH", "20–30 min", true, "ETH"),
  Optimism_Sepolia: chainDisplay("OP Sepolia", "Optimism", "OP", "15–19 min", true, "ETH"),
  Pharos_Testnet: chainDisplay("Pharos Atlantic", "Pharos", "PH", "~7 sec", false, "PHAROS"),
  Plume_Testnet: chainDisplay("Plume Testnet", "Plume", "PLUME", "15–19 min", true, "PLUME"),
  Polygon_Amoy_Testnet: chainDisplay("Polygon Amoy", "Polygon", "POL", "~8 sec", false, "POL"),
  Sei_Testnet: chainDisplay("Sei Testnet", "Sei", "SEI", "~5 sec", false, "SEI"),
  Solana_Devnet: chainDisplay("Solana Devnet", "Solana", "SOL", "~25 sec", false, "SOL"),
  Sonic_Testnet: chainDisplay("Sonic Testnet", "Sonic", "S", "~8 sec", false, "S"),
  Unichain_Sepolia: chainDisplay("Unichain Sepolia", "Unichain", "UNI", "15–19 min", true, "UNI"),
  World_Chain_Sepolia: chainDisplay("World Chain Sepolia", "World Chain", "WORLD", "15–19 min", true, "ETH"),
  XDC_Apothem: chainDisplay("XDC Apothem", "XDC", "XDC", "~10 sec", false, "TXDC"),
  Arc_Testnet: chainDisplay("Arc Testnet", "Arc", "ARC", "~0.5 sec", false, "USDC")
};

export const BRIDGE_CHAINS = Object.fromEntries(
  (Object.keys(CHAIN_DISPLAY) as BridgeChainKey[]).map((key) => {
    const definition = resolveChainIdentifier(key);
    const cctp = definition.cctp;
    if (!cctp || !("v2" in cctp.contracts)) {
      throw new Error(`Circle Bridge Kit does not expose CCTP V2 for ${key}.`);
    }
    return [
      key,
      {
        ...CHAIN_DISPLAY[key],
        chainId: definition.type === "evm" ? definition.chainId : undefined,
        domain: cctp.domain,
        explorerUrl: definition.explorerUrl,
        walletFamily: definition.type === "solana" ? "solana" : "evm"
      }
    ];
  })
) as Record<BridgeChainKey, BridgeChainMetadata>;

export const UNAVAILABLE_BRIDGE_SOURCES = [
  {
    key: "Cronos_Testnet",
    label: "Cronos Testnet",
    detail: "CCTP V2 · Bridge Kit route not available",
    standardFinality: "~0.5 sec"
  },
  {
    key: "Starknet_Sepolia",
    label: "Starknet Sepolia",
    detail: "CCTP V2 · browser adapter not available",
    standardFinality: "4–8 hr"
  },
  {
    key: "Stellar_Testnet",
    label: "Stellar Testnet",
    detail: "CCTP V2 · browser adapter not available",
    standardFinality: "~5 sec"
  },
  {
    key: "Sui_Testnet",
    label: "Sui Testnet",
    detail: "CCTP V1 only",
    standardFinality: "Unavailable in V2"
  }
] as const;

export const INITIAL_BRIDGE_ROUTE: BridgeRoute = {
  source: "Ethereum_Sepolia",
  destination: "Arc_Testnet"
};

export const TESTNET_BRIDGE_CONFIG: Readonly<BridgeConfig> = {
  transferSpeed: TransferSpeed.SLOW,
  maxFee: "0"
};

export const TESTNET_PLATFORM_FEE_USDC = "0";

export function isBridgeSourceKey(value: string): value is BridgeSourceKey {
  return (EXECUTABLE_BRIDGE_SOURCE_KEYS as readonly string[]).includes(value);
}

export function isSupportedBridgeRoute(route: BridgeRoute): boolean {
  return isBridgeSourceKey(route.source) && route.destination === "Arc_Testnet";
}

export function formatBridgeExplorerUrl(chain: BridgeChainKey, transactionId: string): string {
  return BRIDGE_CHAINS[chain].explorerUrl.replace("{hash}", encodeURIComponent(transactionId));
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

function chainDisplay(
  label: string,
  shortLabel: string,
  mark: string,
  standardFinality: string,
  longWait: boolean,
  gasToken: string
): ChainDisplayMetadata {
  return { label, shortLabel, mark, standardFinality, longWait, gasToken };
}
