import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
  DynamicContextProvider,
  mergeNetworks,
  useDynamicContext,
  useSwitchNetwork,
  type EvmNetwork,
  type Wallet
} from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors, isEthereumWallet } from "@dynamic-labs/ethereum";
import { getAddress, numberToHex, type Address } from "viem";
import { ARC_CHAIN_ID } from "./arc";
import { CROSSCHAIN_CHAINS, PAYMENT_SOURCE_CHAIN_IDS } from "./crosschain";
import type { EthereumProvider } from "./onchain";

type DynamicWalletBridgeContextValue = {
  enabled: boolean;
  hasWallet: boolean;
  sdkHasLoaded: boolean;
  primaryWallet: Wallet | null;
  openAuthFlow: () => void;
  getEthereumProvider: () => Promise<EthereumProvider | undefined>;
  getAccount: () => Address | undefined;
  getChainId: () => Promise<number | undefined>;
};

type ProviderRequest = {
  method: string;
  params?: unknown;
};

type WalletClientWithRequest = {
  getChainId?: () => Promise<number>;
  request: (request: ProviderRequest) => Promise<unknown>;
};

export const DYNAMIC_ENVIRONMENT_ID = import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID?.trim() ?? "";

export const dynamicPaymentNetworks: EvmNetwork[] = PAYMENT_SOURCE_CHAIN_IDS.map((chainId) => {
  const config = CROSSCHAIN_CHAINS[chainId];
  return {
    blockExplorerUrls: [config.explorerUrl],
    chainId,
    iconUrls: ["/favicon.png"],
    name: config.label,
    nativeCurrency: config.chain.nativeCurrency,
    networkId: chainId,
    privateCustomerRpcUrls: [config.rpcUrl],
    rpcUrls: [config.rpcUrl],
    vanityName: config.label
  };
});

const disabledDynamicWalletBridge: DynamicWalletBridgeContextValue = {
  enabled: false,
  hasWallet: false,
  sdkHasLoaded: false,
  primaryWallet: null,
  openAuthFlow: () => undefined,
  getEthereumProvider: async () => undefined,
  getAccount: () => undefined,
  getChainId: async () => undefined
};

const DynamicWalletBridgeContext = createContext<DynamicWalletBridgeContextValue>(disabledDynamicWalletBridge);

export function DisburseDynamicProvider({ children }: { children: ReactNode }) {
  if (!DYNAMIC_ENVIRONMENT_ID) {
    return (
      <DynamicWalletBridgeContext.Provider value={disabledDynamicWalletBridge}>
        {children}
      </DynamicWalletBridgeContext.Provider>
    );
  }

  return (
    <DynamicContextProvider
      settings={{
        appName: "Disburse",
        enableConnectOnlyFallback: true,
        environmentId: DYNAMIC_ENVIRONMENT_ID,
        networkValidationMode: "never",
        overrides: {
          evmNetworks: (dashboardNetworks) => mergeNetworks(dynamicPaymentNetworks, dashboardNetworks)
        },
        useMetamaskSdk: false,
        walletConnectors: [EthereumWalletConnectors],
        walletConnectPreferredChains: [`eip155:${ARC_CHAIN_ID}`]
      }}
    >
      <DynamicWalletBridge>{children}</DynamicWalletBridge>
    </DynamicContextProvider>
  );
}

export function useDisburseDynamicWallet() {
  return useContext(DynamicWalletBridgeContext);
}

function DynamicWalletBridge({ children }: { children: ReactNode }) {
  const { primaryWallet, sdkHasLoaded, setShowAuthFlow } = useDynamicContext();
  const switchNetwork = useSwitchNetwork();
  const value = useMemo<DynamicWalletBridgeContextValue>(
    () => ({
      enabled: true,
      hasWallet: Boolean(primaryWallet),
      sdkHasLoaded,
      primaryWallet,
      openAuthFlow: () => setShowAuthFlow(true),
      getEthereumProvider: async () => {
        if (!primaryWallet) {
          return undefined;
        }
        return createDynamicEthereumProvider(primaryWallet, (network) =>
          switchNetwork({ wallet: primaryWallet, network })
        );
      },
      getAccount: () => {
        if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
          return undefined;
        }
        return getAddress(primaryWallet.address);
      },
      getChainId: async () => {
        if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
          return undefined;
        }
        return readDynamicWalletChainId(primaryWallet);
      }
    }),
    [primaryWallet, sdkHasLoaded, setShowAuthFlow, switchNetwork]
  );

  return (
    <DynamicWalletBridgeContext.Provider value={value}>
      {children}
    </DynamicWalletBridgeContext.Provider>
  );
}

export async function createDynamicEthereumProvider(
  wallet: Wallet,
  switchNetwork: (network: number | string) => Promise<void> = (network) => wallet.switchNetwork(network)
): Promise<EthereumProvider> {
  if (!isEthereumWallet(wallet)) {
    throw new Error("Dynamic connected wallet is not an EVM wallet.");
  }

  const walletClient = (await wallet.getWalletClient()) as WalletClientWithRequest;
  return {
    request: async ({ method, params }: ProviderRequest) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        return [getAddress(wallet.address)];
      }

      if (method === "eth_chainId") {
        const chainId = await readDynamicWalletChainId(wallet, walletClient);
        if (!chainId) {
          throw new Error("Dynamic wallet did not report a chain id.");
        }
        return numberToHex(chainId);
      }

      if (method === "wallet_switchEthereumChain") {
        await switchNetwork(readChainIdFromWalletParams(params));
        return null;
      }

      if (method === "wallet_addEthereumChain") {
        await switchNetwork(readChainIdFromWalletParams(params));
        return null;
      }

      return walletClient.request({ method, params });
    }
  } as EthereumProvider;
}

async function readDynamicWalletChainId(wallet: Wallet, walletClient?: WalletClientWithRequest): Promise<number | undefined> {
  const walletNetwork = parseChainId(await wallet.getNetwork().catch(() => undefined));
  if (walletNetwork) {
    return walletNetwork;
  }

  return walletClient?.getChainId?.();
}

function parseChainId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const trimmed = value.trim();
  const parsed = trimmed.startsWith("0x")
    ? Number.parseInt(trimmed, 16)
    : Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readChainIdFromWalletParams(params: unknown): number {
  const [first] = Array.isArray(params) ? params : [];
  const chainId = parseChainId(first && typeof first === "object" && "chainId" in first ? first.chainId : undefined);
  if (!chainId) {
    throw new Error("Wallet network request is missing chainId.");
  }
  return chainId;
}
