import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BridgeKit, type BridgeResult, type EstimateResult } from "@circle-fin/bridge-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { ArrowDownUp, ArrowUpRight, Check, CircleAlert, LockKeyhole, Wallet } from "lucide-react";
import { getAddress, type Address } from "viem";
import { useDisburseDynamicWallet } from "../lib/dynamic";
import { getInjectedProvider, type EthereumProvider } from "../lib/onchain";
import { assertProviderAccount } from "../lib/providerAccount";
import { getAppHref, getDocsHref } from "../lib/routing";
import {
  BRIDGE_CHAINS,
  INITIAL_BRIDGE_ROUTE,
  TESTNET_BRIDGE_CONFIG,
  TESTNET_PLATFORM_FEE_USDC,
  isSupportedBridgeRoute,
  normalizeBridgeAmount,
  normalizeBridgeRecipient,
  reverseBridgeRoute,
  type BridgeRoute
} from "./config";
import "./bridge.css";

const bridgeKit = new BridgeKit();

type BridgePhase = "idle" | "estimating" | "ready" | "transferring" | "retrying";

function BridgeApp() {
  const dynamicWallet = useDisburseDynamicWallet();
  const [account, setAccount] = useState<Address>();
  const [route, setRoute] = useState<BridgeRoute>(INITIAL_BRIDGE_ROUTE);
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<BridgePhase>("idle");
  const [estimate, setEstimate] = useState<EstimateResult>();
  const [estimateIntent, setEstimateIntent] = useState<string>();
  const [result, setResult] = useState<BridgeResult>();
  const [resultIntent, setResultIntent] = useState<string>();
  const [error, setError] = useState<string>();

  const source = BRIDGE_CHAINS[route.source];
  const destination = BRIDGE_CHAINS[route.destination];
  const normalizedAmount = useMemo(() => {
    try {
      return normalizeBridgeAmount(amount);
    } catch {
      return undefined;
    }
  }, [amount]);
  const intent = `${account?.toLowerCase() ?? "disconnected"}:${route.source}:${route.destination}:${normalizedAmount ?? "invalid"}`;
  const intentRef = useRef(intent);
  intentRef.current = intent;
  const activeOperationIntent = useRef<string | undefined>(undefined);

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
    setError(undefined);
    setPhase("idle");
  }, [account, amount, route]);

  const createAdapter = useCallback(
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

  async function estimateTransfer() {
    setError(undefined);
    if (!account || !normalizedAmount || !isSupportedBridgeRoute(route)) {
      setError("Connect a wallet and enter a valid USDC amount.");
      return;
    }
    setPhase("estimating");
    const requestedIntent = intent;
    try {
      const adapter = await createAdapter(account);
      const next = await bridgeKit.estimate({
        from: { adapter, chain: route.source },
        to: { adapter, chain: route.destination, recipientAddress: account },
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
    setPhase("transferring");
    try {
      const adapter = await createAdapter(account);
      const next = await bridgeKit.bridge({
        from: { adapter, chain: route.source },
        to: { adapter, chain: route.destination, recipientAddress: account },
        amount: normalizedAmount,
        token: "USDC",
        config: { ...TESTNET_BRIDGE_CONFIG }
      });
      activeOperationIntent.current = undefined;
      setResult(next);
      setResultIntent(transferIntent);
      setPhase("ready");
      if (intentRef.current !== transferIntent) {
        setError(
          "The active wallet changed. Reconnect the original wallet before attempting recovery; do not start a second burn."
        );
      } else if (next.state !== "success") {
        setError("The transfer is incomplete. Review the completed steps before retrying.");
      }
    } catch (cause) {
      activeOperationIntent.current = undefined;
      setPhase(intentRef.current === transferIntent ? "ready" : "idle");
      setError(errorMessage(cause));
    }
  }

  async function retryTransfer() {
    if (!account || !result || result.state === "success") return;
    if (!resultIntent || resultIntent !== intent) {
      setError(
        "Reconnect the original wallet and restore the original transfer details before resuming this transfer."
      );
      return;
    }
    activeOperationIntent.current = resultIntent;
    setPhase("retrying");
    setError(undefined);
    try {
      const adapter = await createAdapter(account);
      const next = await bridgeKit.retry(result, { from: adapter, to: adapter });
      activeOperationIntent.current = undefined;
      setResult(next);
      setPhase("ready");
      if (intentRef.current !== resultIntent) {
        setError(
          "The active wallet changed during recovery. Keep this result and reconnect the original wallet before continuing."
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
            <button type="button" onClick={disconnectWallet} title="Disconnect wallet" disabled={busy}>
              <Wallet size={13} aria-hidden="true" />
              {shortAddress(account)}
            </button>
          ) : (
            <button type="button" onClick={connectWallet}>
              Connect wallet
            </button>
          )}
        </nav>
      </header>

      <main className="bridge-main">
        <section className="bridge-intro">
          <h1>Bridge native USDC</h1>
          <p>
            Move native USDC between Ethereum Sepolia and Arc Testnet through Circle CCTP V2. Your wallet
            authorizes the transfer; Disburse never takes custody.
          </p>
        </section>

        <section className="bridge-panel" aria-label="Bridge USDC">
          <header className="bridge-panel-head">
            <strong>USDC transfer</strong>
            <span>Testnet only</span>
          </header>
          <div className="bridge-route-card">
            <span className="bridge-field-label">From</span>
            <button
              className="bridge-chain"
              type="button"
              onClick={() => setRoute(reverseBridgeRoute(route))}
              disabled={busy}
            >
              <ChainMark chain={route.source} />
              <span>
                <strong>{source.shortLabel}</strong>
                <small>{source.label}</small>
              </span>
            </button>
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

          <button
            className="bridge-route-swap"
            type="button"
            onClick={() => setRoute(reverseBridgeRoute(route))}
            aria-label="Reverse bridge direction"
            disabled={busy}
          >
            <ArrowDownUp size={16} />
          </button>

          <div className="bridge-route-card bridge-route-destination">
            <span className="bridge-field-label">To</span>
            <button
              className="bridge-chain"
              type="button"
              onClick={() => setRoute(reverseBridgeRoute(route))}
              disabled={busy}
            >
              <ChainMark chain={route.destination} />
              <span>
                <strong>{destination.shortLabel}</strong>
                <small>{destination.label}</small>
              </span>
            </button>
            <div className="bridge-recipient">
              <span className="bridge-field-label">Recipient</span>
              <span>{account ? shortAddress(account) : "Connected wallet"}</span>
            </div>
          </div>

          <div className="bridge-quote" aria-label="Transfer fees">
            <QuoteRow label="Protocol" value="Circle CCTP V2 Standard" />
            <QuoteRow
              label="Estimated CCTP fee"
              value={estimate ? `${protocolFee ?? "Unavailable"} USDC` : "Review required"}
            />
            <QuoteRow label="Disburse fee" value={`${TESTNET_PLATFORM_FEE_USDC} USDC`} />
          </div>

          {error && (
            <div className="bridge-notice" role="alert">
              <CircleAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          {result && <BridgeProgress result={result} />}

          {!account ? (
            <button className="bridge-primary" type="button" onClick={connectWallet}>
              <Wallet size={17} /> Connect wallet
            </button>
          ) : result?.state === "error" ? (
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
              <Check size={17} /> Transfer complete
            </button>
          ) : estimate ? (
            <button className="bridge-primary" type="button" onClick={executeTransfer} disabled={busy}>
              {phase === "transferring" && <BridgeLoader />}
              {phase === "transferring" ? "Complete wallet steps" : `Bridge ${normalizedAmount} USDC`}
            </button>
          ) : (
            <button
              className="bridge-primary"
              type="button"
              onClick={estimateTransfer}
              disabled={!normalizedAmount || busy}
            >
              {phase === "estimating" && <BridgeLoader />}
              {phase === "estimating" ? "Checking route" : "Review transfer"}
            </button>
          )}

          <p className="bridge-safety-note">
            <LockKeyhole size={13} /> Verify network, amount, and Circle contract in every wallet prompt.
          </p>
        </section>
      </main>
    </div>
  );
}

function ChainMark({ chain }: { chain: BridgeRoute["source"] }) {
  if (chain === "Arc_Testnet") {
    return (
      <span className="bridge-chain-mark bridge-chain-mark-arc" aria-hidden="true">
        <img src="/arc-network-mark.svg" alt="" />
      </span>
    );
  }
  return (
    <span className="bridge-chain-mark bridge-chain-mark-ethereum" aria-hidden="true">
      <svg viewBox="0 0 32 44">
        <path d="M16 1 2 23l14 8 14-8L16 1Z" />
        <path d="m2 26 14 17 14-17-14 8-14-8Z" />
      </svg>
    </span>
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

function BridgeProgress({ result }: { result: BridgeResult }) {
  return (
    <div className={`bridge-progress bridge-progress-${result.state}`} aria-live="polite">
      <div className="bridge-progress-head">
        <strong>{result.state === "success" ? "Destination mint confirmed" : "Transfer progress"}</strong>
        <span>{result.state}</span>
      </div>
      <ol>
        {result.steps.map((step, index) => (
          <li key={`${step.name}-${index}`} className={step.state}>
            <span className="bridge-step-mark">
              {step.state === "success" ? <Check size={12} /> : index + 1}
            </span>
            <div>
              <strong>{step.name}</strong>
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

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function errorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (/user rejected|user denied|rejected the request|request rejected/.test(message)) {
    return "The wallet request was rejected. No automatic retry was started.";
  }
  if (/insufficient funds|exceeds balance|insufficient.*balance/.test(message)) {
    return "The source wallet does not have enough balance for the transfer and network fees.";
  }
  if (/wrong network|chain mismatch|unsupported chain|switch network/.test(message)) {
    return "The wallet is on the wrong network. Verify the source chain and try again.";
  }
  if (/account changed|account could not be verified/.test(message)) {
    return "The connected wallet changed. Review a fresh transfer before continuing.";
  }
  return "A wallet or network step failed. Review any completed transaction links before retrying.";
}

export default BridgeApp;
