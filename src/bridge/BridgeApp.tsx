import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BridgeKit,
  resolveChainIdentifier,
  type BridgeResult,
  type EstimateResult
} from "@circle-fin/bridge-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import {
  ArrowDown,
  ArrowUpRight,
  ChevronDown,
  CircleAlert,
  LockKeyhole,
  Wallet
} from "lucide-react";
import { getAddress, type Address } from "viem";
import { useDisburseDynamicWallet } from "../lib/dynamic";
import { getInjectedProvider, type EthereumProvider } from "../lib/onchain";
import { assertProviderAccount } from "../lib/providerAccount";
import { getAppHref, getDocsHref } from "../lib/routing";
import {
  BRIDGE_CHAINS,
  EXECUTABLE_BRIDGE_SOURCE_KEYS,
  INITIAL_BRIDGE_ROUTE,
  TESTNET_BRIDGE_CONFIG,
  TESTNET_PLATFORM_FEE_USDC,
  UNAVAILABLE_BRIDGE_SOURCES,
  formatBridgeExplorerUrl,
  isBridgeSourceKey,
  isSupportedBridgeRoute,
  normalizeBridgeAmount,
  normalizeBridgeRecipient,
  type BridgeRoute,
  type BridgeSourceKey
} from "./config";
import {
  buildBridgeLocationSearch,
  isBridgeTransactionId,
  parseBridgeRecovery,
  recoveryMatchesIntent,
  validateBridgeRecovery,
  type BridgeRecovery
} from "./recovery";
import "./bridge.css";

const bridgeKit = new BridgeKit();

type BridgePhase = "idle" | "estimating" | "ready" | "transferring" | "retrying";
type BridgeStep = BridgeResult["steps"][number];

type SolanaWalletProvider = {
  isConnected: boolean;
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signTransaction(transaction: unknown): Promise<unknown>;
  signAllTransactions?(transactions: unknown[]): Promise<unknown[]>;
  signMessage?(message: Uint8Array): Promise<{ signature: Uint8Array }>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

type SolanaWalletOption = {
  name: string;
  provider: SolanaWalletProvider;
};

type SolanaWalletConnection = SolanaWalletOption & {
  address: string;
};

function BridgeApp() {
  const dynamicWallet = useDisburseDynamicWallet();
  const initialRecovery = useRef(parseBridgeRecovery(window.location.search));
  const solanaWallets = useMemo(discoverSolanaWallets, []);
  const [account, setAccount] = useState<Address>();
  const [solanaWallet, setSolanaWallet] = useState<SolanaWalletConnection>();
  const [route, setRoute] = useState<BridgeRoute>(
    initialRecovery.current?.route ?? INITIAL_BRIDGE_ROUTE
  );
  const [amount, setAmount] = useState(initialRecovery.current?.amount ?? "");
  const [phase, setPhase] = useState<BridgePhase>("idle");
  const [estimate, setEstimate] = useState<EstimateResult>();
  const [estimateIntent, setEstimateIntent] = useState<string>();
  const [result, setResult] = useState<BridgeResult>();
  const [resultIntent, setResultIntent] = useState<string>();
  const [liveSteps, setLiveSteps] = useState<BridgeStep[]>(() =>
    initialRecovery.current ? recoverySteps(initialRecovery.current) : []
  );
  const [recovery, setRecovery] = useState<BridgeRecovery | undefined>(initialRecovery.current);
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  const [error, setError] = useState<string>();

  const source = BRIDGE_CHAINS[route.source];
  const destination = BRIDGE_CHAINS[route.destination];
  const solanaProvider = solanaWallet?.provider;
  const sourceAccount = source.walletFamily === "solana" ? solanaWallet?.address : account;
  const normalizedAmount = useMemo(() => {
    try {
      return normalizeBridgeAmount(amount);
    } catch {
      return undefined;
    }
  }, [amount]);
  const intent = `${sourceAccount ?? "source-disconnected"}:${account?.toLowerCase() ?? "arc-disconnected"}:${route.source}:${route.destination}:${normalizedAmount ?? "invalid"}`;
  const intentRef = useRef(intent);
  intentRef.current = intent;
  const activeOperationIntent = useRef<string | undefined>(undefined);
  const recoveryIsCurrent = Boolean(
    recovery && recoveryMatchesIntent(recovery, route, normalizedAmount)
  );

  useEffect(() => {
    document.title = "Bridge · Disburse";
  }, []);

  const getProvider = useCallback(async (): Promise<EthereumProvider | undefined> => {
    if (dynamicWallet.enabled) {
      return dynamicWallet.getEthereumProvider();
    }
    return getInjectedProvider();
  }, [dynamicWallet]);

  useEffect(() => {
    let active = true;
    if (dynamicWallet.enabled) {
      const next = dynamicWallet.getAccount();
      setAccount(next);
      return () => {
        active = false;
      };
    }

    const provider = getInjectedProvider();
    const sync = (value: unknown) => {
      const [first] = Array.isArray(value) ? value : [];
      if (active) {
        setAccount(typeof first === "string" ? getAddress(first) : undefined);
      }
    };
    void provider
      ?.request({ method: "eth_accounts" })
      .then(sync)
      .catch(() => undefined);
    provider?.on?.("accountsChanged", sync);
    return () => {
      active = false;
      provider?.removeListener?.("accountsChanged", sync);
    };
  }, [dynamicWallet]);

  useEffect(() => {
    if (!solanaProvider) return;
    const sync = (value: unknown) => {
      const next = readSolanaAddress(value) ?? readSolanaAddress(solanaProvider.publicKey);
      if (!next) {
        setSolanaWallet(undefined);
        return;
      }
      setSolanaWallet((current) => (current ? { ...current, address: next } : current));
    };
    solanaProvider.on?.("accountChanged", sync);
    solanaProvider.on?.("disconnect", sync);
    return () => {
      solanaProvider.removeListener?.("accountChanged", sync);
      solanaProvider.removeListener?.("disconnect", sync);
    };
  }, [solanaProvider]);

  useEffect(() => {
    setEstimate(undefined);
    setEstimateIntent(undefined);
    if (activeOperationIntent.current) {
      setError(
        "The wallet or transfer intent changed during an active operation. Wait for its recovery result before starting another transfer."
      );
      return;
    }
    setResult(undefined);
    setResultIntent(undefined);
    const currentRecovery = recoveryRef.current;
    if (!currentRecovery || !recoveryMatchesIntent(currentRecovery, route, normalizedAmount)) {
      setLiveSteps([]);
    }
    setError(undefined);
    setPhase("idle");
  }, [account, amount, route, normalizedAmount, solanaWallet?.address]);

  const createEvmAdapter = useCallback(
    async (expectedAccount: Address) => {
      const provider = await getProvider();
      if (!provider) {
        throw new Error("No EVM wallet provider is available.");
      }
      await assertProviderAccount(provider, expectedAccount);
      return createViemAdapterFromProvider({
        provider,
        capabilities: { addressContext: "user-controlled" }
      });
    },
    [getProvider]
  );

  const createAdapters = useCallback(
    async (sourceKey: BridgeSourceKey, expectedSource: string, expectedDestination: Address) => {
      const to = await createEvmAdapter(expectedDestination);
      if (BRIDGE_CHAINS[sourceKey].walletFamily === "evm") {
        if (expectedSource.toLowerCase() !== expectedDestination.toLowerCase()) {
          throw new Error("The source and Arc recipient EVM accounts do not match.");
        }
        return { from: to, to };
      }

      const connection = solanaWallet;
      if (!connection || connection.address !== expectedSource) {
        throw new Error("The connected Solana source account changed.");
      }
      const liveAddress = readSolanaAddress(connection.provider.publicKey);
      if (!liveAddress || liveAddress !== expectedSource) {
        throw new Error("The Solana wallet account could not be verified.");
      }
      const { createSolanaAdapterFromProvider } = await import("@circle-fin/adapter-solana");
      const from = await createSolanaAdapterFromProvider({
        provider: connection.provider,
        capabilities: {
          addressContext: "user-controlled",
          supportedChains: [resolveChainIdentifier(sourceKey)]
        }
      });
      return { from, to };
    },
    [createEvmAdapter, solanaWallet]
  );

  async function connectWallet() {
    setError(undefined);
    try {
      if (dynamicWallet.enabled) {
        dynamicWallet.openAuthFlow();
        return;
      }
      const provider = getInjectedProvider();
      if (!provider) {
        throw new Error("Install or open an EVM wallet to continue.");
      }
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const [first] = Array.isArray(accounts) ? accounts : [];
      if (typeof first !== "string") {
        throw new Error("The wallet did not return an account.");
      }
      setAccount(normalizeBridgeRecipient(first));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function connectSolanaWallet(option: SolanaWalletOption) {
    setError(undefined);
    try {
      const connected = await option.provider.connect();
      const address = readSolanaAddress(connected.publicKey);
      if (!address) {
        throw new Error("The Solana wallet did not return an account.");
      }
      setSolanaWallet({ ...option, address });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function disconnectWallet() {
    if (busy) {
      setError("Wait for the active bridge operation to finish before disconnecting.");
      return;
    }
    setEstimate(undefined);
    setEstimateIntent(undefined);
    setResult(undefined);
    setResultIntent(undefined);
    setError(undefined);
    if (dynamicWallet.enabled) {
      await dynamicWallet.disconnect().catch(() => undefined);
    }
    setAccount(undefined);
  }

  async function disconnectSolanaWallet() {
    if (!solanaWallet || busy) return;
    await solanaWallet.provider.disconnect().catch(() => undefined);
    setSolanaWallet(undefined);
  }

  function selectSource(value: string) {
    if (!isBridgeSourceKey(value) || busy) return;
    setRoute({ source: value, destination: "Arc_Testnet" });
  }

  async function estimateTransfer() {
    setError(undefined);
    if (!account || !sourceAccount || !normalizedAmount || !isSupportedBridgeRoute(route)) {
      setError("Connect the required wallets and enter a valid USDC amount.");
      return;
    }
    setPhase("estimating");
    const requestedIntent = intent;
    try {
      const adapters = await createAdapters(route.source, sourceAccount, account);
      const next = await bridgeKit.estimate({
        from: { adapter: adapters.from, chain: route.source },
        to: { adapter: adapters.to, chain: route.destination, recipientAddress: account },
        amount: normalizedAmount,
        token: "USDC",
        config: { ...TESTNET_BRIDGE_CONFIG }
      });
      if (intentRef.current !== requestedIntent) {
        setPhase("idle");
        setError("The wallet or transfer details changed. Review a fresh estimate.");
        return;
      }
      setEstimate(next);
      setEstimateIntent(requestedIntent);
      setPhase("ready");
    } catch (cause) {
      setPhase("idle");
      setError(errorMessage(cause));
    }
  }

  async function executeTransfer() {
    setError(undefined);
    if (
      !account ||
      !sourceAccount ||
      !normalizedAmount ||
      !estimate ||
      estimateIntent !== intent ||
      !isSupportedBridgeRoute(route)
    ) {
      setEstimate(undefined);
      setEstimateIntent(undefined);
      setPhase("idle");
      setError("Review a fresh estimate before bridging.");
      return;
    }
    const transferIntent = intent;
    activeOperationIntent.current = transferIntent;
    setLiveSteps([]);
    setPhase("transferring");
    const unsubscribe = subscribeToBridgeSteps((step) => {
      setLiveSteps((steps) => upsertBridgeStep(steps, step));
      if (
        step.name === "burn" &&
        step.state === "success" &&
        step.txHash &&
        isBridgeTransactionId(route.source, step.txHash)
      ) {
        const nextRecovery: BridgeRecovery = {
          amount: normalizedAmount,
          burnTxId:
            source.walletFamily === "evm" ? step.txHash.toLowerCase() : step.txHash,
          route
        };
        setRecovery(nextRecovery);
        replaceRecoveryUrl(nextRecovery);
      }
    });
    try {
      const adapters = await createAdapters(route.source, sourceAccount, account);
      const next = await bridgeKit.bridge({
        from: { adapter: adapters.from, chain: route.source },
        to: { adapter: adapters.to, chain: route.destination, recipientAddress: account },
        amount: normalizedAmount,
        token: "USDC",
        config: { ...TESTNET_BRIDGE_CONFIG }
      });
      activeOperationIntent.current = undefined;
      setResult(next);
      setResultIntent(transferIntent);
      setPhase("ready");
      if (next.state === "success") {
        setRecovery(undefined);
        clearRecoveryUrl();
      }
      if (intentRef.current !== transferIntent) {
        setError(
          "An active wallet changed. Reconnect the original wallets before recovery; do not start a second burn."
        );
      } else if (next.state !== "success") {
        setError("The transfer is incomplete. Review the completed steps before retrying.");
      }
    } catch (cause) {
      activeOperationIntent.current = undefined;
      setPhase(intentRef.current === transferIntent ? "ready" : "idle");
      setError(errorMessage(cause));
    } finally {
      unsubscribe();
    }
  }

  async function resumeRecoveredTransfer() {
    setError(undefined);
    if (
      !account ||
      !sourceAccount ||
      !normalizedAmount ||
      !recovery ||
      !recoveryMatchesIntent(recovery, route, normalizedAmount)
    ) {
      setError("Review the original amount, wallets, and route before resuming this source burn.");
      return;
    }

    const transferIntent = intent;
    const recoveredResult = buildRecoveredResult(recovery, sourceAccount, account);
    activeOperationIntent.current = transferIntent;
    setResult(recoveredResult);
    setResultIntent(transferIntent);
    setLiveSteps(recoveredResult.steps);
    setPhase("retrying");
    const unsubscribe = subscribeToBridgeSteps((step) => {
      setLiveSteps((steps) => upsertBridgeStep(steps, step));
    });
    try {
      await validateBridgeRecovery(recovery, account);
      const adapters = await createAdapters(route.source, sourceAccount, account);
      const next = await bridgeKit.retry(recoveredResult, adapters);
      activeOperationIntent.current = undefined;
      setResult(next);
      setResultIntent(transferIntent);
      setPhase("ready");
      if (next.state === "success") {
        setRecovery(undefined);
        clearRecoveryUrl();
      } else {
        setError("Recovery is incomplete. Keep the burn link and do not start another transfer.");
      }
    } catch (cause) {
      activeOperationIntent.current = undefined;
      setPhase("ready");
      setError(errorMessage(cause));
    } finally {
      unsubscribe();
    }
  }

  async function retryTransfer() {
    if (!account || !sourceAccount || !result || result.state === "success") return;
    if (!resultIntent || resultIntent !== intent) {
      setError(
        "Reconnect the original wallets and restore the original transfer details before resuming."
      );
      return;
    }
    activeOperationIntent.current = resultIntent;
    setPhase("retrying");
    setError(undefined);
    try {
      const adapters = await createAdapters(route.source, sourceAccount, account);
      const next = await bridgeKit.retry(result, adapters);
      activeOperationIntent.current = undefined;
      setResult(next);
      setPhase("ready");
      if (next.state === "success") {
        setRecovery(undefined);
        clearRecoveryUrl();
      }
      if (intentRef.current !== resultIntent) {
        setError(
          "An active wallet changed during recovery. Reconnect the original wallets before continuing."
        );
      } else if (next.state !== "success") {
        setError("Recovery is still incomplete. Do not start a new transfer with the same intent.");
      }
    } catch (cause) {
      activeOperationIntent.current = undefined;
      setPhase(intentRef.current === resultIntent ? "ready" : "idle");
      setError(errorMessage(cause));
    }
  }

  const protocolFee = estimate?.fees.find((fee) => fee.type === "provider")?.amount;
  const busy = phase === "estimating" || phase === "transferring" || phase === "retrying";
  const visibleSteps = busy ? liveSteps : result?.steps.length ? result.steps : liveSteps;
  const transferButtonLabel = getTransferButtonLabel(liveSteps, phase, normalizedAmount);
  const needsSolanaWallet = source.walletFamily === "solana" && !solanaWallet;

  return (
    <div className="bridge-surface">
      <header className="bridge-nav">
        <a className="bridge-brand" href="https://disburse.online" aria-label="Disburse home">
          <img className="bridge-brand-mark" src="/favicon.png" alt="" aria-hidden="true" />
          <span>Disburse</span>
          <span className="bridge-product-name">Bridge</span>
        </a>
        <nav aria-label="Bridge links">
          <a href={getAppHref("/")}>Payments</a>
          <a href={getDocsHref()}>Docs</a>
          {account ? (
            <button type="button" onClick={disconnectWallet} title="Disconnect Arc wallet" disabled={busy}>
              <Wallet size={13} aria-hidden="true" />
              {shortAddress(account)}
            </button>
          ) : (
            <button type="button" onClick={connectWallet}>
              Connect Arc wallet
            </button>
          )}
        </nav>
      </header>

      <main className="bridge-main">
        <section className="bridge-intro">
          <h1>Bring USDC to Arc</h1>
          <p>
            Move native testnet USDC from Circle CCTP V2 networks into Arc. Your wallets authorize
            each step; Disburse never takes custody.
          </p>
        </section>

        <section className="bridge-panel" aria-label="Bridge USDC to Arc">
          <header className="bridge-panel-head">
            <strong>USDC transfer</strong>
            <span>Testnet only</span>
          </header>
          <div className="bridge-route-card">
            <span className="bridge-field-label">From</span>
            <label className="bridge-chain bridge-chain-picker">
              <ChainMark chain={route.source} />
              <span>
                <strong>{source.shortLabel}</strong>
                <small>
                  {sourceAccount ? shortAddress(sourceAccount) : `${source.walletFamily.toUpperCase()} wallet`}
                </small>
              </span>
              <ChevronDown className="bridge-chain-chevron" size={15} aria-hidden="true" />
              <select
                value={route.source}
                onChange={(event) => selectSource(event.target.value)}
                disabled={busy}
                aria-label="Source network"
              >
                <optgroup label="CCTP V2 · ready">
                  {EXECUTABLE_BRIDGE_SOURCE_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {BRIDGE_CHAINS[key].label} — {BRIDGE_CHAINS[key].standardFinality}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Not executable in this wallet build">
                  {UNAVAILABLE_BRIDGE_SOURCES.map((network) => (
                    <option key={network.key} value={network.key} disabled>
                      {network.label} — {network.detail}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="bridge-amount">
              <span className="bridge-field-label">Amount</span>
              <span className="bridge-amount-control">
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  aria-label="USDC amount"
                  disabled={busy}
                />
                <strong>USDC</strong>
              </span>
            </label>
          </div>

          <div className="bridge-route-arrow" aria-hidden="true">
            <ArrowDown size={17} />
          </div>

          <div className="bridge-route-card bridge-route-destination">
            <span className="bridge-field-label">To</span>
            <div className="bridge-chain">
              <ChainMark chain={route.destination} />
              <span>
                <strong>{destination.shortLabel}</strong>
                <small>{destination.label}</small>
              </span>
            </div>
            <div className="bridge-recipient">
              <span className="bridge-field-label">Recipient</span>
              <span>{account ? shortAddress(account) : "Arc wallet required"}</span>
            </div>
          </div>

          <div className="bridge-quote" aria-label="Transfer estimate">
            <QuoteRow label="Route" value="Circle CCTP V2 Standard" />
            <QuoteRow label="Estimated wait" value={source.standardFinality} />
            <QuoteRow
              label="CCTP fee"
              value={estimate ? `${protocolFee ?? "0"} USDC` : "Review required"}
            />
            <QuoteRow label="Disburse fee" value={`${TESTNET_PLATFORM_FEE_USDC} USDC`} />
          </div>

          {error && (
            <div className="bridge-notice" role="alert">
              <CircleAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          {recovery && !recoveryIsCurrent && !busy && (
            <div className="bridge-recovery-note">
              An existing burn is preserved in this link. Restore {BRIDGE_CHAINS[recovery.route.source].label}
              {" "}and {recovery.amount} USDC to resume it; do not repeat the burn.
            </div>
          )}

          {recoveryIsCurrent && !busy && result?.state !== "success" && (
            <div className="bridge-recovery-note">
              Existing source burn loaded. Review the same wallets, amount, and route to resume the
              attestation and Arc mint. Resuming cannot create another burn.
            </div>
          )}

          {visibleSteps.length > 0 && (
            <BridgeProgress
              state={result?.state ?? "pending"}
              steps={visibleSteps}
              source={route.source}
            />
          )}

          {!account ? (
            <button className="bridge-primary" type="button" onClick={connectWallet}>
              <Wallet size={17} /> Connect Arc wallet
            </button>
          ) : needsSolanaWallet ? (
            <SolanaWalletChoices wallets={solanaWallets} onConnect={connectSolanaWallet} />
          ) : result?.state === "error" && !recovery ? (
            <button className="bridge-primary" type="button" onClick={retryTransfer} disabled={busy}>
              {phase === "retrying" ? <BridgeLoader /> : <LockKeyhole size={17} />}
              {phase === "retrying" ? "Resuming transfer" : "Resume incomplete transfer"}
            </button>
          ) : result?.state === "success" ? (
            <button
              className="bridge-primary bridge-primary-success"
              type="button"
              onClick={() => {
                setAmount("");
                setResult(undefined);
                setResultIntent(undefined);
                setEstimate(undefined);
                setEstimateIntent(undefined);
              }}
            >
              Transfer complete
            </button>
          ) : recoveryIsCurrent ? (
            <button className="bridge-primary" type="button" onClick={resumeRecoveredTransfer} disabled={busy}>
              {phase === "retrying" && <BridgeLoader />}
              {phase === "retrying" ? "Waiting for Circle finality" : "Resume existing transfer"}
            </button>
          ) : estimate ? (
            <button className="bridge-primary" type="button" onClick={executeTransfer} disabled={busy}>
              {phase === "transferring" && <BridgeLoader />}
              {transferButtonLabel}
            </button>
          ) : (
            <button
              className="bridge-primary"
              type="button"
              onClick={estimateTransfer}
              disabled={!normalizedAmount || busy || !sourceAccount || Boolean(recovery && !recoveryIsCurrent)}
            >
              {phase === "estimating" && <BridgeLoader />}
              {phase === "estimating" ? "Checking route" : "Review transfer"}
            </button>
          )}

          {solanaWallet && source.walletFamily === "solana" && !busy && (
            <button className="bridge-source-disconnect" type="button" onClick={disconnectSolanaWallet}>
              Disconnect {solanaWallet.name} source wallet
            </button>
          )}

          <p className="bridge-safety-note">
            <LockKeyhole size={13} /> Verify the source network, amount, Arc recipient, and Circle contract
            in every wallet prompt.
          </p>
        </section>
      </main>
    </div>
  );
}

function ChainMark({ chain }: { chain: BridgeRoute["source"] | BridgeRoute["destination"] }) {
  if (chain === "Arc_Testnet") {
    return (
      <span className="bridge-chain-mark bridge-chain-mark-arc" aria-hidden="true">
        <img src="/arc-network-mark.svg" alt="" />
      </span>
    );
  }
  if (chain === "Ethereum_Sepolia") {
    return (
      <span className="bridge-chain-mark bridge-chain-mark-ethereum" aria-hidden="true">
        <svg viewBox="0 0 32 44">
          <path d="M16 1 2 23l14 8 14-8L16 1Z" />
          <path d="m2 26 14 17 14-17-14 8-14-8Z" />
        </svg>
      </span>
    );
  }
  if (chain === "Solana_Devnet") {
    return (
      <span className="bridge-chain-mark bridge-chain-mark-solana" aria-hidden="true">
        <svg viewBox="0 0 32 28">
          <path d="M8 2h22l-6 6H2l6-6Zm0 9h22l-6 6H2l6-6Zm0 9h22l-6 6H2l6-6Z" />
        </svg>
      </span>
    );
  }
  return (
    <span className="bridge-chain-mark bridge-chain-mark-text" aria-hidden="true">
      {BRIDGE_CHAINS[chain].mark.slice(0, 3)}
    </span>
  );
}

function SolanaWalletChoices({
  wallets,
  onConnect
}: {
  wallets: SolanaWalletOption[];
  onConnect: (wallet: SolanaWalletOption) => void;
}) {
  if (wallets.length === 0) {
    return (
      <a className="bridge-primary" href="https://phantom.com/download" target="_blank" rel="noreferrer">
        Install a Solana wallet <ArrowUpRight size={16} />
      </a>
    );
  }
  if (wallets.length === 1) {
    return (
      <button className="bridge-primary" type="button" onClick={() => onConnect(wallets[0])}>
        <Wallet size={17} /> Connect {wallets[0].name}
      </button>
    );
  }
  return (
    <div className="bridge-wallet-choices" aria-label="Choose a Solana wallet">
      <span>Connect source wallet</span>
      <div>
        {wallets.map((wallet) => (
          <button key={wallet.name} type="button" onClick={() => onConnect(wallet)}>
            {wallet.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function BridgeLoader() {
  return (
    <span className="bridge-loader" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BridgeProgress({
  state,
  steps,
  source
}: {
  state: BridgeResult["state"];
  steps: BridgeStep[];
  source: BridgeRoute["source"];
}) {
  const displaySteps = bridgeDisplaySteps(steps);
  const burnComplete = stepSucceeded(steps, "burn");
  const attestationComplete = stepSucceeded(steps, "fetchAttestation");
  const title =
    state === "success"
      ? "Arc mint confirmed"
      : burnComplete && !attestationComplete
        ? "Waiting for Circle finality"
        : attestationComplete
          ? "Attestation ready"
          : "Source transfer in progress";
  return (
    <div className={`bridge-progress bridge-progress-${state}`} aria-live="polite">
      <div className="bridge-progress-head">
        <strong>{title}</strong>
        <span>{state}</span>
      </div>
      {burnComplete && !attestationComplete && (
        <p className="bridge-finality-copy">
          The source burn is final. Standard {BRIDGE_CHAINS[source].shortLabel} attestation usually
          takes {BRIDGE_CHAINS[source].standardFinality}. Keep this tab open and do not bridge again.
        </p>
      )}
      <ol>
        {displaySteps.map((step) => (
          <li key={step.name} className={step.state}>
            <div>
              <strong>{bridgeStepLabel(step.name)}</strong>
              <small>{bridgeStepStateLabel(step.state)}</small>
              {step.errorMessage && <small>{errorMessage(new Error(step.errorMessage))}</small>}
            </div>
            {step.explorerUrl && (
              <a
                href={step.explorerUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${step.name} transaction`}
              >
                <ArrowUpRight size={14} />
              </a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function subscribeToBridgeSteps(onStep: (step: BridgeStep) => void): () => void {
  const handler = (payload: { values: BridgeStep }) => onStep(payload.values);
  bridgeKit.on("approve", handler);
  bridgeKit.on("burn", handler);
  bridgeKit.on("fetchAttestation", handler);
  bridgeKit.on("mint", handler);
  return () => {
    bridgeKit.off("approve", handler);
    bridgeKit.off("burn", handler);
    bridgeKit.off("fetchAttestation", handler);
    bridgeKit.off("mint", handler);
  };
}

function upsertBridgeStep(steps: BridgeStep[], next: BridgeStep): BridgeStep[] {
  const index = steps.findIndex((step) => step.name === next.name);
  if (index === -1) return [...steps, next];
  return steps.map((step, stepIndex) => (stepIndex === index ? next : step));
}

function recoverySteps(recovery: BridgeRecovery): BridgeStep[] {
  return [
    { name: "approve", state: "success" },
    {
      name: "burn",
      state: "success",
      txHash: recovery.burnTxId,
      explorerUrl: formatBridgeExplorerUrl(recovery.route.source, recovery.burnTxId)
    }
  ];
}

function buildRecoveredResult(
  recovery: BridgeRecovery,
  sourceAccount: string,
  destinationAccount: Address
): BridgeResult {
  return {
    amount: recovery.amount,
    token: "USDC",
    state: "error",
    config: { ...TESTNET_BRIDGE_CONFIG },
    provider: "CCTPV2BridgingProvider",
    source: { address: sourceAccount, chain: resolveChainIdentifier(recovery.route.source) },
    destination: {
      address: destinationAccount,
      chain: resolveChainIdentifier(recovery.route.destination),
      recipientAddress: destinationAccount
    },
    steps: recoverySteps(recovery)
  };
}

function replaceRecoveryUrl(recovery: BridgeRecovery): void {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${buildBridgeLocationSearch(window.location.search, recovery)}`
  );
}

function clearRecoveryUrl(): void {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${buildBridgeLocationSearch(window.location.search)}`
  );
}

function stepSucceeded(steps: BridgeStep[], name: string): boolean {
  return steps.some((step) => step.name === name && (step.state === "success" || step.state === "noop"));
}

function bridgeDisplaySteps(steps: BridgeStep[]): BridgeStep[] {
  const names = ["approve", "burn", "fetchAttestation", "mint"];
  const completedIndex = names.reduce(
    (latest, name, index) => (stepSucceeded(steps, name) ? index : latest),
    -1
  );
  return names.map((name, index) => {
    const existing = steps.find((step) => step.name === name);
    if (existing) return existing;
    return { name, state: index === completedIndex + 1 ? "pending" : "noop" };
  });
}

function bridgeStepLabel(name: string): string {
  return (
    {
      approve: "USDC allowance",
      burn: "Source burn",
      fetchAttestation: "Circle attestation",
      mint: "Arc mint"
    } as Record<string, string>
  )[name] ?? name;
}

function bridgeStepStateLabel(state: BridgeStep["state"]): string {
  if (state === "success") return "Confirmed";
  if (state === "pending") return "In progress";
  if (state === "error") return "Needs attention";
  return "Waiting";
}

function getTransferButtonLabel(
  steps: BridgeStep[],
  phase: BridgePhase,
  normalizedAmount: string | undefined
): string {
  if (phase !== "transferring") return `Bridge ${normalizedAmount ?? ""} USDC`.trim();
  if (stepSucceeded(steps, "fetchAttestation")) return "Confirm Arc mint";
  if (stepSucceeded(steps, "burn")) return "Waiting for Circle finality";
  if (stepSucceeded(steps, "approve")) return "Confirm source burn";
  return "Confirm USDC allowance";
}

function discoverSolanaWallets(): SolanaWalletOption[] {
  if (typeof window === "undefined") return [];
  const walletWindow = window as Window & {
    solana?: SolanaWalletProvider;
    phantom?: { solana?: SolanaWalletProvider };
    solflare?: SolanaWalletProvider;
    backpack?: { solana?: SolanaWalletProvider };
  };
  const candidates: Array<[string, SolanaWalletProvider | undefined]> = [
    ["Phantom", walletWindow.phantom?.solana],
    ["Solflare", walletWindow.solflare],
    ["Backpack", walletWindow.backpack?.solana],
    [walletWindow.solana?.isSolflare ? "Solflare" : "Solana wallet", walletWindow.solana]
  ];
  const seen = new Set<SolanaWalletProvider>();
  return candidates.flatMap(([name, provider]) => {
    if (!isSolanaWalletProvider(provider) || seen.has(provider)) return [];
    seen.add(provider);
    return [{ name: provider.isPhantom ? "Phantom" : provider.isSolflare ? "Solflare" : name, provider }];
  });
}

function isSolanaWalletProvider(value: unknown): value is SolanaWalletProvider {
  if (!value || typeof value !== "object") return false;
  const provider = value as Partial<SolanaWalletProvider>;
  return (
    typeof provider.connect === "function" &&
    typeof provider.disconnect === "function" &&
    typeof provider.signTransaction === "function" &&
    typeof provider.isConnected === "boolean"
  );
}

function readSolanaAddress(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("toString" in value)) return undefined;
  const address = String(value);
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : undefined;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function errorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (/user rejected|user denied|rejected the request|request rejected/.test(message)) {
    return "The wallet request was rejected. No automatic retry was started.";
  }
  if (/insufficient funds|exceeds balance|insufficient.*balance/.test(message)) {
    return "The source wallet does not have enough USDC or network fees for this transfer.";
  }
  if (/wrong network|chain mismatch|unsupported chain|switch network/.test(message)) {
    return "The wallet is on the wrong network. Verify the selected source and try again.";
  }
  if (/account changed|account could not be verified|account.*match/.test(message)) {
    return "A connected wallet changed. Review a fresh transfer before continuing.";
  }
  if (/did not return an account|no .*wallet provider|install or open/.test(message)) {
    return "The required wallet is unavailable. Install or unlock it, then reconnect.";
  }
  if (cause instanceof Error && cause.message.startsWith("Recovery safety check:")) {
    return cause.message;
  }
  return "A wallet or network step failed. Review completed transaction links before retrying.";
}

export default BridgeApp;
