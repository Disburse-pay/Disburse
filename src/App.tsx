import { type ComponentProps, type FormEvent, type MouseEvent, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  FileText,
  Moon,
  ShieldCheck,
  Sun
} from "lucide-react";
import Sidebar from "@/src/components/Sidebar";
import Header from "@/src/components/Header";
import SidePanel from "@/src/components/ui/SidePanel";
import DateInput from "@/src/components/ui/DateInput";
import SettingsPanel from "@/src/components/SettingsPanel";
import TransactionsTable from "@/src/components/TransactionsTable";
import QrShareCard from "@/src/components/QrShareCard";
import DisburseIdCard from "@/src/components/DisburseIdCard";
import HandleHint from "@/src/components/HandleHint";
import InboxPanel, { useInboxUnread } from "@/src/components/InboxPanel";
import DepositPanel from "@/src/components/DepositPanel";
import ReceiptView from "@/src/components/receipt";
import { cn } from "@/src/lib/utils";
import { createSettlementAttestation, type SettlementAttestation } from "./lib/attestation";
import { generateSettlementProof, downloadSettlementProof, downloadUBLInvoice } from "./lib/compliance";


import { formatUnits, type Hash } from "viem";
import {
  ARC_CHAIN_ID,
  ARC_FAUCET_URL
} from "./lib/arc";
import { errorToMessage } from "./lib/errors";
import { I18nProvider, useI18n } from "./lib/i18n";
import {
  type AppSettings,
  loadSettings
} from "./lib/settings";
import { buildInvoiceFilename, formatInvoiceDate, generateInvoicePdf } from "./lib/invoice";
import {
  checkArcRpc,
  connectWallet,
  estimatePayment,
  getSpendabilityCheck,
  getInjectedProvider,
  getWalletChainId,
  hasInsufficientNativeSpendBalance,
  readBalances,
  submitPayment,
  submitTokenTransfer,
  switchToArc,
  verifyPayment,
  waitForTransactionConfirmation,
  type Balances,
  type EthereumProvider,
  type SpendableTransfer,
  type TokenTransfer,
  type TransferEstimate
} from "./lib/onchain";
import {
  buildShareUrl,
  createExpiry,
  decodeRequestPayload,
  formatTokenAmount,
  isPaymentExpired,
  isPaymentPayable,
  mergeScannedRequest,
  normalizeInvoiceDate,
  normalizeLabel,
  normalizeNote,
  parseTokenAmount,
  refreshDerivedStatus,
  shortAddress,
  toExplorerAddressUrl,
  toExplorerTxUrl,
  validateRecipient,
  type PaymentRequest,
  type PaymentStatus,
  type PaymentToken,
  type Receipt
} from "./lib/payments";
import { buildQrDataUrl } from "./lib/qr";
import {
  buildExportBundle,
  loadReceipts,
  loadRequests,
  parseExportBundle,
  RECEIPTS_KEY,
  REQUESTS_KEY,
  saveReceipts,
  saveRequests,
  upsertReceipt,
  upsertRequest
} from "./lib/storage";
import { handleFromInput } from "./lib/idsApi";
import {
  confirmRemoteQrPayment,
  createRemoteQrRequest,
  fetchRemoteQrStatus,
  recordRemoteQrSubmission,
  type QrConfirmationPayload
} from "./lib/qrApi";
import { applyQrRealtimeEvent, shouldHideQrForStatus, type QrRealtimeEvent, type QrStatusPayload } from "./lib/realtime";
import { getSupabaseBrowserClient } from "./lib/supabaseClient";
import { useDisburseDynamicWallet } from "./lib/dynamic";
import LandingPage from "./LandingPage";
import { lazyChart } from "./lib/lazyChart";

// Chart cards pull in recharts (heavy). Load them on demand so the `charts`
// chunk stays off the initial bundle and the mobile pay page.
const BalanceCard = lazyChart(() => import("@/src/components/BalanceCard"));
const MonthlyStats = lazyChart(() => import("@/src/components/MonthlyStats"));

import { cx } from "./lib/cx";
import {
  THEME_KEY,
  getInitialTheme,
  type Theme
} from "./lib/theme";
import {
  getInitialPage,
  isPaySurface,
  getPayShareOrigin,
  getInternalTargetPath,
  getCurrentRouteKey,
  type Page
} from "./lib/routing";



type DirectFormState = {
  recipient: string;
  token: PaymentToken;
  amount: string;
  label?: string;
  note?: string;
};

type QrFormState = DirectFormState & {
  label: string;
  note: string;
  invoiceDate: string;
  /** Optional Disburse ID that should receive the request in their inbox. */
  notify: string;
};

type Notice = {
  tone: "info" | "success" | "error";
  text: string;
};

type RpcHealth = Awaited<ReturnType<typeof checkArcRpc>>;
type PayLifecycle =
  | "idle"
  | "preparing"
  | "awaiting_wallet"
  | "submitted"
  | "confirming"
  | "proving"
  | "settling"
  | "verified"
  | "failed";

const emptyDirectForm: DirectFormState = {
  recipient: "",
  token: "USDC",
  amount: "",
  label: undefined,
  note: undefined
};

const emptyQrForm: QrFormState = {
  recipient: "",
  token: "USDC",
  amount: "",
  label: "",
  note: "",
  invoiceDate: todayInputValue(),
  notify: ""
};

function App() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [page, setPage] = useState<Page>(() => getInitialPage());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [routeKey, setRouteKey] = useState(() => getCurrentRouteKey());
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [directForm, setDirectForm] = useState<DirectFormState>(emptyDirectForm);
  const [qrForm, setQrForm] = useState<QrFormState>(emptyQrForm);
  const [requests, setRequests] = useState<PaymentRequest[]>(() => loadRequests());
  const [receipts, setReceipts] = useState<Receipt[]>(() => loadReceipts());
  const [selectedId, setSelectedId] = useState<string | undefined>(() => loadRequests()[0]?.id);
  const [payRequestId, setPayRequestId] = useState<string | undefined>();
  const [shareUrl, setShareUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [directNotice, setDirectNotice] = useState<Notice | undefined>();
  const [qrNotice, setQrNotice] = useState<Notice | undefined>();
  const [payNotice, setPayNotice] = useState<Notice | undefined>();
  const [walletNotice, setWalletNotice] = useState<Notice | undefined>();
  const [account, setAccount] = useState<`0x${string}` | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [directBalances, setDirectBalances] = useState<Balances | undefined>();
  const [payBalances, setPayBalances] = useState<Balances | undefined>();
  const [directEstimate, setDirectEstimate] = useState<TransferEstimate | undefined>();
  const [payEstimate, setPayEstimate] = useState<TransferEstimate | undefined>();
  const [directHash, setDirectHash] = useState<Hash | undefined>();
  const [rpcHealth, setRpcHealth] = useState<RpcHealth | undefined>();
  const [now, setNow] = useState(() => new Date());
  const [isCreatingQr, setIsCreatingQr] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isEstimatingDirect, setIsEstimatingDirect] = useState(false);
  const [isSendingDirect, setIsSendingDirect] = useState(false);
  const [isEstimatingPay, setIsEstimatingPay] = useState(false);
  const [isPayingQr, setIsPayingQr] = useState(false);
  const [payLifecycle, setPayLifecycle] = useState<PayLifecycle>("idle");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [payAttestation, setPayAttestation] = useState<SettlementAttestation | undefined>();
  const [appSettings] = useState<AppSettings>(() => loadSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [inboxRefreshKey, setInboxRefreshKey] = useState(0);
  const inboxUnreadCount = useInboxUnread(account, inboxRefreshKey);
  const dynamicWallet = useDisburseDynamicWallet();

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedId) ?? requests[0],
    [requests, selectedId]
  );

  const payRequest = useMemo(
    () => (payRequestId ? requests.find((request) => request.id === payRequestId) : undefined),
    [requests, payRequestId]
  );

  const selectedReceipt = useMemo(
    () => receipts.find((receipt) => receipt.requestId === selectedRequest?.id),
    [receipts, selectedRequest?.id]
  );

  const payReceipt = useMemo(
    () => receipts.find((receipt) => receipt.requestId === payRequest?.id),
    [receipts, payRequest?.id]
  );

  const wrongChain = Boolean(account && chainId !== undefined && chainId !== ARC_CHAIN_ID);
  const payWrongChain = wrongChain;
  const hasWalletProvider = dynamicWallet.enabled || Boolean(getInjectedProvider());
  const payDisplayStatus = payRequest ? refreshDerivedStatus(payRequest, now).status : "open";
  const payIsExpired = payRequest ? isPaymentExpired(payRequest, now) : false;
  const payIsPayable = payRequest ? isPaymentPayable(payRequest, now) : false;
  const directInsufficientToken = useInsufficientToken(directBalances, directForm);
  const payInsufficientToken = useInsufficientToken(payBalances, payRequest);
  const directMissingGas = hasInsufficientGas(directBalances, directForm, directEstimate);
  const payMissingGas = hasInsufficientGas(payBalances, payRequest, payEstimate);
  const rpcIsStale = Boolean(rpcHealth && Date.now() - new Date(rpcHealth.checkedAt).getTime() > 18_000);
  const rpcStatusLabel = !rpcHealth
    ? "checking"
    : !rpcHealth.healthy
      ? "rpc down"
      : rpcIsStale
        ? "stale"
        : rpcHealth.activeEndpoint?.label ?? "active";
  const rpcBlockLabel = rpcHealth?.healthy && rpcHealth.blockNumber ? `block ${rpcHealth.blockNumber}` : rpcStatusLabel;

  const getWalletProvider = useCallback(async (): Promise<EthereumProvider | undefined> => {
    if (dynamicWallet.enabled) {
      return dynamicWallet.getEthereumProvider();
    }
    return getInjectedProvider();
  }, [dynamicWallet.enabled, dynamicWallet.primaryWallet]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0a0b0e" : "#f6f6f3");
  }, [theme]);

  // (/docs never reaches this component — main.tsx redirects it to the docs
  // host before anything mounts.)

  // Legacy: /settings is now a dialog, not a page. Open it and tidy the URL.
  useEffect(() => {
    if (page === "dashboard" && window.location.pathname === "/settings") {
      setIsSettingsOpen(true);
      window.history.replaceState(null, "", "/");
    }
  }, [page]);

  useEffect(() => {
    // Docs render on the docs host and never reach this code, so the title
    // map is keyed only on the app-shell pages.
    const titles: Partial<Record<Page, string>> = {
      landing: "Disburse - Settlement-grade stablecoin payments",
      dashboard: "Dashboard · Disburse",
      payments: "Send · Disburse",
      "qr-payments": "QR · Disburse",
      pay: "Pay request · Disburse",
      "import-export": "Backup · Disburse",
      statements: "Statements · Disburse",
    };
    document.title = titles[page] ?? "Disburse";
  }, [page]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setPage(getInitialPage());
      setRouteKey(getCurrentRouteKey());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    saveRequests(requests);
  }, [requests]);

  useEffect(() => {
    saveReceipts(receipts);
  }, [receipts]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === REQUESTS_KEY) {
        setRequests(loadRequests());
      }
      if (event.key === RECEIPTS_KEY) {
        setReceipts(loadReceipts());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (page !== "qr-payments" || !selectedRequest) {
      return;
    }

    let isActive = true;
    fetchRemoteQrStatus(selectedRequest.id)
      .then((payload) => {
        if (isActive && payload) {
          applyQrStatusPayload(payload, setRequests, setReceipts);
        }
      })
      .catch((error) => {
        if (isActive) {
          setQrNotice({ tone: "error", text: errorToMessage(error) });
        }
      });

    return () => {
      isActive = false;
    };
  }, [page, selectedRequest?.id]);

  useEffect(() => {
    if (page !== "qr-payments" || !selectedRequest) {
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel(`qr-request:${selectedRequest.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "payment_request_events",
          filter: `request_id=eq.${selectedRequest.id}`
        },
        (payload) => {
          const event = payload.new as QrRealtimeEvent;
          // psp_error is a backend diagnostic for a payment that already
          // settled — it must not drive live request state or raise a
          // (status: paid) success toast. Operators read it from the DB.
          if (event.event_type === "psp_error") {
            return;
          }
          setRequests((current) => {
            const request = current.find((item) => item.id === event.request_id) ?? selectedRequest;
            return upsertRequest(current, applyQrRealtimeEvent(request, event).request);
          });
          if (event.receipt) {
            setReceipts((current) => upsertReceipt(current, event.receipt as Receipt));
          }
          setQrNotice({
            tone: event.status === "paid" ? "success" : shouldHideQrForStatus(event.status) ? "error" : "info",
            text: event.message
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [page, selectedRequest?.id]);

  useEffect(() => {
    if (!selectedRequest) {
      setShareUrl("");
      return;
    }
    setShareUrl(buildShareUrl(selectedRequest, getPayShareOrigin()));
  }, [
    selectedRequest?.id,
    selectedRequest?.recipient,
    selectedRequest?.token,
    selectedRequest?.amount,
    selectedRequest?.label,
    selectedRequest?.note,
    selectedRequest?.invoiceDate,
    selectedRequest?.expiresAt,
    selectedRequest?.createdAt,
    selectedRequest?.startBlock
  ]);

  useEffect(() => {
    let isActive = true;

    if (!shareUrl) {
      setQrDataUrl("");
      return;
    }

    buildQrDataUrl(shareUrl)
      .then((nextDataUrl) => {
        if (isActive) {
          setQrDataUrl(nextDataUrl);
        }
      })
      .catch(() => {
        if (isActive) {
          setQrDataUrl("");
        }
      });

    return () => {
      isActive = false;
    };
  }, [shareUrl]);

  useEffect(() => {
    if (page !== "pay") {
      return;
    }

    const encoded = new URLSearchParams(window.location.search).get("r");
    if (!encoded) {
      setPayRequestId(undefined);
      setPayBalances(undefined);
      setPayEstimate(undefined);
      setPayLifecycle("idle");
      setPayNotice({ tone: "error", text: "Payment QR link is missing request data." });
      return;
    }

    try {
      const decoded = decodeRequestPayload(encoded);
      setRequests((current) =>
        upsertRequest(current, mergeScannedRequest(current.find((request) => request.id === decoded.id), decoded))
      );
      setPayRequestId(decoded.id);
      setPayBalances(undefined);
      setPayEstimate(undefined);
      setPayLifecycle("idle");
      setPayNotice({ tone: "info", text: "QR payment request loaded." });
    } catch (error) {
      setPayRequestId(undefined);
      setPayBalances(undefined);
      setPayEstimate(undefined);
      setPayLifecycle("idle");
      setPayNotice({ tone: "error", text: errorToMessage(error) });
    }
  }, [page, routeKey]);

  useEffect(() => {
    if (!dynamicWallet.enabled) {
      return;
    }

    let isActive = true;
    const syncDynamicWallet = async () => {
      if (!dynamicWallet.primaryWallet) {
        setAccount(undefined);
        setChainId(undefined);
        setDirectBalances(undefined);
        setPayBalances(undefined);
        setDirectEstimate(undefined);
        setPayEstimate(undefined);
        return;
      }

      const nextAccount = dynamicWallet.getAccount();
      if (!nextAccount) {
        setAccount(undefined);
        setChainId(undefined);
        setWalletNotice({ tone: "error", text: "Dynamic connected wallet is not an EVM wallet." });
        return;
      }

      const nextChainId = await dynamicWallet.getChainId();
      if (!isActive) {
        return;
      }

      setAccount(nextAccount);
      setChainId(nextChainId);
      setDirectBalances(undefined);
      setPayBalances(undefined);
      setDirectEstimate(undefined);
      setPayEstimate(undefined);
    };

    void syncDynamicWallet();

    return () => {
      isActive = false;
    };
  }, [dynamicWallet.enabled, dynamicWallet.primaryWallet]);

  useEffect(() => {
    if (dynamicWallet.enabled) {
      return;
    }
    const provider = getInjectedProvider();
    if (!provider?.on) {
      return;
    }

    const handleAccounts = (value: unknown) => {
      const accounts = value as string[];
      setAccount(accounts?.[0] ? validateRecipient(accounts[0]) : undefined);
      setDirectBalances(undefined);
      setPayBalances(undefined);
      setDirectEstimate(undefined);
      setPayEstimate(undefined);
    };

    const handleChain = (value: unknown) => {
      setChainId(Number.parseInt(String(value), 16));
      setDirectBalances(undefined);
      setPayBalances(undefined);
      setDirectEstimate(undefined);
      setPayEstimate(undefined);
    };

    provider.on("accountsChanged", handleAccounts);
    provider.on("chainChanged", handleChain);

    return () => {
      provider.removeListener?.("accountsChanged", handleAccounts);
      provider.removeListener?.("chainChanged", handleChain);
    };
  }, [dynamicWallet.enabled]);

  useEffect(() => {
    if (!account) {
      return;
    }
    setQrForm((current) => (current.recipient ? current : { ...current, recipient: account }));
  }, [account]);

  useEffect(() => {
    let isActive = true;

    const refreshRpcHealth = async () => {
      try {
        const nextHealth = await checkArcRpc();
        if (isActive) {
          setRpcHealth(nextHealth);
        }
      } catch {
        if (isActive) {
          setRpcHealth(undefined);
        }
      }
    };

    void refreshRpcHealth();
    const interval = window.setInterval(refreshRpcHealth, 6_000);

    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!account) {
      return;
    }
    if (page === "payments" && hasTransferInput(directForm)) {
      if (wrongChain) {
        return;
      }
      void refreshDirectBalances();
    }
    if (page === "pay" && payRequest) {
      if (payWrongChain) {
        return;
      }
      void refreshPayBalances(payRequest);
    }
  }, [account, wrongChain, payWrongChain, page, payRequest?.id, payRequest?.token, payRequest?.amount]);

  async function handleConnectWallet() {
    if (dynamicWallet.enabled && !dynamicWallet.sdkHasLoaded) {
      setWalletNotice({ tone: "info", text: "Dynamic wallet login is still initializing." });
      return;
    }
    if (dynamicWallet.enabled && !dynamicWallet.primaryWallet) {
      dynamicWallet.openAuthFlow();
      setWalletNotice({ tone: "info", text: "Choose or create a wallet with Dynamic." });
      return;
    }

    const provider = await getWalletProvider();
    if (!provider) {
      setWalletNotice({
        tone: "error",
        text: dynamicWallet.enabled
          ? "Connect a Dynamic EVM wallet before continuing."
          : "No injected wallet found. Open this page in a wallet browser or install a supported desktop wallet."
      });
      return;
    }

    setIsConnecting(true);
    setWalletNotice(undefined);

    try {
      const nextAccount = await connectWallet(provider);
      const nextChainId = await getWalletChainId(provider);
      setAccount(nextAccount);
      setChainId(nextChainId);
      setWalletNotice({ tone: "success", text: "Wallet connected." });
    } catch (error) {
      setWalletNotice({ tone: "error", text: errorToMessage(error) });
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnectWallet() {
    try {
      if (dynamicWallet.enabled) {
        await dynamicWallet.disconnect();
      }
    } catch (error) {
      setWalletNotice({ tone: "error", text: errorToMessage(error) });
      return;
    }
    setAccount(undefined);
    setChainId(undefined);
    setWalletNotice({ tone: "info", text: "Wallet disconnected." });
  }

  async function handleSwitchNetwork() {
    const provider = await getWalletProvider();
    if (!provider) {
      setWalletNotice({
        tone: "error",
        text: dynamicWallet.enabled
          ? "Connect a Dynamic EVM wallet before switching networks."
          : "No injected wallet found. Open this page in a wallet browser or install a supported desktop wallet."
      });
      return;
    }

    setIsConnecting(true);
    setWalletNotice(undefined);

    try {
      await switchToArc(provider);
      const nextChainId = await getWalletChainId(provider);
      setChainId(nextChainId);
      setWalletNotice({ tone: "success", text: "Arc Testnet selected." });
    } catch (error) {
      setWalletNotice({ tone: "error", text: errorToMessage(error) });
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDirectEstimate() {
    if (!account) {
      setDirectNotice({ tone: "error", text: "Connect a wallet before estimating." });
      return;
    }
    if (wrongChain) {
      setDirectNotice({ tone: "error", text: "Switch to Arc Testnet before estimating." });
      return;
    }

    setIsEstimatingDirect(true);
    setDirectNotice({ tone: "info", text: "Estimating direct transfer." });

    try {
      const transfer = buildTokenTransfer(directForm);
      const nextEstimate = await estimatePayment(account, transfer);
      setDirectEstimate(nextEstimate);
      await refreshDirectBalances(transfer);
      setDirectNotice({ tone: "success", text: "Estimate ready." });
    } catch (error) {
      setDirectNotice({ tone: "error", text: errorToMessage(error) });
    } finally {
      setIsEstimatingDirect(false);
    }
  }

  async function handleDirectSend() {
    const provider = await getWalletProvider();
    if (!provider || !account) {
      setDirectNotice({ tone: "error", text: "Connect a wallet before sending." });
      return;
    }
    if (wrongChain) {
      setDirectNotice({ tone: "error", text: "Switch to Arc Testnet before sending." });
      return;
    }

    setIsSendingDirect(true);
    setDirectNotice({ tone: "info", text: "Preparing direct transfer." });

    try {
      const transfer = buildTokenTransfer(directForm);
      const balances = await readBalances(account, transfer);
      setDirectBalances(balances);
      ensureTokenBalance(balances, transfer);

      let transferEstimate = directEstimate;
      if (!transferEstimate) {
        setDirectNotice({ tone: "info", text: "Estimating direct transfer." });
        transferEstimate = await estimatePayment(account, transfer);
        setDirectEstimate(transferEstimate);
      }
      ensureGasBalance(balances, transfer, transferEstimate);

      setDirectNotice({ tone: "info", text: "Open your wallet and approve the transfer." });
      const hash = await submitTokenTransfer(provider, account, transfer);
      setDirectHash(hash);
      setDirectNotice({ tone: "info", text: "Transaction submitted. Waiting for confirmation." });

      try {
        const txReceipt = await waitForTransactionConfirmation(hash);
        const { request, receipt } = buildDirectSendRecord({
          transfer,
          payer: account,
          txHash: hash,
          blockNumber: txReceipt.blockNumber.toString(),
          label: directForm.label,
          note: directForm.note
        });
        setRequests((current) => upsertRequest(current, request));
        setReceipts((current) => upsertReceipt(current, receipt));
        setDirectNotice({ tone: "success", text: "Direct payment confirmed. Receipt saved to your history." });
      } catch (error) {
        setDirectNotice({ tone: "info", text: errorToMessage(error) });
      }
    } catch (error) {
      setDirectNotice({ tone: "error", text: errorToMessage(error) });
    } finally {
      setIsSendingDirect(false);
    }
  }

  async function handleCreateQrRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreatingQr(true);
    setQrNotice(undefined);

    try {
      const notify = qrForm.notify.trim() ? handleFromInput(qrForm.notify) : undefined;
      const remote = await createRemoteQrRequest({ ...qrForm, notify });
      const request = remote?.request ?? (await createLocalQrRequest(qrForm));

      setRequests((current) => upsertRequest(current, request));
      setSelectedId(request.id);
      setQrNotice({
        tone: "success",
        text: remote
          ? remote.notified
            ? `QR payment request generated and synced. @${remote.notified} was notified in their inbox.`
            : "QR payment request generated and synced."
          : "QR payment request generated."
      });
      setQrForm((current) => ({
        ...emptyQrForm,
        recipient: current.recipient,
        token: "USDC",
        invoiceDate: current.invoiceDate
      }));
    } catch (error) {
      setQrNotice({ tone: "error", text: errorToMessage(error) });
    } finally {
      setIsCreatingQr(false);
    }
  }

  async function handlePayEstimate() {
    const request = payRequest;
    if (!request || !account) {
      setPayNotice({ tone: "error", text: "Connect a wallet and load a QR request." });
      return;
    }
    if (payWrongChain) {
      setPayNotice({ tone: "error", text: "Switch to Arc Testnet before estimating." });
      return;
    }
    if (!isPaymentPayable(request)) {
      setPayNotice({ tone: "error", text: "This QR payment request expired. Ask the requester for a fresh QR code." });
      return;
    }

    setIsEstimatingPay(true);
    setPayNotice({ tone: "info", text: "Estimating QR payment." });

    try {
      const nextEstimate = await estimatePayment(account, request);
      setPayEstimate(nextEstimate);
      await refreshPayBalances(request);
      setPayNotice({ tone: "success", text: "Estimate ready." });
    } catch (error) {
      setPayNotice({ tone: "error", text: errorToMessage(error) });
    } finally {
      setIsEstimatingPay(false);
    }
  }

  async function handlePayQrRequest() {
    const provider = await getWalletProvider();
    const request = payRequest;
    if (!request || !provider || !account) {
      setPayNotice({ tone: "error", text: "Connect a wallet and load a QR request." });
      return;
    }
    if (payWrongChain) {
      setPayNotice({ tone: "error", text: "Switch to Arc Testnet before paying." });
      return;
    }

    const attemptStartedAt = new Date();
    if (!isPaymentPayable(request, attemptStartedAt)) {
      setPayNotice({ tone: "error", text: "This QR payment request expired. Ask the requester for a fresh QR code." });
      return;
    }

    setIsPayingQr(true);
    setPayLifecycle("preparing");
    setPayNotice({ tone: "info", text: "Preparing QR payment." });

    try {
      const balances = await readBalances(account, request);
      setPayBalances(balances);
      ensureTokenBalance(balances, request);

      let transferEstimate = payEstimate;
      if (!transferEstimate) {
        setPayNotice({ tone: "info", text: "Estimating QR payment." });
        transferEstimate = await estimatePayment(account, request);
        setPayEstimate(transferEstimate);
      }
      ensureGasBalance(balances, request, transferEstimate);

      const requestWithAttempt: PaymentRequest = {
        ...request,
        submittedAt: attemptStartedAt.toISOString()
      };
      setPayLifecycle("awaiting_wallet");
      setPayNotice({ tone: "info", text: "Open your wallet and approve the payment." });

      const hash = await submitPayment(provider, account, requestWithAttempt);
      setPayLifecycle("submitted");
      setPayNotice({ tone: "info", text: "Transaction submitted. Verifying receipt." });

      let requestWithHash: PaymentRequest = { ...requestWithAttempt, txHash: hash };
      try {
        const submission = await recordRemoteQrSubmission(request.id, hash, requestWithAttempt.submittedAt);
        if (submission?.request) {
          requestWithHash = submission.request;
        }
      } catch (error) {
        setPayNotice({ tone: "info", text: `Transaction submitted. ${errorToMessage(error)}` });
      }
      setRequests((current) => upsertRequest(current, requestWithHash));

      setPayLifecycle("confirming");
      try {
        await waitForTransactionConfirmation(hash);
      } catch (error) {
        setPayLifecycle("submitted");
        setPayNotice({ tone: "info", text: errorToMessage(error) });
        return;
      }

      const remoteConfirmation = await confirmRemoteQrPayment(request.id, hash).catch((error) => {
        setPayNotice({ tone: "info", text: errorToMessage(error) });
        return undefined;
      });
      if (remoteConfirmation) {
        applyQrStatusPayload(remoteConfirmation, setRequests, setReceipts);
        setPayLifecycle(remoteConfirmationToLifecycle(remoteConfirmation));
        setPayNotice(remoteConfirmationToNotice(remoteConfirmation));
      } else {
        const result = await verifyPayment(requestWithHash);
        if (result.status === "paid") {
          const paidRequest: PaymentRequest = { ...requestWithHash, status: "paid" };
          setRequests((current) => upsertRequest(current, paidRequest));
          setReceipts((current) => upsertReceipt(current, result.receipt));
          setPayLifecycle("verified");
          setPayNotice({
            tone: "success",
            text: "Payment confirmed. Invoice is ready."
          });
        } else {
          const failedRequest: PaymentRequest = { ...requestWithHash, status: "failed" };
          setRequests((current) => upsertRequest(current, failedRequest));
          setPayLifecycle("failed");
          setPayNotice({
            tone: "error",
            text:
              result.status === "possible_match"
                ? "A transfer reached the requester, but the amount does not match."
                : result.message
          });
        }
      }
    } catch (error) {
      setPayLifecycle("failed");
      setPayNotice({ tone: "error", text: errorToMessage(error) });
    } finally {
      setIsPayingQr(false);
    }
  }

  async function handleVerifyQrRequest(request = payRequest) {
    if (!request) {
      return;
    }

    setIsVerifying(true);
    setPayLifecycle(request.txHash ? "confirming" : "preparing");
    setPayNotice({ tone: "info", text: "Scanning Arc Testnet logs." });

    try {
      const remoteConfirmation = request.txHash
        ? await confirmRemoteQrPayment(request.id, request.txHash).catch(() => undefined)
        : undefined;
      if (remoteConfirmation) {
        applyQrStatusPayload(remoteConfirmation, setRequests, setReceipts);
        setPayLifecycle(remoteConfirmationToLifecycle(remoteConfirmation));
        setPayNotice(remoteConfirmationToNotice(remoteConfirmation));
      } else {
        const result = await verifyPayment(request);
        if (result.status === "paid") {
          const paidRequest: PaymentRequest = { ...request, status: "paid", txHash: result.receipt.txHash };
          setRequests((current) => upsertRequest(current, paidRequest));
          setReceipts((current) => upsertReceipt(current, result.receipt));
          setPayLifecycle("verified");
          setPayNotice({
            tone: "success",
            text: result.message
          });
        } else {
          const failedStatus = result.status === "possible_match" ? "failed" : result.status;
          setRequests((current) => upsertRequest(current, { ...request, status: failedStatus }));
          setPayLifecycle("failed");
          setPayNotice({
            tone: failedStatus === "failed" ? "error" : "info",
            text:
              result.status === "possible_match"
                ? "A transfer reached the requester, but the amount does not match."
                : result.message
          });
        }
      }
    } catch (error) {
      setPayLifecycle("failed");
      setPayNotice({ tone: "error", text: errorToMessage(error) });
    } finally {
      setIsVerifying(false);
    }
  }

  async function downloadInvoicePdf(request: PaymentRequest, receipt: Receipt) {
    setIsGeneratingInvoice(true);
    try {
      const bytes = await generateInvoicePdf({ request, receipt });
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const blob = new Blob([buffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildInvoiceFilename({ request, receipt });
      link.click();
      URL.revokeObjectURL(url);
      setPayNotice({ tone: "success", text: "Invoice PDF generated." });
    } catch (error) {
      setPayNotice({ tone: "error", text: errorToMessage(error) });
    } finally {
      setIsGeneratingInvoice(false);
    }
  }

  async function handleCreateAttestation(request: PaymentRequest, receipt: Receipt) {
    try {
      const attestation = await createSettlementAttestation(request, receipt);
      setPayAttestation(attestation);
      setReceipts((current) =>
        current.map((r) =>
          r.requestId === receipt.requestId
            ? { ...r, attestationUid: attestation.uid, attestationFingerprint: attestation.fingerprint }
            : r
        )
      );
      setPayNotice({ tone: "success", text: `Settlement attested. VSR: ${attestation.uid}` });
      return attestation;
    } catch (error) {
      setPayNotice({ tone: "error", text: errorToMessage(error) });
      return undefined;
    }
  }

  function handleDownloadSettlementProof(request: PaymentRequest, receipt: Receipt) {
    try {
      const proof = generateSettlementProof(request, receipt, payAttestation);
      downloadSettlementProof(proof);
      setPayNotice({ tone: "success", text: "Settlement proof exported." });
    } catch (error) {
      setPayNotice({ tone: "error", text: errorToMessage(error) });
    }
  }

  function handleDownloadUBLInvoice(request: PaymentRequest, receipt: Receipt) {
    try {
      downloadUBLInvoice(request, receipt);
      setPayNotice({ tone: "success", text: "UBL invoice exported." });
    } catch (error) {
      setPayNotice({ tone: "error", text: errorToMessage(error) });
    }
  }

  async function refreshDirectBalances(transfer = buildTokenTransfer(directForm)) {
    if (!account) {
      return;
    }
    try {
      setDirectBalances(await readBalances(account, transfer));
    } catch (error) {
      setDirectNotice({ tone: "error", text: errorToMessage(error) });
    }
  }

  async function refreshPayBalances(request = payRequest) {
    if (!account || !request) {
      return;
    }
    try {
      setPayBalances(await readBalances(account, request));
    } catch (error) {
      setPayNotice({ tone: "error", text: errorToMessage(error) });
    }
  }

  async function copyValue(value: string, notice: (notice: Notice) => void) {
    await navigator.clipboard.writeText(value);
    notice({ tone: "success", text: "Copied." });
  }

  function handleSelectRequest(request: PaymentRequest) {
    setSelectedId(request.id);
    setPayEstimate(undefined);
    setPayLifecycle("idle");
    setPayNotice(undefined);
  }

  function handleExport() {
    const bundle = buildExportBundle(requests, receipts);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "disburse-qr-payments-export.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const bundle = parseExportBundle(await file.text());
      setRequests((current) => {
        const merged = [...current];
        for (const request of bundle.requests) {
          const index = merged.findIndex((item) => item.id === request.id);
          if (index === -1) {
            merged.push(request);
          } else {
            merged[index] = request;
          }
        }
        return merged;
      });
      setReceipts((current) => {
        const merged = [...current];
        for (const receipt of bundle.receipts) {
          const index = merged.findIndex((item) => item.txHash === receipt.txHash || item.requestId === receipt.requestId);
          if (index === -1) {
            merged.push(receipt);
          } else {
            merged[index] = receipt;
          }
        }
        return merged;
      });
      setQrNotice({ tone: "success", text: "Import complete." });
    } catch (error) {
      setQrNotice({ tone: "error", text: errorToMessage(error) });
    }
  }

  function handleNavigate(event: MouseEvent<HTMLAnchorElement>, target: string) {
    if (!getInternalTargetPath(target)) {
      return;
    }
    event.preventDefault();
    navigateTo(target);
  }

  function navigateTo(target: string) {
    const targetPath = getInternalTargetPath(target);
    if (!targetPath) {
      window.location.href = target;
      return;
    }
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== targetPath) {
      window.history.pushState(null, "", targetPath);
    }
    setPage(getInitialPage());
    setRouteKey(getCurrentRouteKey());
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function handleThemeToggle() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  const commonShellProps = {
    page,
    theme,
    account,
    chainId,
    expectedChainId: ARC_CHAIN_ID,
    expectedChainLabel: "Arc Testnet",
    isConnecting,
    onConnect: handleConnectWallet,
    onSwitch: handleSwitchNetwork,
    onNavigate: handleNavigate,
    onToggleTheme: handleThemeToggle
  };

  if (page === "landing") {
    return (
      <I18nProvider initialLang={appSettings.language} initialCurrency={appSettings.currency}>
        <LandingPage />
      </I18nProvider>
    );
  }

  // Documentation is rendered by DocsApp on the docs host (mounted standalone
  // in main.tsx, outside the wallet provider). It is never a route in this
  // shell — /docs redirects there before App mounts.

  // pay.disburse.online — the dedicated, mobile-first hosted payment page. A
  // scanned QR lands here and sees only a slim brand bar and a single payment
  // card, like a hosted invoice page. The entire console shell (sidebar,
  // header, hero) is skipped. All state/handlers are the same ones the in-app
  // /pay route uses; only the chrome and layout differ.
  if (isPaySurface(window.location.hostname) && page === "pay") {
    return (
      <I18nProvider initialLang={appSettings.language} initialCurrency={appSettings.currency}>
        <div className="pay-host">
          <header className="pay-host-bar">
            <a className="pay-host-brand" href="https://disburse.online">
              <img src="/favicon.png" alt="" aria-hidden="true" />
              <span>Disburse</span>
            </a>
            <div className="pay-host-bar-right">
              {account && (
                <span className="pay-host-wallet" title={account}>
                  <span className="pay-host-wallet-dot" aria-hidden="true" />
                  {shortAddress(account)}
                </span>
              )}
              <button
                type="button"
                className="pay-host-icon"
                onClick={handleThemeToggle}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <Moon size={16} strokeWidth={1.75} /> : <Sun size={16} strokeWidth={1.75} />}
              </button>
            </div>
          </header>
          <main className="pay-host-main">
            <HostedPayPage
              account={account}
              wrongChain={payWrongChain}
              hasWalletProvider={hasWalletProvider}
              request={payRequest}
              receipt={payReceipt}
              status={payDisplayStatus}
              balances={payBalances}
              estimate={payEstimate}
              notice={payNotice}
              walletNotice={walletNotice}
              now={now}
              isExpired={payIsExpired}
              isPayable={payIsPayable}
              insufficientToken={payInsufficientToken}
              missingGas={payMissingGas}
              isConnecting={isConnecting}
              isEstimating={isEstimatingPay}
              isPaying={isPayingQr}
              lifecycle={payLifecycle}
              isVerifying={isVerifying}
              isGeneratingInvoice={isGeneratingInvoice}
              onConnect={handleConnectWallet}
              onSwitch={handleSwitchNetwork}
              onEstimate={handlePayEstimate}
              onPay={handlePayQrRequest}
              onVerify={() => handleVerifyQrRequest(payRequest)}
              onInvoice={() => payRequest && payReceipt && downloadInvoicePdf(payRequest, payReceipt)}
              onAttest={() => payRequest && payReceipt && handleCreateAttestation(payRequest, payReceipt)}
              onSettlementProof={() => payRequest && payReceipt && handleDownloadSettlementProof(payRequest, payReceipt)}
              onUBLExport={() => payRequest && payReceipt && handleDownloadUBLInvoice(payRequest, payReceipt)}
              attestation={payAttestation}
              onCopy={(value) => copyValue(value, setPayNotice)}
            />
          </main>
        </div>
      </I18nProvider>
    );
  }

  // Docs render through DocsApp on the docs host, not this shell, so
  // routeMeta covers only the app-shell pages.
  type AppShellPage = Exclude<Page, "landing" | "docs">;
  const routeMeta: Record<AppShellPage, { title: string; subtitle: string }> = {
    dashboard:       { title: "Dashboard",      subtitle: "Requests, receipts and network health at a glance." },
    payments:        { title: "Send",           subtitle: "Pay a wallet address directly on Arc Testnet." },
    "qr-payments":   { title: "QR",             subtitle: "Create a QR invoice for someone else to scan and pay." },
    pay:             { title: "Pay request",    subtitle: "Review and settle a QR payment request." },
    "import-export": { title: "Import · Export", subtitle: "Back up or restore your requests and receipts." },
    statements:      { title: "Statements",     subtitle: "Generate settlement proof bundles for reconciliation." },
  };
  const { title: headerTitle, subtitle: headerSubtitle } = routeMeta[page as AppShellPage] ?? routeMeta.dashboard;

  return (
    <I18nProvider initialLang={appSettings.language} initialCurrency={appSettings.currency}>
    <div className="flex min-h-screen bg-[var(--shell-frame)] text-[var(--ink)] overflow-x-hidden relative md:h-dvh md:overflow-hidden">
      {/* Desktop sidebar — hidden on mobile, where the drawer takes over. */}
      <div className="hidden md:block">
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          setIsCollapsed={setIsSidebarCollapsed}
          page={page}
          onNavigate={handleNavigate}
          account={account}
        />
      </div>

      {/* Mobile nav drawer — slides in from the left on <md viewports. */}
      <SidePanel
        open={isNavOpen}
        onClose={() => setIsNavOpen(false)}
        side="left"
        width={280}
        scrim
        ariaLabel="Navigation"
        hideClose
      >
        <Sidebar
          isCollapsed={false}
          setIsCollapsed={() => {}}
          page={page}
          onNavigate={(e, target) => {
            handleNavigate(e, target);
            setIsNavOpen(false);
          }}
          account={account}
          inDrawer
        />
      </SidePanel>

      {/* Content sheet — the Linear/Dynamic pattern: everything except the
          sidebar lives on one rounded bordered surface inset 8px from the
          frame. Mobile keeps the plain full-bleed layout. */}
      <main className={cn("flex-1 flex flex-col transition-all duration-300 relative z-10 md:py-2 md:pr-2 md:pl-2", isSidebarCollapsed ? "md:ml-[56px]" : "md:ml-[240px]")}>
        <div className="flex min-h-0 flex-1 flex-col bg-[var(--paper)] md:overflow-hidden md:rounded-xl md:border md:border-[var(--line)]">
        <Header
          title={headerTitle}
          subtitle={headerSubtitle}
          account={account}
          chainId={chainId}
          expectedChainId={commonShellProps.expectedChainId}
          expectedChainLabel={commonShellProps.expectedChainLabel}
          isConnecting={isConnecting}
          onConnect={handleConnectWallet}
          onDisconnect={handleDisconnectWallet}
          onSwitch={commonShellProps.onSwitch}
          onToggleTheme={handleThemeToggle}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenNav={() => setIsNavOpen(true)}
          onOpenInbox={() => setIsInboxOpen(true)}
          inboxUnreadCount={inboxUnreadCount}
          theme={theme}
        />

        <InboxPanel
          open={isInboxOpen}
          onClose={() => setIsInboxOpen(false)}
          account={account}
          getProvider={getWalletProvider}
          onNavigate={navigateTo}
          onActivity={() => setInboxRefreshKey((key) => key + 1)}
        />

        <SettingsPanel
          open={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          theme={theme}
          onToggleTheme={handleThemeToggle}
          rpcStatusLabel={rpcStatusLabel}
          rpcBlockLabel={rpcBlockLabel}
          rpcHealthy={rpcHealth?.healthy}
        />

        <DepositPanel
          open={isDepositOpen}
          onClose={() => setIsDepositOpen(false)}
          account={account}
          chainId={chainId}
          getProvider={getWalletProvider}
        />
        
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6 relative">
          {page === "dashboard" && (
            <DashboardPage
              requests={requests}
              receipts={receipts}
              account={account}
              now={now}
              onNavigate={navigateTo}
              getProvider={getWalletProvider}
              onDeposit={() => setIsDepositOpen(true)}
            />
          )}
          {page === "payments" && (
            <PaymentsPage
              account={account}
              wrongChain={wrongChain}
              hasWalletProvider={hasWalletProvider}
              form={directForm}
              balances={directBalances}
              estimate={directEstimate}
              notice={directNotice}
              walletNotice={walletNotice}
              hash={directHash}
              insufficientToken={directInsufficientToken}
              missingGas={directMissingGas}
              isConnecting={isConnecting}
              isEstimating={isEstimatingDirect}
              isSending={isSendingDirect}
              onFormChange={(next) => {
                setDirectForm(next);
                setDirectEstimate(undefined);
                setDirectBalances(undefined);
                setDirectHash(undefined);
              }}
              onConnect={handleConnectWallet}
              onSwitch={handleSwitchNetwork}
              onEstimate={handleDirectEstimate}
              onSend={handleDirectSend}
              onCopy={(value) => copyValue(value, setDirectNotice)}
              onNavigate={navigateTo}
            />
          )}
          {page === "qr-payments" && (
            <QrPaymentsPage
              account={account}
              form={qrForm}
              selectedRequest={selectedRequest}
              selectedReceipt={selectedReceipt}
              requests={requests}
              receipts={receipts}
              shareUrl={shareUrl}
              qrDataUrl={qrDataUrl}
              notice={qrNotice}
              now={now}
              isCreating={isCreatingQr}
              importInputRef={importInputRef}
              onFormChange={setQrForm}
              onSubmit={handleCreateQrRequest}
              onSelectRequest={handleSelectRequest}
              onCopy={(value) => copyValue(value, setQrNotice)}
              onExport={handleExport}
              onImport={handleImport}
            />
          )}
          {page === "pay" && (
            <PayRequestPage
              account={account}
              wrongChain={payWrongChain}
              hasWalletProvider={hasWalletProvider}
              request={payRequest}
              receipt={payReceipt}
              status={payDisplayStatus}
              balances={payBalances}
              estimate={payEstimate}
              notice={payNotice}
              walletNotice={walletNotice}
              now={now}
              isExpired={payIsExpired}
              isPayable={payIsPayable}
              insufficientToken={payInsufficientToken}
              missingGas={payMissingGas}
              isConnecting={isConnecting}
              isEstimating={isEstimatingPay}
              isPaying={isPayingQr}
              lifecycle={payLifecycle}
              isVerifying={isVerifying}
              isGeneratingInvoice={isGeneratingInvoice}
              onConnect={handleConnectWallet}
              onSwitch={handleSwitchNetwork}
              onEstimate={handlePayEstimate}
              onPay={handlePayQrRequest}
              onVerify={() => handleVerifyQrRequest(payRequest)}
              onInvoice={() => payRequest && payReceipt && downloadInvoicePdf(payRequest, payReceipt)}
              onAttest={() => payRequest && payReceipt && handleCreateAttestation(payRequest, payReceipt)}
              onSettlementProof={() => payRequest && payReceipt && handleDownloadSettlementProof(payRequest, payReceipt)}
              onUBLExport={() => payRequest && payReceipt && handleDownloadUBLInvoice(payRequest, payReceipt)}
              attestation={payAttestation}
              onCopy={(value) => copyValue(value, setPayNotice)}
            />
          )}
          {page === "import-export" && (
            <ImportExportPage
              requests={requests}
              receipts={receipts}
              importInputRef={importInputRef}
              onExport={handleExport}
              onImport={handleImport}
            />
          )}
          {page === "statements" && <StatementsPage />}
        </div>
        </div>
      </main>
    </div>
    </I18nProvider>
  );
}

function PaymentsPage({
  account,
  wrongChain,
  hasWalletProvider,
  form,
  balances,
  estimate,
  notice,
  walletNotice,
  hash,
  insufficientToken,
  missingGas,
  isConnecting,
  isEstimating,
  isSending,
  onFormChange,
  onConnect,
  onSwitch,
  onEstimate,
  onSend,
  onCopy,
  onNavigate
}: {
  account?: `0x${string}`;
  wrongChain: boolean;
  hasWalletProvider: boolean;
  form: DirectFormState;
  balances?: Balances;
  estimate?: TransferEstimate;
  notice?: Notice;
  walletNotice?: Notice;
  hash?: Hash;
  insufficientToken: boolean;
  missingGas: boolean;
  isConnecting: boolean;
  isEstimating: boolean;
  isSending: boolean;
  onFormChange: (next: DirectFormState) => void;
  onConnect: () => void;
  onSwitch: () => void;
  onEstimate: () => void;
  onSend: () => void;
  onCopy: (value: string) => void;
  onNavigate: (target: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <section className="workbench" aria-label={t("directTransferTitle")}>
        <div className="desk-grid single-flow-grid">
          <section className="desk-pane" aria-labelledby="direct-form-heading">
            <PaneTitle id="direct-form-heading" label={t("paymentDetails")} />
            <form className="form-stack" onSubmit={(event) => event.preventDefault()}>
              <Field label={t("recipient")} helper={t("recipientHelper")}>
                <input
                  value={form.recipient}
                  onChange={(event) => onFormChange({ ...form, recipient: event.target.value })}
                  placeholder="0x... or @name"
                  spellCheck={false}
                />
                <HandleHint
                  value={form.recipient}
                  onApply={(address) => onFormChange({ ...form, recipient: address })}
                />
              </Field>

              <div className="field-grid">
                <Field label={t("token")}>
                  <select
                    value={form.token}
                    onChange={(event) => onFormChange({ ...form, token: event.target.value as PaymentToken })}
                  >
                    <option value="USDC">USDC</option>
                    <option value="EURC">EURC</option>
                  </select>
                </Field>
                <Field label={t("amount")}>
                  <input
                    value={form.amount}
                    onChange={(event) => onFormChange({ ...form, amount: event.target.value })}
                    inputMode="decimal"
                    placeholder="125.50"
                  />
                </Field>
              </div>

              <WalletActionBlock
                account={account}
                wrongChain={wrongChain}
                hasWalletProvider={hasWalletProvider}
                isConnecting={isConnecting}
                walletNotice={walletNotice}
                onConnect={onConnect}
                onSwitch={onSwitch}
              />

              {account && !wrongChain && (
                <TransferState
                  account={account}
                  token={form.token}
                  balances={balances}
                  insufficientToken={insufficientToken}
                  missingGas={missingGas}
                />
              )}

              <div className="action-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onEstimate}
                  disabled={!account || wrongChain || isEstimating}
                >
                  {isEstimating ? t("estimating") : t("estimate")}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={onSend}
                  disabled={!account || wrongChain || insufficientToken || missingGas || isSending}
                >
                  {isSending ? t("sending") : t("sendPayment")}
                </button>
              </div>
            </form>

            {notice && <NoticeBar notice={notice} />}
          </section>

          <section className="desk-pane pay-pane" aria-labelledby="direct-summary-heading">
            <PaneTitle id="direct-summary-heading" label={t("transferSummary")} />
            <PaymentPreview
              title={t("directPayment")}
              amount={form.amount || "0"}
              token={form.token}
              recipient={form.recipient}
            />

            {estimate && <EstimateGrid estimate={estimate} />}

            {hash && (
              <div className="receipt-line">
                <div>
                  <span>{t("transaction")}</span>
                  <strong>{shortAddress(hash, 10, 8)}</strong>
                </div>
                <div className="receipt-actions">
                  <button className="text-button" type="button" onClick={() => onCopy(toExplorerTxUrl(hash))}>
                    {t("copyTx")}
                  </button>
                  <a href={toExplorerTxUrl(hash)} target="_blank" rel="noreferrer">
                    {t("openTx")}
                  </a>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>
    </>
  );
}

function StageStrip({ stage, steps }: { stage: number; steps: string[] }) {
  return (
    <div className="stage-strip" role="list" aria-label={`${steps[0]} → ${steps[steps.length - 1]}`}>
      {steps.map((label, idx) => {
        const status = idx < stage ? "done" : idx === stage ? "active" : "";
        const ariaCurrent = idx === stage ? "step" : undefined;
        return (
          <div
            key={label}
            role="listitem"
            aria-current={ariaCurrent}
            className={cx("stage-step", status || false)}
          >
            <span className="stage-step-dot" aria-hidden="true">
              {idx < stage ? "✓" : String(idx + 1)}
            </span>
            <div className="stage-step-label">
              <strong>{label}</strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function computePayStage(
  account: `0x${string}` | undefined,
  wrongChain: boolean,
  request: PaymentRequest | undefined,
  receipt: Receipt | undefined,
  lifecycle: PayLifecycle
): number {
  if (receipt || request?.status === "paid") return 3;
  if (
    request?.txHash ||
    lifecycle === "submitted" ||
    lifecycle === "confirming" ||
    lifecycle === "proving" ||
    lifecycle === "settling"
  )
    return 2;
  if (lifecycle === "awaiting_wallet" || lifecycle === "preparing") return 1;
  if (!account || wrongChain) return 0;
  return 1;
}

function LedgerRowCompact({
  request,
  receipt,
  isSelected,
  now,
  onSelect,
  onCopy
}: {
  request: PaymentRequest;
  receipt?: Receipt;
  isSelected: boolean;
  now: Date;
  onSelect: () => void;
  onCopy: (value: string) => void;
}) {
  const { t } = useI18n();
  const requestUrl = buildShareUrl(request, getPayShareOrigin());
  const displayRequest = refreshDerivedStatus(request, now);

  return (
    <article
      className={cx("ledger-row-compact", isSelected && "selected")}
      role="button"
      tabIndex={0}
      aria-label={`${request.label} — ${request.amount} ${request.token}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className={cx("status-dot", displayRequest.status)} aria-hidden="true" />
      <span className="ledger-row-compact-label">{request.label}</span>
      <span className="ledger-row-compact-amount">
        {request.amount} {request.token}
      </span>
      <span className="ledger-row-compact-meta">
        {shortAddress(request.recipient)} · {formatInvoiceDate(request.invoiceDate)}
      </span>
      <div
        className="ledger-row-compact-actions"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="text-button" type="button" onClick={() => onCopy(requestUrl)}>
          {t("copy")}
        </button>
        <a className="text-button" href={requestUrl}>
          {t("payPage")}
        </a>
        {receipt && (
          <a className="text-button" href={receipt.explorerUrl} target="_blank" rel="noreferrer">
            {t("receipt")}
          </a>
        )}
      </div>
    </article>
  );
}

function QrPaymentsPage({
  account,
  form,
  selectedRequest,
  selectedReceipt,
  requests,
  receipts,
  shareUrl,
  qrDataUrl,
  notice,
  now,
  isCreating,
  importInputRef,
  onFormChange,
  onSubmit,
  onSelectRequest,
  onCopy,
  onExport,
  onImport
}: {
  account?: `0x${string}`;
  form: QrFormState;
  selectedRequest?: PaymentRequest;
  selectedReceipt?: Receipt;
  requests: PaymentRequest[];
  receipts: Receipt[];
  shareUrl: string;
  qrDataUrl: string;
  notice?: Notice;
  now: Date;
  isCreating: boolean;
  importInputRef: RefObject<HTMLInputElement | null>;
  onFormChange: (next: QrFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSelectRequest: (request: PaymentRequest) => void;
  onCopy: (value: string) => void;
  onExport: () => void;
  onImport: (file: File | undefined) => void;
}) {
  const { t } = useI18n();
  const displayRequest = selectedRequest ? refreshDerivedStatus(selectedRequest, now) : undefined;
  const qrIsFinal = displayRequest ? shouldHideQrForStatus(displayRequest.status) : false;
  const hasFormInput = Boolean(form.recipient || form.amount || form.label || form.note || form.notify);

  return (
    <>
      <section className="workbench" aria-label={t("generateQr")}>
        <div className="desk-grid">
          <section className="desk-pane create-pane" aria-label={t("requestDetails")}>
            <form className="form-stack" onSubmit={onSubmit}>
              <Field label={t("recipient")}>
                <div className="input-row">
                  <input
                    value={form.recipient}
                    onChange={(event) => onFormChange({ ...form, recipient: event.target.value })}
                    placeholder="0x... or @name"
                    spellCheck={false}
                  />
                  <button
                    className="utility-button"
                    type="button"
                    aria-label={t("useConnectedWallet")}
                    title={t("useConnectedWallet")}
                    onClick={() => account && onFormChange({ ...form, recipient: account })}
                    disabled={!account}
                  >
                    {t("me")}
                  </button>
                </div>
                <HandleHint
                  value={form.recipient}
                  onApply={(address) => onFormChange({ ...form, recipient: address })}
                />
              </Field>

              <div className="field-grid">
                <Field label={t("amount")}>
                  <input
                    value={form.amount}
                    onChange={(event) => onFormChange({ ...form, amount: event.target.value })}
                    inputMode="decimal"
                    placeholder="10"
                  />
                </Field>
                <Field label={t("token")}>
                  <input value="USDC" readOnly aria-readonly="true" />
                </Field>
              </div>

              <Field label={t("label")}>
                <input
                  value={form.label}
                  onChange={(event) => onFormChange({ ...form, label: event.target.value })}
                  placeholder="Invoice 2"
                />
              </Field>

              <Field label={t("note")}>
                <textarea
                  value={form.note}
                  onChange={(event) => onFormChange({ ...form, note: event.target.value })}
                  placeholder="Food and Drink"
                  rows={3}
                />
              </Field>

              <Field label={t("invoiceDate")}>
                <DateInput
                  value={form.invoiceDate}
                  onChange={(iso) => onFormChange({ ...form, invoiceDate: iso })}
                />
              </Field>

              <Field label={t("qrNotify")} helper={t("qrNotifyHelper")}>
                <input
                  value={form.notify}
                  onChange={(event) => onFormChange({ ...form, notify: event.target.value })}
                  placeholder="@name"
                  spellCheck={false}
                  maxLength={17}
                />
              </Field>

              <button className="primary-button primary-button--lg" type="submit" disabled={isCreating}>
                {isCreating ? t("generating") : t("generateQr")}
              </button>
            </form>

            {notice && <NoticeBar notice={notice} />}
          </section>

          <section className="desk-pane pay-pane" aria-label={t("qrOutput")}>
            {displayRequest && shareUrl ? (
              <>
                {!(selectedReceipt || displayRequest.txHash) && (
                  <>
                    <PaymentPreview
                      title={displayRequest.label}
                      note={displayRequest.note ?? t("noNote")}
                      amount={displayRequest.amount}
                      token={displayRequest.token}
                      recipient={displayRequest.recipient}
                      invoiceDate={displayRequest.invoiceDate}
                      status={displayRequest.status}
                    />
                    {qrIsFinal ? (
                      <QrFinalState request={displayRequest} receipt={selectedReceipt} />
                    ) : (
                      <QrShareCard
                        request={displayRequest}
                        qrDataUrl={qrDataUrl || undefined}
                        shareUrl={shareUrl}
                        liveStatusLabel={formatQrLiveStatus(displayRequest)}
                        onCopy={onCopy}
                        onDownload={
                          qrDataUrl
                            ? () => {
                                const a = document.createElement("a");
                                a.href = qrDataUrl;
                                a.download = `${displayRequest.label || "qr"}.png`;
                                a.click();
                              }
                            : undefined
                        }
                      />
                    )}
                  </>
                )}

                {selectedReceipt && (
                  <ReceiptView
                    data={{
                      request: displayRequest,
                      receipt: selectedReceipt,
                      attestation: selectedReceipt
                        ? {
                            uid: selectedReceipt.attestationUid,
                            fingerprint: selectedReceipt.attestationFingerprint,
                          }
                        : undefined,
                      onCopy,
                      onCopyFingerprint: onCopy,
                    }}
                  >
                    {selectedReceipt && <ReceiptView.Summary />}
                    <ReceiptView.Timeline />
                    {selectedReceipt && <ReceiptView.Proof />}
                  </ReceiptView>
                )}
              </>
            ) : hasFormInput ? (
              <PaymentPreview
                title={form.label || t("requestDetails")}
                note={form.note || t("noNote")}
                amount={form.amount || "0"}
                token={form.token}
                recipient={form.recipient || ""}
                invoiceDate={form.invoiceDate}
              />
            ) : (
              <p className="pay-pane-hint">
                <strong>{t("flowHintLead")}</strong>
                {t("noQrGeneratedText")}
              </p>
            )}
          </section>
        </div>
      </section>

      <section id="qr-ledger" className="ledger-section" aria-label={t("qrLedger")}>
        <div className="ledger-toolbar">
          <span className="ledger-toolbar-label">
            {t("qrRequestsStored", { count: requests.length })}
          </span>
          <div className="tool-actions">
            <button
              className="text-button"
              type="button"
              onClick={onExport}
              disabled={!requests.length}
            >
              {t("export")}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => importInputRef.current?.click()}
            >
              {t("import")}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={(event) => onImport(event.target.files?.[0])}
            />
          </div>
        </div>

        {requests.length ? (
          <div className="ledger-list">
            {requests.map((request) => {
              const receipt = receipts.find((item) => item.requestId === request.id);
              return (
                <LedgerRowCompact
                  key={request.id}
                  request={request}
                  receipt={receipt}
                  isSelected={request.id === selectedRequest?.id}
                  now={now}
                  onSelect={() => onSelectRequest(request)}
                  onCopy={onCopy}
                />
              );
            })}
          </div>
        ) : (
          <EmptyState title={t("qrLedgerEmpty")} text={t("qrLedgerEmptyText")} />
        )}
      </section>
    </>
  );
}

function PayRequestPage({
  account,
  wrongChain,
  hasWalletProvider,
  request,
  receipt,
  status,
  balances,
  estimate,
  notice,
  walletNotice,
  now,
  isExpired,
  isPayable,
  insufficientToken,
  missingGas,
  isConnecting,
  isEstimating,
  isPaying,
  lifecycle,
  isVerifying,
  isGeneratingInvoice,
  onConnect,
  onSwitch,
  onEstimate,
  onPay,
  onVerify,
  onInvoice,
  onAttest,
  onSettlementProof,
  onUBLExport,
  attestation,
  onCopy
}: {
  account?: `0x${string}`;
  wrongChain: boolean;
  hasWalletProvider: boolean;
  request?: PaymentRequest;
  receipt?: Receipt;
  status: PaymentStatus;
  balances?: Balances;
  estimate?: TransferEstimate;
  notice?: Notice;
  walletNotice?: Notice;
  now: Date;
  isExpired: boolean;
  isPayable: boolean;
  insufficientToken: boolean;
  missingGas: boolean;
  isConnecting: boolean;
  isEstimating: boolean;
  isPaying: boolean;
  lifecycle: PayLifecycle;
  isVerifying: boolean;
  isGeneratingInvoice: boolean;
  onConnect: () => void;
  onSwitch: () => void;
  onEstimate: () => void;
  onPay: () => void;
  onVerify: () => void;
  onInvoice: () => void;
  onAttest?: () => void;
  onSettlementProof?: () => void;
  onUBLExport?: () => void;
  attestation?: SettlementAttestation;
  onCopy: (value: string) => void;
}) {
  const { t } = useI18n();
  const hasSubmittedTransaction = Boolean(request?.txHash && request.status !== "paid");
  const submittedTxHash = request?.txHash;
  const submittedTxUrl = submittedTxHash ? toExplorerTxUrl(submittedTxHash) : undefined;
  const payButtonLabel = getPayButtonLabel(isPaying, lifecycle, t);
  const isFinal = status === "paid" || status === "expired" || status === "failed";
  const showExpiryGrid = Boolean(request) && !isFinal;
  const hasResultBlock = Boolean(submittedTxHash || receipt || request?.txHash);
  const payStage = computePayStage(account, wrongChain, request, receipt, lifecycle);

  return (
    <>
      <section className="workbench pay-request-shell" aria-label={t("paymentRequestTitle")}>
        {request && (
          <StageStrip
            stage={payStage}
            steps={[t("connect"), t("paySign"), t("stageSettle"), t("verified")]}
          />
        )}

        {request ? (
          <div className="desk-grid">
            <section className="desk-pane create-pane" aria-labelledby="locked-details-heading">
              <PaneTitle id="locked-details-heading" label={t("lockedDetails")} />
              <PaymentPreview
                title={request.label}
                note={request.note ?? t("noNote")}
                amount={request.amount}
                token={request.token}
                recipient={request.recipient}
                invoiceDate={request.invoiceDate}
                status={status}
              />
              {showExpiryGrid && (
                <div className="expiry-grid">
                  <Metric label={t("timeLeft")} value={formatTimeLeft(request, now)} />
                  <Metric label={t("validUntil")} value={formatDateTime(request.expiresAt ?? request.dueAt)} />
                </div>
              )}
            </section>

            <section className="desk-pane pay-pane" aria-labelledby="pay-actions-heading">
              <PaneTitle id="pay-actions-heading" label={t("payWithWallet")} />

              {(walletNotice ||
                (!account && !hasWalletProvider) ||
                (isExpired && !isPayable) ||
                hasSubmittedTransaction) && (
                <div className="form-section">
                  {walletNotice && <NoticeBar notice={walletNotice} compact />}
                  {!account && !hasWalletProvider && (
                    <NoticeBar
                      compact
                      notice={{ tone: "info", text: t("noWalletRequest") }}
                    />
                  )}
                  {isExpired && !isPayable && (
                    <NoticeBar compact notice={{ tone: "error", text: t("qrExpiredNotice") }} />
                  )}
                  {hasSubmittedTransaction && (
                    <NoticeBar compact notice={{ tone: "info", text: t("txSavedNotice") }} />
                  )}
                </div>
              )}

              <div className="form-section">
                <WalletActionBlock
                  account={account}
                  wrongChain={wrongChain}
                  hasWalletProvider={hasWalletProvider}
                  isConnecting={isConnecting}
                  walletNotice={undefined}
                  onConnect={onConnect}
                  onSwitch={onSwitch}
                  switchLabel={t("switchToNetwork", { network: "Arc Testnet" })}
                />

                {account && !wrongChain && (
                  <TransferState
                    account={account}
                    token={request.token}
                    balances={balances}
                    insufficientToken={insufficientToken}
                    missingGas={missingGas}
                    networkLabel="Arc Testnet"
                    nativeSymbol="USDC"
                  />
                )}
              </div>

              <div className="form-section">
                <div className="pay-action-block">
                  <div className="pay-action-aux">
                    <button
                      className="text-button"
                      type="button"
                      onClick={onEstimate}
                      disabled={!account || wrongChain || !isPayable || isEstimating}
                    >
                      {isEstimating ? t("estimating") : t("calculateGas")}
                    </button>
                    {(submittedTxHash || receipt) && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={onVerify}
                        disabled={isVerifying}
                      >
                        {isVerifying ? t("verifying") : t("verify")}
                      </button>
                    )}
                  </div>
                  <button
                    className="primary-button primary-button--lg"
                    type="button"
                    onClick={onPay}
                    disabled={
                      !account ||
                      wrongChain ||
                      !isPayable ||
                      insufficientToken ||
                      missingGas ||
                      isPaying ||
                      hasSubmittedTransaction ||
                      request.status === "paid"
                    }
                  >
                    {payButtonLabel}
                  </button>
                </div>

                {estimate && <EstimateGrid estimate={estimate} />}
                {notice && <NoticeBar notice={notice} />}
              </div>

              {hasResultBlock && (
                <div className="form-section">
                  {(request.txHash || receipt) && (
                    <ReceiptView
                      data={{
                        request,
                        receipt,
                        attestation: receipt
                          ? {
                              uid: attestation?.uid ?? receipt.attestationUid,
                              fingerprint: attestation?.fingerprint ?? receipt.attestationFingerprint,
                            }
                          : undefined,
                        onCopy,
                        onCopyFingerprint: onCopy,
                        onExportPdf: receipt && !isGeneratingInvoice ? onInvoice : undefined,
                        onExportUbl: receipt ? onUBLExport : undefined,
                      }}
                    >
                      {receipt && <ReceiptView.Summary />}
                      <ReceiptView.Timeline />
                      {receipt && <ReceiptView.Proof />}
                    </ReceiptView>
                  )}

                  {submittedTxHash && !receipt && (
                    <div className="receipt-line">
                      <div>
                        <span>{t("submittedTransaction")}</span>
                        <strong>{shortAddress(submittedTxHash, 10, 8)}</strong>
                      </div>
                      <div className="receipt-actions">
                        <button className="text-button" type="button" onClick={() => submittedTxUrl && onCopy(submittedTxUrl)}>
                          {t("copyTx")}
                        </button>
                        <a href={submittedTxUrl} target="_blank" rel="noreferrer">
                          {t("openTx")}
                        </a>
                      </div>
                    </div>
                  )}

                  {receipt && (
                <>

                  {/* Compliance Export Actions */}
                  <div className="compliance-actions">
                    <div className="compliance-header">
                      <span className="compliance-label">{t("settlementExports")}</span>
                      {attestation && (
                        <span className="attestation-badge">
                          VSR: {attestation.uid}
                        </span>
                      )}
                    </div>
                    <div className="compliance-buttons">
                      {!attestation && onAttest && (
                        <button className="compliance-button" type="button" onClick={onAttest}>
                          <ShieldCheck size={14} strokeWidth={1.5} />
                          {t("createAttestation")}
                        </button>
                      )}
                      {attestation && (
                        <button className="compliance-button attested" type="button" disabled>
                          <Check size={14} strokeWidth={1.75} />
                          {t("attested")}
                        </button>
                      )}
                      {onSettlementProof && (
                        <button className="compliance-button" type="button" onClick={onSettlementProof}>
                          <FileText size={14} strokeWidth={1.5} />
                          {t("settlementProof")}
                        </button>
                      )}
                      {onUBLExport && (
                        <button className="compliance-button" type="button" onClick={onUBLExport}>
                          <Download size={14} strokeWidth={1.5} />
                          {t("ublInvoiceXml")}
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
                </div>
              )}
            </section>
          </div>
        ) : (
          <EmptyState title={t("noQrRequestLoaded")} text={t("noQrRequestLoadedText")} />
        )}
      </section>
    </>
  );
}

// Mobile-first hosted payment view rendered on the pay.* subdomain. It reuses
// the exact props (and therefore state/handlers) of PayRequestPage, but lays
// the flow out as a single Stripe-style invoice card instead of the desktop
// two-pane workbench. Compliance exports are tucked into a collapsed section
// so they never compete with the primary Pay action on a phone.
function HostedPayPage(props: ComponentProps<typeof PayRequestPage>) {
  const {
    account,
    wrongChain,
    hasWalletProvider,
    request,
    receipt,
    status,
    balances,
    estimate,
    notice,
    walletNotice,
    now,
    isExpired,
    isPayable,
    insufficientToken,
    missingGas,
    isConnecting,
    isEstimating,
    isPaying,
    lifecycle,
    isVerifying,
    isGeneratingInvoice,
    onConnect,
    onSwitch,
    onEstimate,
    onPay,
    onVerify,
    onInvoice,
    onAttest,
    onSettlementProof,
    onUBLExport,
    attestation,
    onCopy
  } = props;
  const { t } = useI18n();

  if (!request) {
    return (
      <div className="pay-host-card">
        <EmptyState title={t("noQrRequestLoaded")} text={t("noQrRequestLoadedText")} />
      </div>
    );
  }

  const hasSubmittedTransaction = Boolean(request.txHash && request.status !== "paid");
  const submittedTxHash = request.txHash;
  const submittedTxUrl = submittedTxHash ? toExplorerTxUrl(submittedTxHash) : undefined;
  const payButtonLabel = getPayButtonLabel(isPaying, lifecycle, t);
  const isFinal = status === "paid" || status === "expired" || status === "failed";
  const showExpiryGrid = !isFinal;
  const hasResultBlock = Boolean(submittedTxHash || receipt || request.txHash);
  const payStage = computePayStage(account, wrongChain, request, receipt, lifecycle);

  return (
    <div className="pay-host-card">
      <PaymentPreview
        title={request.label}
        note={request.note ?? t("noNote")}
        amount={request.amount}
        token={request.token}
        recipient={request.recipient}
        invoiceDate={request.invoiceDate}
        status={status}
      />

      {showExpiryGrid && (
        <div className="expiry-grid">
          <Metric label={t("timeLeft")} value={formatTimeLeft(request, now)} />
          <Metric label={t("validUntil")} value={formatDateTime(request.expiresAt ?? request.dueAt)} />
        </div>
      )}

      <p className="pay-host-locknote">{t("paymentRequestNote")}</p>

      <StageStrip stage={payStage} steps={[t("connect"), t("paySign"), t("stageSettle"), t("verified")]} />

      <div className="pay-host-section">
        {walletNotice && <NoticeBar notice={walletNotice} compact />}
        {!account && !hasWalletProvider && (
          <NoticeBar compact notice={{ tone: "info", text: t("noWalletRequest") }} />
        )}
        {isExpired && !isPayable && (
          <NoticeBar compact notice={{ tone: "error", text: t("qrExpiredNotice") }} />
        )}
        {hasSubmittedTransaction && (
          <NoticeBar compact notice={{ tone: "info", text: t("txSavedNotice") }} />
        )}

        <WalletActionBlock
          account={account}
          wrongChain={wrongChain}
          hasWalletProvider={hasWalletProvider}
          isConnecting={isConnecting}
          walletNotice={undefined}
          onConnect={onConnect}
          onSwitch={onSwitch}
          switchLabel={t("switchToNetwork", { network: "Arc Testnet" })}
        />

        {account && !wrongChain && (
          <TransferState
            account={account}
            token={request.token}
            balances={balances}
            insufficientToken={insufficientToken}
            missingGas={missingGas}
            networkLabel="Arc Testnet"
            nativeSymbol="USDC"
          />
        )}
      </div>

      <div className="pay-host-section pay-host-pay">
        <button
          className="primary-button primary-button--lg pay-host-cta"
          type="button"
          onClick={onPay}
          disabled={
            !account ||
            wrongChain ||
            !isPayable ||
            insufficientToken ||
            missingGas ||
            isPaying ||
            hasSubmittedTransaction ||
            request.status === "paid"
          }
        >
          {payButtonLabel}
        </button>
        <div className="pay-host-aux">
          <button
            className="text-button"
            type="button"
            onClick={onEstimate}
            disabled={!account || wrongChain || !isPayable || isEstimating}
          >
            {isEstimating ? t("estimating") : t("calculateGas")}
          </button>
          {(submittedTxHash || receipt) && (
            <button className="text-button" type="button" onClick={onVerify} disabled={isVerifying}>
              {isVerifying ? t("verifying") : t("verify")}
            </button>
          )}
        </div>
        {estimate && <EstimateGrid estimate={estimate} />}
        {notice && <NoticeBar notice={notice} />}
      </div>

      {hasResultBlock && (
        <div className="pay-host-section">
          {(request.txHash || receipt) && (
            <ReceiptView
              data={{
                request,
                receipt,
                attestation: receipt
                  ? {
                      uid: attestation?.uid ?? receipt.attestationUid,
                      fingerprint: attestation?.fingerprint ?? receipt.attestationFingerprint
                    }
                  : undefined,
                onCopy,
                onCopyFingerprint: onCopy,
                onExportPdf: receipt && !isGeneratingInvoice ? onInvoice : undefined,
                onExportUbl: receipt ? onUBLExport : undefined
              }}
            >
              {receipt && <ReceiptView.Summary />}
              <ReceiptView.Timeline />
              {receipt && <ReceiptView.Proof />}
            </ReceiptView>
          )}

          {submittedTxHash && !receipt && (
            <div className="receipt-line">
              <div>
                <span>{t("submittedTransaction")}</span>
                <strong>{shortAddress(submittedTxHash, 10, 8)}</strong>
              </div>
              <div className="receipt-actions">
                <button className="text-button" type="button" onClick={() => submittedTxUrl && onCopy(submittedTxUrl)}>
                  {t("copyTx")}
                </button>
                <a href={submittedTxUrl} target="_blank" rel="noreferrer">
                  {t("openTx")}
                </a>
              </div>
            </div>
          )}

          {receipt && (
            <details className="pay-host-exports">
              <summary>
                <span>{t("settlementExports")}</span>
                {attestation && <span className="attestation-badge">VSR: {attestation.uid}</span>}
              </summary>
              <div className="compliance-buttons">
                {!attestation && onAttest && (
                  <button className="compliance-button" type="button" onClick={onAttest}>
                    <ShieldCheck size={14} strokeWidth={1.5} />
                    {t("createAttestation")}
                  </button>
                )}
                {attestation && (
                  <button className="compliance-button attested" type="button" disabled>
                    <Check size={14} strokeWidth={1.75} />
                    {t("attested")}
                  </button>
                )}
                {onSettlementProof && (
                  <button className="compliance-button" type="button" onClick={onSettlementProof}>
                    <FileText size={14} strokeWidth={1.5} />
                    {t("settlementProof")}
                  </button>
                )}
                {onUBLExport && (
                  <button className="compliance-button" type="button" onClick={onUBLExport}>
                    <Download size={14} strokeWidth={1.5} />
                    {t("ublInvoiceXml")}
                  </button>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentPreview({
  title,
  note,
  amount,
  token,
  recipient,
  invoiceDate,
  status
}: {
  title: string;
  note?: string;
  amount: string;
  token: PaymentToken;
  recipient: string;
  invoiceDate?: string;
  status?: PaymentStatus;
}) {
  const { t } = useI18n();
  return (
    <div className="request-summary">
      <div>
        {status && <StatusBadge status={status} />}
        <h3>{title}</h3>
        {note && <p>{note}</p>}
      </div>
      <div className="amount-lockup">
        <strong>
          {amount || "0"} {token}
        </strong>
        <span>{recipient ? shortAddress(recipient) : t("recipientNotSet")}</span>
      </div>
      {invoiceDate && (
        <div className="expiry-grid">
          <Metric label={t("invoiceDate")} value={formatInvoiceDate(invoiceDate)} />
        </div>
      )}
    </div>
  );
}

function QrFinalState({ request, receipt }: { request: PaymentRequest; receipt?: Receipt }) {
  const { t } = useI18n();
  const copy =
    request.status === "paid"
      ? {
          title: t("paymentConfirmed"),
          text: t("paymentConfirmedText")
        }
      : request.status === "failed"
        ? {
            title: t("paymentFailed"),
            text: t("paymentFailedText")
          }
        : {
            title: t("qrExpired"),
            text: t("qrExpiredText")
          };

  return (
    <div className={`qr-final-state ${request.status}`} aria-live="polite">
      <span className="qr-final-mark" aria-hidden="true" />
      <div>
        <strong>{copy.title}</strong>
        <p>{copy.text}</p>
        {receipt && (
          <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
            {t("openReceipt")}
          </a>
        )}
      </div>
    </div>
  );
}

function WalletActionBlock({
  account,
  wrongChain,
  hasWalletProvider,
  isConnecting,
  walletNotice,
  onConnect,
  onSwitch,
  switchLabel = "Switch to Arc"
}: {
  account?: string;
  wrongChain: boolean;
  hasWalletProvider: boolean;
  isConnecting: boolean;
  walletNotice?: Notice;
  onConnect: () => void;
  onSwitch: () => void;
  switchLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <>
      {walletNotice && <NoticeBar notice={walletNotice} compact />}
      {!account && !hasWalletProvider && (
        <NoticeBar
          compact
          notice={{
            tone: "info",
            text: t("noWalletPage")
          }}
        />
      )}
      {!account && (
        <button className="primary-button" type="button" onClick={onConnect} disabled={isConnecting}>
          {isConnecting ? t("connecting") : t("connectWallet")}
        </button>
      )}
      {account && wrongChain && (
        <button className="danger-button" type="button" onClick={onSwitch} disabled={isConnecting}>
          {switchLabel}
        </button>
      )}
    </>
  );
}

function TransferState({
  account,
  token,
  balances,
  insufficientToken,
  missingGas,
  networkLabel = "Arc Testnet",
  nativeSymbol = "USDC"
}: {
  account: `0x${string}`;
  token: PaymentToken;
  balances?: Balances;
  insufficientToken: boolean;
  missingGas: boolean;
  networkLabel?: string;
  nativeSymbol?: string;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="wallet-table">
        <Metric label={t("wallet")} value={shortAddress(account)} />
        <Metric label={t("tokenBalance", { token })} value={balances ? `${trimDisplay(balances.tokenBalance, 6)} ${token}` : t("loading")} />
        <Metric label={t("gasBalance")} value={balances ? `${trimDisplay(balances.nativeGas, 8)} ${nativeSymbol}` : t("loading")} />
        <Metric label={t("network")} value={networkLabel} />
      </div>
      {insufficientToken && <NoticeBar compact notice={{ tone: "error", text: t("insufficientTokenBalance", { token }) }} />}
      {(insufficientToken || missingGas) && (
        <RecoveryPanel
          account={account}
          token={token}
          insufficientToken={insufficientToken}
          missingGas={missingGas}
          networkLabel={networkLabel}
          nativeSymbol={nativeSymbol}
        />
      )}
    </>
  );
}

function EstimateGrid({ estimate }: { estimate: TransferEstimate }) {
  const { t } = useI18n();
  const symbol = estimate.nativeSymbol ?? "USDC";
  const gasLabel = estimate.needsApproval && estimate.approvalGas ? t("approvalPaymentGas") : t("estimatedGas");
  return (
    <div className="estimate-line">
      <Metric label={gasLabel} value={estimate.gas.toString()} />
      <Metric label={t("gasPrice")} value={`${trimDisplay(formatUnits(estimate.gasPrice, 18), 8)} ${symbol}`} />
      <Metric label={t("estimatedFee")} value={`${trimDisplay(estimate.fee, 8)} ${symbol}`} />
    </div>
  );
}

function Field({
  label,
  helper,
  children
}: {
  label: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {helper && <small>{helper}</small>}
    </label>
  );
}

function PaneTitle({ id, label }: { id?: string; label: string }) {
  return (
    <div className="pane-title">
      <h3 id={id}>{label}</h3>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RecoveryPanel({
  account,
  token,
  insufficientToken,
  missingGas,
  networkLabel = "Arc Testnet",
  nativeSymbol = "USDC"
}: {
  account: `0x${string}`;
  token: PaymentToken;
  insufficientToken: boolean;
  missingGas: boolean;
  networkLabel?: string;
  nativeSymbol?: string;
}) {
  const { t } = useI18n();
  const showArcLinks = networkLabel === "Arc Testnet";
  const extraToken = insufficientToken && token !== "USDC" ? t("andToken", { token }) : "";
  const message = missingGas
    ? token === "USDC"
      ? t("fundUsdcGas", { network: networkLabel, token, native: nativeSymbol })
      : t("fundGasToken", { network: networkLabel, native: nativeSymbol, extra: extraToken })
    : t("fundMoreToken", { token, network: networkLabel });

  return (
    <div className="recovery-panel">
      <div>
        <strong>{t("balanceRecovery")}</strong>
        <span>{message}</span>
      </div>
      {showArcLinks && (
        <div className="tool-actions">
          <a className="secondary-button" href={ARC_FAUCET_URL} target="_blank" rel="noreferrer">
            {t("faucet")}
          </a>
          <a className="secondary-button" href={toExplorerAddressUrl(account)} target="_blank" rel="noreferrer">
            {t("arcscanWallet")}
          </a>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useI18n();
  const keyByStatus: Record<PaymentStatus, string> = {
    open: "open",
    paid: "paid",
    expired: "expired",
    failed: "failed",
    possible_match: "review",
  };
  return <span className={`status-badge ${status}`}>{t(keyByStatus[status])}</span>;
}

function remoteConfirmationToLifecycle(confirmation: QrConfirmationPayload): PayLifecycle {
  if (confirmation.status === "paid") {
    return "verified";
  }
  if (confirmation.status === "failed") {
    return "failed";
  }
  return "confirming";
}

function remoteConfirmationToNotice(confirmation: QrConfirmationPayload): Notice {
  if (confirmation.status === "paid") {
    return {
      tone: "success",
      text: confirmation.message ?? "Payment settled on Arc. Invoice is ready."
    };
  }
  if (confirmation.status === "failed") {
    return {
      tone: "error",
      text: confirmation.message ?? "Payment failed."
    };
  }
  return {
    tone: "info",
    text: confirmation.message ?? "Source payment is still being checked for Arc settlement."
  };
}

function getPayButtonLabel(
  isPaying: boolean,
  lifecycle: PayLifecycle,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (!isPaying) {
    return t("payRequestAction");
  }

  switch (lifecycle) {
    case "preparing":
      return t("preparing");
    case "awaiting_wallet":
      return t("approveWallet");
    case "submitted":
    case "confirming":
      return t("confirming");
    case "proving":
      return t("generatingProofProgress");
    case "settling":
      return t("settling");
    case "verified":
      return t("verified");
    case "failed":
      return t("retryPayment");
    case "idle":
    default:
      return t("payRequestAction");
  }
}

function NoticeBar({ notice, compact = false }: { notice: Notice; compact?: boolean }) {
  return (
    <div className={`notice ${notice.tone} ${compact ? "compact" : ""}`}>
      <span>{notice.text}</span>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

type RequestStateWriter = (updater: (current: PaymentRequest[]) => PaymentRequest[]) => void;
type ReceiptStateWriter = (updater: (current: Receipt[]) => Receipt[]) => void;

function applyQrStatusPayload(payload: QrStatusPayload, setRequests: RequestStateWriter, setReceipts: ReceiptStateWriter) {
  setRequests((current) => upsertRequest(current, payload.request));
  if (payload.receipt) {
    setReceipts((current) => upsertReceipt(current, payload.receipt as Receipt));
  }
}

async function createLocalQrRequest(form: QrFormState): Promise<PaymentRequest> {
  const recipient = validateRecipient(form.recipient);
  const token = "USDC";
  const amount = formatTokenAmount(parseTokenAmount(form.amount, token), token);
  const createdAt = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    recipient,
    token,
    amount,
    label: normalizeLabel(form.label),
    note: normalizeNote(form.note),
    invoiceDate: normalizeInvoiceDate(form.invoiceDate),
    expiresAt: createExpiry(createdAt),
    createdAt,
    startBlock: "0",
    status: "open"
  };
}

function buildTokenTransfer(form: DirectFormState): TokenTransfer {
  const token = form.token;
  const amount = formatTokenAmount(parseTokenAmount(form.amount, token), token);
  return {
    recipient: validateRecipient(form.recipient),
    token,
    amount
  };
}

// Builds the in-app record for a confirmed direct send. Intentionally does NOT
// download anything — auto-downloading files right after a transaction reads as
// suspicious. The receipt is saved to history; the user exports it on demand.
//
// label/note may be provided for direct disbursements (agent rails / CLI use).
// Falls back to the previous generic label when omitted so existing web direct
// behavior is unchanged.
function buildDirectSendRecord(input: {
  transfer: TokenTransfer;
  payer: `0x${string}`;
  txHash: Hash;
  blockNumber: string;
  label?: string;
  note?: string;
}): { request: PaymentRequest; receipt: Receipt } {
  const { transfer, payer, txHash, blockNumber, label, note } = input;
  const nowIso = new Date().toISOString();
  const requestId = `direct-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)}`;

  const request: PaymentRequest = {
    id: requestId,
    recipient: transfer.recipient,
    token: transfer.token,
    amount: transfer.amount,
    label: (label && label.trim()) ? normalizeLabel(label) : `Direct send · ${transfer.token}`,
    note: note ? normalizeNote(note) : undefined,
    invoiceDate: todayInputValue(),
    createdAt: nowIso,
    startBlock: blockNumber,
    status: "paid",
    txHash
  };

  const receipt: Receipt = {
    requestId,
    txHash,
    from: payer,
    to: transfer.recipient,
    token: transfer.token,
    amount: transfer.amount,
    blockNumber,
    confirmedAt: nowIso,
    explorerUrl: toExplorerTxUrl(txHash)
  };

  return { request, receipt };
}

function hasTransferInput(form: DirectFormState): boolean {
  return Boolean(form.recipient.trim() && form.amount.trim());
}

function ensureTokenBalance(balances: Balances, transfer: TokenTransfer) {
  if (parseTokenAmount(balances.tokenBalance, transfer.token) < parseTokenAmount(transfer.amount, transfer.token)) {
    throw new Error(`Insufficient ${transfer.token} balance.`);
  }
}

function ensureGasBalance(balances: Balances, transfer: SpendableTransfer, estimate: TransferEstimate) {
  const spendability = getSpendabilityCheck(balances, transfer, estimate);
  if (!spendability.hasEnoughNative) {
    if (transfer.token === "USDC") {
      throw new Error("Insufficient Arc Testnet USDC for payment amount plus gas.");
    }
    throw new Error("Insufficient Arc Testnet USDC for gas.");
  }
}

function hasInsufficientGas(
  balances: Balances | undefined,
  transfer: SpendableTransfer | undefined,
  estimate?: TransferEstimate
): boolean {
  return hasInsufficientNativeSpendBalance(balances, transfer, estimate);
}

function useInsufficientToken(balances: Balances | undefined, transfer: TokenTransfer | DirectFormState | undefined): boolean {
  return useMemo(() => {
    if (!balances || !transfer?.amount || !transfer.token) {
      return false;
    }
    try {
      return parseTokenAmount(balances.tokenBalance, transfer.token) < parseTokenAmount(transfer.amount, transfer.token);
    } catch {
      return false;
    }
  }, [balances, transfer?.amount, transfer?.token]);
}

function formatTimeLeft(request: PaymentRequest, now: Date): string {
  if (request.status === "paid") {
    return "paid";
  }
  const expiry = request.expiresAt ?? request.dueAt;
  if (!expiry) {
    return "no expiry";
  }

  const remaining = new Date(expiry).getTime() - now.getTime();
  if (remaining < 0) {
    return "expired";
  }

  const totalSeconds = Math.ceil(remaining / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatQrLiveStatus(request: PaymentRequest): string {
  return request.txHash ? "Payment submitted" : "Watching for payment";
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "not set";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "invalid date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function trimDisplay(value: string, maxDecimals: number): string {
  const [whole, fraction] = value.split(".");
  if (!fraction) {
    return whole;
  }
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function DashboardPage({
  requests, receipts, account, now, onNavigate, getProvider, onDeposit
}: {
  requests: PaymentRequest[];
  receipts: Receipt[];
  account?: `0x${string}`;
  now: Date;
  onNavigate: (target: string) => void;
  getProvider: () => Promise<EthereumProvider | undefined>;
  onDeposit: () => void;
}) {
  const { t } = useI18n();
  const totalVolume = requests.reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const verifiedVolume = requests
    .filter((request) => refreshDerivedStatus(request, now).status === "paid")
    .reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const pendingVolume = requests
    .filter((request) => refreshDerivedStatus(request, now).status === "open")
    .reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const activityData = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (6 - offset));
    const key = date.toISOString().slice(0, 10);
    const dayRequests = requests.filter((request) => request.createdAt.slice(0, 10) === key);
    return {
      name: dayFormatter.format(date),
      volume: dayRequests.reduce((sum, request) => sum + Number(request.amount || 0), 0),
      count: dayRequests.length
    };
  });

  const hasActivity = requests.length > 0;
  // Compute a 7-day trend delta (second half vs first half) for the
  // headline sparkline chip. This mirrors the logic in MonthlyStats so
  // the two cards tell a consistent story.
  const trendSeries = activityData.map((d) => ({ value: d.volume }));
  const trendDeltaPct = computeTrendDelta(activityData.map((d) => d.volume));

  return (
    <div className="ql-dashboard relative z-10 mx-auto flex w-full max-w-[1120px] flex-col pb-6">

      {/* HEADLINE BALANCE ─ full width, the day's main statement. The page
          title lives in the Header (routeMeta); this card is the first thing
          under it. */}
      <section className="ql-section">
        <BalanceCard
          totalVolume={totalVolume}
          verifiedVolume={verifiedVolume}
          pendingVolume={pendingVolume}
          requestCount={requests.length}
          receiptCount={receipts.length}
          account={account}
          onNavigate={onNavigate}
          onDeposit={onDeposit}
          trend={trendSeries}
          trendDeltaPct={trendDeltaPct ?? undefined}
        />
      </section>

      {/* IDENTITY ─ the wallet's Disburse ID; payment requests to this name
          land in the in-app inbox. */}
      <section className="ql-section mt-4">
        <DisburseIdCard account={account} getProvider={getProvider} />
      </section>

      {/* ACTIVITY ─ only once there is something to plot. An empty chart is
          noise, not information. */}
      {hasActivity && (
        <>
          <SectionRule label={t("activity") || "Activity"} />
          <section className="ql-section">
            <MonthlyStats activityData={activityData} />
          </section>
        </>
      )}

      {/* LEDGER ─ recent transactions. TransactionsTable renders its own
          empty state, so it carries the zero case on its own. */}
      <SectionRule label={t("ledger") || "Ledger"} />
      <section className="ql-section">
        <TransactionsTable
          requests={requests}
          receipts={receipts}
          now={now}
          onNavigate={onNavigate}
        />
      </section>

    </div>
  );
}

/** Section heading — quiet muted label above its card, Linear-style. */
function SectionRule({ label }: { label: string }) {
  return (
    <div className="mb-3 mt-8">
      <h2 className="text-sm font-medium text-[var(--muted)]">{label}</h2>
    </div>
  );
}

/** Second-half vs first-half percent delta for a short series. */
function computeTrendDelta(series: number[]): number | null {
  if (series.length < 4) return null;
  const mid = Math.floor(series.length / 2);
  const prev = series.slice(0, mid).reduce((a, b) => a + b, 0);
  const curr = series.slice(mid).reduce((a, b) => a + b, 0);
  if (prev === 0 && curr === 0) return null;
  if (prev === 0) return 100;
  return ((curr - prev) / prev) * 100;
}

function ImportExportPage({
  requests, receipts, importInputRef, onExport, onImport
}: {
  requests: PaymentRequest[];
  receipts: Receipt[];
  importInputRef: RefObject<HTMLInputElement | null>;
  onExport: () => void;
  onImport: (file: File | undefined) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      <section className="ql-page" aria-label="Backup">
        <p className="ql-page-lede">
          Your ledger lives locally in this browser. Export to JSON for safe-keeping, or import a previous
          backup to restore everything in one click.
        </p>

        <div className="ql-ie-grid">
          <article className="ql-ie-card">
            <p className="form-section-label">Export</p>
            <h3>{t("exportHistory")}</h3>
            <p className="ql-ie-card-text">
              {t("exportHistoryText", { requests: requests.length, receipts: receipts.length })}
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={onExport}
              disabled={!requests.length}
            >
              {t("exportJson")}
            </button>
          </article>

          <article className="ql-ie-card">
            <p className="form-section-label">Import</p>
            <h3>{t("importPaymentData")}</h3>
            <p className="ql-ie-card-text">{t("importPaymentDataText")}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => importInputRef.current?.click()}
            >
              {t("chooseFile")}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={(event) => onImport(event.target.files?.[0])}
            />
          </article>
        </div>

        <aside className="ql-ie-note">
          <p className="form-section-label">Privacy</p>
          <p>
            <strong>{t("dataStaysLocal")}</strong> {t("dataStaysLocalText")}
          </p>
        </aside>
      </section>
    </>
  );
}

// ---------- Statements Page ----------

function StatementsPage() {
  const [recipient, setRecipient] = useState("");
  const [payer, setPayer] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [bundle, setBundle] = useState<StatementBundleView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    if (!recipient && !payer) {
      setError("Provide at least a recipient or payer address.");
      return;
    }
    setLoading(true);
    setError(null);
    setBundle(null);

    try {
      const res = await fetch("/api/statements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: recipient || undefined,
          payer: payer || undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
          token: "USDC",
          network_mode: "testnet"
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to generate statement");
      }
      const data = await res.json();
      setBundle(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
    setLoading(false);
  }

  function handleDownloadJson() {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `disburse-statement-${bundle.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="ql-page" aria-labelledby="statements-heading">
        <p className="ql-page-lede">
          Generate a verified statement bundle — every settlement proof between you and a counterparty
          over any period. Export as JSON for accounting, audits, or tax reporting.
        </p>

        <form onSubmit={handleGenerate} className="ql-form-card">
          <div className="form-section">
            <p className="form-section-label">Counterparty</p>
            <div className="field-grid">
              <Field label="Recipient address">
                <input
                  placeholder="0x..."
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  spellCheck={false}
                />
              </Field>
              <Field label="Payer / counterparty">
                <input
                  placeholder="0x..."
                  value={payer}
                  onChange={(e) => setPayer(e.target.value)}
                  spellCheck={false}
                />
              </Field>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-label">Period</p>
            <div className="field-grid">
              <Field label="From">
                <DateInput value={fromDate} onChange={setFromDate} />
              </Field>
              <Field label="To">
                <DateInput value={toDate} onChange={setToDate} />
              </Field>
            </div>
          </div>

          <div className="action-row">
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Generating…" : "Generate statement"}
            </button>
          </div>
        </form>

        {error && <div className="notice notice-error">{error}</div>}

        {bundle && (
          <div className="ql-statement-result">
            <div className="ql-statement-result-head">
              <h3>Statement summary</h3>
              <button className="secondary-button" type="button" onClick={handleDownloadJson}>
                Download JSON
              </button>
            </div>

            <div className="ql-metric-grid">
              <div className="ql-metric">
                <p className="ql-metric-label">Total amount</p>
                <p className="ql-metric-value">
                  {bundle.summary.totalAmount} <span className="ql-metric-unit">{bundle.summary.token}</span>
                </p>
              </div>
              <div className="ql-metric">
                <p className="ql-metric-label">Proofs</p>
                <p className="ql-metric-value">{bundle.summary.totalProofs}</p>
              </div>
              <div className="ql-metric">
                <p className="ql-metric-label">Period</p>
                <p className="ql-metric-detail">
                  {new Date(bundle.summary.period.from).toLocaleDateString()} —{" "}
                  {new Date(bundle.summary.period.to).toLocaleDateString()}
                </p>
              </div>
              <div className="ql-metric">
                <p className="ql-metric-label">Network</p>
                <p className="ql-metric-detail">{bundle.summary.networkMode}</p>
              </div>
            </div>

            {bundle.proofs.length > 0 && (
              <div className="ql-proof-list">
                <p className="form-section-label">Individual proofs</p>
                <div className="ql-proof-rows">
                  {bundle.proofs.map((psp: StatementPspView) => (
                    <div key={psp.uid} className="ql-proof-row">
                      <div className="ql-proof-row-main">
                        <span className="ql-proof-uid">{psp.uid}</span>
                        <span className="ql-proof-label">{psp.invoice?.label || "—"}</span>
                      </div>
                      <span className="ql-proof-amount">
                        {psp.invoice?.amount} {psp.invoice?.token}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}

type StatementBundleView = {
  id: string;
  summary: {
    totalProofs: number;
    totalAmount: string;
    token: string;
    period: { from: string; to: string };
    networkMode: string;
  };
  proofs: StatementPspView[];
};
type StatementPspView = {
  uid: string;
  invoice?: { label?: string; amount?: string; token?: string };
};

export default App;
