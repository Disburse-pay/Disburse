import { type FormEvent, type MouseEvent, type ReactNode, type RefObject, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  BookOpen,
  Check,
  ChevronsLeftRight,
  Download,
  ExternalLink,
  FileText,
  Home,
  LifeBuoy,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  QrCode,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sun,
  WalletCards
} from "lucide-react";
import Sidebar from "@/src/components/Sidebar";
import Header from "@/src/components/Header";
import SettingsDialog from "@/src/components/SettingsDialog";
import BalanceCard from "@/src/components/BalanceCard";
import TransactionsTable from "@/src/components/TransactionsTable";
import MonthlyStats from "@/src/components/MonthlyStats";
import SystemStatusCard from "@/src/components/SystemStatusCard";
import SettlementTimeline, { buildPaymentTimeline } from "@/src/components/SettlementTimeline";
import QrShareCard from "@/src/components/QrShareCard";
import ReceiptDocument from "@/src/components/ReceiptDocument";
import SettlementPipeline from "@/src/components/SettlementPipeline";
import { PspProofPanel } from "@/src/components/PspProofPanel";
import { cn } from "@/src/lib/utils";
import { createSettlementAttestation, type SettlementAttestation } from "./lib/attestation";
import { generateSettlementProof, downloadSettlementProof, downloadUBLInvoice, generateReceiptFingerprint } from "./lib/compliance";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { formatUnits, parseUnits, type Hash } from "viem";
import {
  ARC_CHAIN_ID,
  ARC_DOCS_URL,
  ARC_EXPLORER_URL,
  ARC_FAUCET_URL,
  ARC_RPC_ENDPOINTS,
  ARC_RPC_URL,
  TOKENS
} from "./lib/arc";
import { errorToMessage } from "./lib/errors";
import { I18nProvider, useI18n } from "./lib/i18n";
import {
  type AppSettings,
  type LanguageCode,
  loadSettings
} from "./lib/settings";
import { buildInvoiceFilename, formatInvoiceDate, generateInvoicePdf } from "./lib/invoice";
import {
  ARC_DESTINATION_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  getAllowedSourceChainIds,
  getCrossChain,
  getCrossChainExplorerTxUrl,
  getCrossChainLabel,
  isRemotePaymentSourceChainId,
  type PaymentSourceChainId
} from "./lib/crosschain";
import {
  estimateCrossChainPayment,
  readCrossChainBalances,
  submitCrossChainPayment,
  switchToCrossChain,
  waitForCrossChainPaymentReceipt,
  waitForCrossChainReceipt
} from "./lib/crosschainOnchain";
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
  encodeRequestPayload,
  formatTokenAmount,
  isCrossChainPaymentRequest,
  isPaymentExpired,
  isPaymentPayable,
  mergeScannedRequest,
  normalizeInvoiceDate,
  normalizeLabel,
  normalizeNote,
  parseTokenAmount,
  PAYMENT_VALIDITY_MINUTES,
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

// Route-level code splitting. Docs content + multilingual sections are heavy
// and rarely on the user's initial path, so they ship in a separate chunk.
const DocsPage = lazy(() => import("./pages/DocsPage"));

// The bet subdomain (bet.disburse.online) renders an entirely separate shell.
// Loaded lazily so it never ships to users who only use the payments app.
const BetApp = lazy(() => import("./BetApp"));

function DocsFallback() {
  // Quiet placeholder that matches the docs page rhythm so the layout
  // does not jump when the chunk arrives. Renders for ~tens of ms in
  // most cases — no spinner.
  return (
    <div className="mx-auto max-w-[1180px] pb-16">
      <div className="border-b border-[var(--line)] pb-10">
        <div className="h-3 w-32 bg-[var(--line-soft)]" aria-hidden="true" />
        <div className="mt-4 h-9 w-3/4 bg-[var(--line-soft)]" aria-hidden="true" />
        <div className="mt-3 h-4 w-2/3 bg-[var(--line-soft)]" aria-hidden="true" />
      </div>
      <span className="sr-only">Loading documentation…</span>
    </div>
  );
}

import { cx } from "./lib/cx";
import {
  THEME_KEY,
  LEGACY_THEME_KEY,
  getInitialTheme,
  type Theme
} from "./lib/theme";
import {
  LEGACY_DOCS_PATH,
  PRODUCTION_DOCS_HOSTNAME,
  PRODUCTION_APP_HOSTNAME,
  getInitialPage,
  isLocalHostname,
  isLocalAppPreview,
  isLocalDocsPreview,
  isDocsHostname,
  stripPublicSubdomain,
  getDocsHostname,
  getAppHostname,
  getOriginForHostname,
  getDocsHref,
  getBetHref,
  getAppHref,
  getInternalTargetPath,
  shouldRedirectLegacyBetRoute,
  shouldRedirectLegacyDocsRoute,
  getCurrentRouteKey,
  type Page,
  type NavigateHandler
} from "./lib/routing";
import { faqItems } from "./content/faq";
import {
  getDocsSections,
  getDocsSummaryItems,
  type DocsSection,
  type DocsSummaryItem
} from "./content/docs";

type DirectFormState = {
  recipient: string;
  token: PaymentToken;
  amount: string;
};

type QrFormState = DirectFormState & {
  label: string;
  note: string;
  invoiceDate: string;
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
  amount: ""
};

const emptyQrForm: QrFormState = {
  recipient: "",
  token: "USDC",
  amount: "",
  label: "",
  note: "",
  invoiceDate: todayInputValue()
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
  const [paySourceChainId, setPaySourceChainId] = useState<PaymentSourceChainId>(ARC_CHAIN_ID);
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
  const [payApprovalHash, setPayApprovalHash] = useState<Hash>();
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [payAttestation, setPayAttestation] = useState<SettlementAttestation | undefined>();
  const [appSettings] = useState<AppSettings>(() => loadSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
  const payRequiredChainId = isCrossChainPaymentRequest(payRequest) ? paySourceChainId : ARC_CHAIN_ID;
  const payWrongChain = Boolean(account && chainId !== undefined && chainId !== payRequiredChainId);
  const hasWalletProvider = dynamicWallet.enabled || Boolean(getInjectedProvider());
  const payDisplayStatus = payRequest ? refreshDerivedStatus(payRequest, now).status : "open";
  const payIsExpired = payRequest ? isPaymentExpired(payRequest, now) : false;
  const payIsPayable = payRequest ? isPaymentPayable(payRequest, now) : false;
  const directInsufficientToken = useInsufficientToken(directBalances, directForm);
  const payInsufficientToken = useInsufficientToken(payBalances, payRequest);
  const directMissingGas = hasInsufficientGas(directBalances, directForm, directEstimate);
  const payMissingGas = usesRemoteSource(payRequest, paySourceChainId)
    ? hasInsufficientNativeGas(payBalances, payEstimate)
    : hasInsufficientGas(payBalances, payRequest, payEstimate);
  const rpcIsStale = Boolean(rpcHealth && Date.now() - new Date(rpcHealth.checkedAt).getTime() > 18_000);
  const rpcStatusLabel = !rpcHealth
    ? "checking"
    : !rpcHealth.healthy
      ? "rpc down"
      : rpcIsStale
        ? "stale"
        : rpcHealth.activeEndpoint?.label ?? "active";
  const rpcBlockLabel = rpcHealth?.healthy && rpcHealth.blockNumber ? `block ${rpcHealth.blockNumber}` : rpcStatusLabel;
  const rpcGasLabel =
    rpcHealth?.healthy && rpcHealth.safeGasPrice ? `${trimDisplay(rpcHealth.safeGasPrice, 8)} USDC` : "pending";

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

  useEffect(() => {
    if (shouldRedirectLegacyDocsRoute()) {
      window.location.replace(getDocsHref());
    }
    if (shouldRedirectLegacyBetRoute()) {
      window.location.replace(getBetHref(window.location.pathname));
    }
  }, []);

  // Legacy: /settings is now a dialog, not a page. Open it and tidy the URL.
  useEffect(() => {
    if (page === "dashboard" && window.location.pathname === "/settings") {
      setIsSettingsOpen(true);
      window.history.replaceState(null, "", "/");
    }
  }, [page]);

  useEffect(() => {
    // Bet-subdomain pages are handled by BetApp and never reach this code,
    // so the title map is keyed only on the app-shell pages.
    const titles: Partial<Record<Page, string>> = {
      landing: "Disburse - Settlement-grade stablecoin payments",
      dashboard: "Overview · Disburse",
      payments: "Direct send · Disburse",
      "qr-payments": "QR requests · Disburse",
      pay: "Pay request · Disburse",
      "import-export": "Backup · Disburse",
      milestones: "Milestones · Disburse",
      statements: "Statements · Disburse",
      docs: "Documentation · Disburse",
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
    setShareUrl(buildShareUrl(selectedRequest, window.location.origin));
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
      if (isCrossChainPaymentRequest(decoded)) {
        setPaySourceChainId(chooseDefaultPaymentSource(decoded));
      }
      setPayBalances(undefined);
      setPayEstimate(undefined);
      setPayApprovalHash(undefined);
      setPayLifecycle("idle");
      setPayNotice({ tone: "info", text: "QR payment request loaded." });
    } catch (error) {
      setPayRequestId(undefined);
      setPayBalances(undefined);
      setPayEstimate(undefined);
      setPayApprovalHash(undefined);
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
        setPayApprovalHash(undefined);
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
      setPayApprovalHash(undefined);
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
      setPayApprovalHash(undefined);
    };

    const handleChain = (value: unknown) => {
      setChainId(Number.parseInt(String(value), 16));
      setDirectBalances(undefined);
      setPayBalances(undefined);
      setDirectEstimate(undefined);
      setPayEstimate(undefined);
      setPayApprovalHash(undefined);
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
  }, [account, wrongChain, payWrongChain, page, payRequest?.id, payRequest?.token, payRequest?.amount, paySourceChainId]);

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

  async function handleSwitchPayNetwork() {
    if (!usesRemoteSource(payRequest, paySourceChainId)) {
      await handleSwitchNetwork();
      return;
    }

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
      await switchToCrossChain(provider, paySourceChainId);
      const nextChainId = await getWalletChainId(provider);
      setChainId(nextChainId);
      setWalletNotice({ tone: "success", text: `${getCrossChainLabel(paySourceChainId)} selected.` });
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
        await waitForTransactionConfirmation(hash);
        setDirectNotice({ tone: "success", text: "Direct payment confirmed." });
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
      const remoteRequest = await createRemoteQrRequest(qrForm);
      const request = remoteRequest ?? (await createLocalQrRequest(qrForm));

      setRequests((current) => upsertRequest(current, request));
      setSelectedId(request.id);
      setQrNotice({
        tone: "success",
        text: remoteRequest ? "QR payment request generated and synced." : "QR payment request generated."
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
      setPayNotice({
        tone: "error",
        text: usesRemoteSource(request, paySourceChainId)
          ? `Switch to ${getCrossChainLabel(paySourceChainId)} before estimating.`
          : "Switch to Arc Testnet before estimating."
      });
      return;
    }
    if (!isPaymentPayable(request)) {
      setPayNotice({ tone: "error", text: "This QR payment request expired. Ask the requester for a fresh QR code." });
      return;
    }

    setIsEstimatingPay(true);
    setPayNotice({ tone: "info", text: "Estimating QR payment." });

    try {
      const nextEstimate = usesRemoteSource(request, paySourceChainId)
        ? await estimateCrossChainPayment(account, request, paySourceChainId)
        : await estimatePayment(account, request);
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
      setPayNotice({
        tone: "error",
        text: usesRemoteSource(request, paySourceChainId)
          ? `Switch to ${getCrossChainLabel(paySourceChainId)} before paying.`
          : "Switch to Arc Testnet before paying."
      });
      return;
    }

    const attemptStartedAt = new Date();
    if (!isPaymentPayable(request, attemptStartedAt)) {
      setPayNotice({ tone: "error", text: "This QR payment request expired. Ask the requester for a fresh QR code." });
      return;
    }

    setIsPayingQr(true);
    setPayLifecycle("preparing");
    setPayApprovalHash(undefined);
    setPayNotice({ tone: "info", text: "Preparing QR payment." });

    try {
      const isRemoteSource = usesRemoteSource(request, paySourceChainId);
      const balances = isRemoteSource
        ? await readCrossChainBalances(account, request, paySourceChainId)
        : await readBalances(account, request);
      setPayBalances(balances);
      ensureTokenBalance(balances, request);

      let transferEstimate = payEstimate;
      if (!transferEstimate) {
        setPayNotice({ tone: "info", text: "Estimating QR payment." });
        transferEstimate = isRemoteSource
          ? await estimateCrossChainPayment(account, request, paySourceChainId)
          : await estimatePayment(account, request);
        setPayEstimate(transferEstimate);
      }
      if (isRemoteSource) {
        ensureNativeGasBalance(balances, transferEstimate, getCrossChainLabel(paySourceChainId));
      } else {
        ensureGasBalance(balances, request, transferEstimate);
      }

      const requestWithAttempt: PaymentRequest = {
        ...request,
        submittedAt: attemptStartedAt.toISOString()
      };
      setPayLifecycle("awaiting_wallet");
      setPayNotice({ tone: "info", text: "Open your wallet and approve the payment." });

      const hash = isRemoteSource
        ? await submitCrossChainPayment(provider, account, requestWithAttempt, paySourceChainId, {
            onApprovalRequested: () => {
              setPayNotice({
                tone: "info",
                text: "First approve USDC spending in your wallet. A second wallet prompt will confirm the QR payment."
              });
            },
            onApprovalSubmitted: (approvalHash) => {
              setPayApprovalHash(approvalHash);
            },
            onApprovalConfirmed: () => {
              setPayNotice({
                tone: "info",
                text: "USDC approval confirmed. Open your wallet again and confirm the QR payment."
              });
            },
            onPaymentRequested: () => {
              setPayNotice({
                tone: "info",
                text: "Confirm the QR payment transaction. This is the hash the verifier needs."
              });
            }
          })
        : await submitPayment(provider, account, requestWithAttempt);
      setPayLifecycle("submitted");
      setPayNotice({
        tone: "info",
        text: isRemoteSource
          ? "Source-chain payment submitted. Waiting for Polymer proof relay."
          : "Transaction submitted. Verifying receipt."
      });

      let requestWithHash: PaymentRequest = { ...requestWithAttempt, txHash: hash };
      if (isRemoteSource) {
        await waitForCrossChainPaymentReceipt(paySourceChainId, hash, requestWithAttempt);
      }
      try {
        const submission = await recordRemoteQrSubmission(
          request.id,
          hash,
          requestWithAttempt.submittedAt,
          isCrossChainPaymentRequest(request) ? paySourceChainId : undefined
        );
        if (submission?.request) {
          requestWithHash = submission.request;
        }
      } catch (error) {
        setPayNotice({ tone: "info", text: `Transaction submitted. ${errorToMessage(error)}` });
      }
      setRequests((current) => upsertRequest(current, requestWithHash));

      setPayLifecycle("confirming");
      try {
        if (isRemoteSource) {
          await waitForCrossChainReceipt(paySourceChainId, hash);
        } else {
          await waitForTransactionConfirmation(hash);
        }
      } catch (error) {
        setPayLifecycle("submitted");
        setPayNotice({ tone: "info", text: errorToMessage(error) });
        return;
      }

      if (isRemoteSource) {
        setPayLifecycle("proving");
        setPayNotice({ tone: "info", text: "Source payment confirmed. Requesting Polymer proof." });
      }

      const remoteConfirmation = await confirmRemoteQrPayment(
        request.id,
        hash,
        isCrossChainPaymentRequest(request) ? paySourceChainId : undefined
      ).catch((error) => {
        setPayNotice({ tone: "info", text: errorToMessage(error) });
        return undefined;
      });
      if (remoteConfirmation) {
        applyQrStatusPayload(remoteConfirmation, setRequests, setReceipts);
        setPayLifecycle(remoteConfirmationToLifecycle(remoteConfirmation));
        setPayNotice(remoteConfirmationToNotice(remoteConfirmation));
      } else if (isRemoteSource) {
        setPayLifecycle("proving");
        setPayNotice({
          tone: "info",
          text: "Source payment is confirmed, but the backend relay was unavailable. Use Verify after the API is available."
        });
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
    setPayNotice({
      tone: "info",
      text: usesRemoteSource(request, request.settlement?.sourceChainId ?? paySourceChainId)
        ? "Checking Polymer settlement status."
        : "Scanning Arc Testnet logs."
    });

    try {
      const verifySourceChainId = isCrossChainPaymentRequest(request)
        ? request.settlement?.sourceChainId ?? paySourceChainId
        : paySourceChainId;
      const crossChainSourceHash = isCrossChainPaymentRequest(request)
        ? request.settlement?.sourceTxHash ?? request.txHash
        : undefined;
      if (crossChainSourceHash && usesRemoteSource(request, verifySourceChainId)) {
        try {
          await waitForCrossChainPaymentReceipt(verifySourceChainId, crossChainSourceHash, request);
        } catch (error) {
          setRequests((current) => upsertRequest(current, clearInvalidCrossChainSourceHash(request, verifySourceChainId)));
          setPayLifecycle("idle");
          setPayNotice({ tone: "error", text: errorToMessage(error) });
          return;
        }
      }
      const remoteConfirmation = isCrossChainPaymentRequest(request)
        ? crossChainSourceHash
          ? await confirmRemoteQrPayment(
              request.id,
              crossChainSourceHash,
              verifySourceChainId
            ).catch(() => undefined)
          : undefined
        : request.txHash
          ? await confirmRemoteQrPayment(request.id, request.txHash).catch(() => undefined)
          : undefined;
      if (remoteConfirmation) {
        applyQrStatusPayload(remoteConfirmation, setRequests, setReceipts);
        setPayLifecycle(remoteConfirmationToLifecycle(remoteConfirmation));
        setPayNotice(remoteConfirmationToNotice(remoteConfirmation));
      } else if (usesRemoteSource(request, request.settlement?.sourceChainId ?? paySourceChainId)) {
        setPayLifecycle(crossChainSourceHash ? "proving" : "idle");
        setPayNotice({
          tone: crossChainSourceHash ? "info" : "error",
          text: crossChainSourceHash
            ? "Source payment is known, but the backend relayer did not return a settlement yet."
            : "No source-chain transaction is saved for this Arc-settlement request."
        });
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
      setPayBalances(
        usesRemoteSource(request, paySourceChainId)
          ? await readCrossChainBalances(account, request, paySourceChainId)
          : await readBalances(account, request)
      );
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
    expectedChainId: page === "pay" ? payRequiredChainId : ARC_CHAIN_ID,
    expectedChainLabel:
      page === "pay" && isCrossChainPaymentRequest(payRequest) ? getCrossChainLabel(paySourceChainId) : "Arc Testnet",
    isConnecting,
    onConnect: handleConnectWallet,
    onSwitch: page === "pay" ? handleSwitchPayNetwork : handleSwitchNetwork,
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

  // bet.disburse.online (and local bet preview) renders a separate shell with
  // its own header, nav, and routing. It still inherits the wallet provider
  // from main.tsx, but it does not use the main app's sidebar or header.
  if (
    page === "markets" ||
    page === "market-detail" ||
    page === "market-positions" ||
    page === "market-history"
  ) {
    return (
      <Suspense fallback={null}>
        <BetApp />
      </Suspense>
    );
  }

  // On the docs.* subdomain, skip the app shell and render a docs-only layout
  // with a slim top nav and a link back to the console. On `app.*`, the docs
  // page still renders inside the regular app shell so it behaves like any
  // other route.
  const onDocsSubdomain = isDocsHostname(window.location.hostname);
  if (page === "docs" && onDocsSubdomain) {
    return (
      <I18nProvider initialLang={appSettings.language} initialCurrency={appSettings.currency}>
        <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
          <DocsTopNav onToggleTheme={handleThemeToggle} theme={theme} />
          <main className="mx-auto max-w-[1180px] px-6 pt-10 md:px-10">
            <Suspense fallback={<DocsFallback />}>
              <DocsPage />
            </Suspense>
          </main>
        </div>
      </I18nProvider>
    );
  }

  // Bet pages render through BetApp, not this shell, so routeMeta covers only
  // the app-shell pages.
  type AppShellPage = Exclude<
    Page,
    "landing" | "markets" | "market-detail" | "market-positions" | "market-history"
  >;
  const routeMeta: Record<AppShellPage, { title: string; subtitle: string }> = {
    dashboard:       { title: "Overview",       subtitle: "Requests, receipts and network health at a glance." },
    payments:        { title: "Direct send",    subtitle: "Pay a wallet address directly on Arc Testnet." },
    "qr-payments":   { title: "QR requests",    subtitle: "Create a QR invoice for someone else to scan and pay." },
    pay:             { title: "Pay request",    subtitle: "Review and settle a QR payment request." },
    "import-export": { title: "Import · Export", subtitle: "Back up or restore your requests and receipts." },
    milestones:      { title: "Milestones",     subtitle: "Create PSP-gated payment chains for staged work." },
    statements:      { title: "Statements",     subtitle: "Generate settlement proof bundles for reconciliation." },
    docs:            { title: "Documentation",  subtitle: "How Disburse settles, verifies, and exports payments." },
  };
  const { title: headerTitle, subtitle: headerSubtitle } = routeMeta[page as AppShellPage] ?? routeMeta.dashboard;

  return (
    <I18nProvider initialLang={appSettings.language} initialCurrency={appSettings.currency}>
    <div className="flex min-h-screen bg-[var(--canvas)] text-[var(--ink)] overflow-x-hidden relative">
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        page={page}
        onNavigate={handleNavigate}
        account={account}
      />

      <main className={cn("flex-1 flex flex-col transition-all duration-300 relative z-10", isSidebarCollapsed ? "ml-[56px]" : "ml-[236px]")}>
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
          theme={theme}
        />

        <SettingsDialog
          open={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          theme={theme}
          onToggleTheme={handleThemeToggle}
        />
        
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6 relative">
          {page === "dashboard" && (
            <DashboardPage
              requests={requests}
              receipts={receipts}
              account={account}
              rpcHealth={rpcHealth}
              rpcStatusLabel={rpcStatusLabel}
              rpcBlockLabel={rpcBlockLabel}
              now={now}
              onNavigate={navigateTo}
              onExport={handleExport}
            />
          )}
          {page === "docs" && (
            <Suspense fallback={<DocsFallback />}>
              <DocsPage />
            </Suspense>
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
              approvalHash={payApprovalHash}
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
              onSwitch={handleSwitchPayNetwork}
              sourceChainId={paySourceChainId}
              onSourceChainChange={(chainId) => {
                setPaySourceChainId(chainId);
                setPayBalances(undefined);
                setPayEstimate(undefined);
                setPayApprovalHash(undefined);
                setPayNotice(undefined);
              }}
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
          {page === "milestones" && <MilestonesPage />}
          {page === "statements" && <StatementsPage />}
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
      <RouteHero eyebrow={t("payments")} title={t("paymentsHero")} />

      <section className="workbench" aria-labelledby="payments-heading">
        <header className="section-header">
          <h2 id="payments-heading">{t("directTransferTitle")}</h2>
        </header>

        <div className="desk-grid single-flow-grid">
          <section className="desk-pane" aria-labelledby="direct-form-heading">
            <PaneTitle id="direct-form-heading" label={t("paymentDetails")} />
            <form className="form-stack" onSubmit={(event) => event.preventDefault()}>
              <Field label={t("recipient")} helper={t("recipientHelper")}>
                <input
                  value={form.recipient}
                  onChange={(event) => onFormChange({ ...form, recipient: event.target.value })}
                  placeholder="0x..."
                  spellCheck={false}
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

            <div className="request-callout">
              <strong>{t("needSomeonePay")}</strong>
              <button className="secondary-button" type="button" onClick={() => onNavigate("/qr-payments")}>
                {t("generateQrRequest")}
              </button>
            </div>
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
  const requestUrl = buildShareUrl(request, window.location.origin);
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
  const hasFormInput = Boolean(form.recipient || form.amount || form.label || form.note);

  return (
    <>
      <RouteHero eyebrow={t("qrPayments") || "QR Payments"} title={t("generateQr") || "Generate a payment request"} />

      <section className="workbench" aria-label={t("generateQr")}>
        <div className="desk-grid">
          <section className="desk-pane create-pane" aria-label={t("requestDetails")}>
            <form className="form-stack" onSubmit={onSubmit}>
              <Field label={t("recipient")}>
                <div className="input-row">
                  <input
                    value={form.recipient}
                    onChange={(event) => onFormChange({ ...form, recipient: event.target.value })}
                    placeholder="0x..."
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
                <input
                  type="date"
                  value={form.invoiceDate}
                  onChange={(event) => onFormChange({ ...form, invoiceDate: event.target.value })}
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
                    {isCrossChainPaymentRequest(displayRequest) && (
                      <div className="route-summary">
                        <Metric label={t("settlesOn")} value="Arc Testnet" />
                        <Metric
                          label={t("payFrom")}
                          value={(displayRequest.allowedSourceChainIds ?? getAllowedSourceChainIds())
                            .filter((id) => id !== ARC_DESTINATION_CHAIN_ID)
                            .map(getCrossChainLabel)
                            .join(", ")}
                        />
                      </div>
                    )}

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

                {isCrossChainPaymentRequest(displayRequest) && (
                  <SettlementPipeline request={displayRequest} receipt={selectedReceipt} />
                )}

                {selectedReceipt && (
                  <>
                    <ReceiptDocument
                      receipt={selectedReceipt}
                      request={displayRequest}
                      attestationUid={selectedReceipt.attestationUid}
                      attestationFingerprint={selectedReceipt.attestationFingerprint}
                      onCopyFingerprint={onCopy}
                    />
                    <PspProofPanel requestId={displayRequest.id} onCopy={onCopy} />
                  </>
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
  approvalHash,
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
  sourceChainId,
  onSourceChainChange,
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
  approvalHash?: Hash;
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
  sourceChainId: PaymentSourceChainId;
  onSourceChainChange: (chainId: PaymentSourceChainId) => void;
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
  const submittedTxUrl =
    submittedTxHash && request && isCrossChainPaymentRequest(request)
      ? getCrossChainExplorerTxUrl(request.settlement?.sourceChainId ?? sourceChainId, submittedTxHash)
      : submittedTxHash
        ? toExplorerTxUrl(submittedTxHash)
        : undefined;
  const approvalTxUrl = approvalHash ? getCrossChainExplorerTxUrl(sourceChainId, approvalHash) : undefined;
  const payButtonLabel = getPayButtonLabel(isPaying, lifecycle, t);
  const isFinal = status === "paid" || status === "expired" || status === "failed";
  const showExpiryGrid = Boolean(request) && !isFinal;
  const hasResultBlock = Boolean(approvalHash || submittedTxHash || receipt || request?.txHash);
  const payStage = computePayStage(account, wrongChain, request, receipt, lifecycle);

  return (
    <>
      <RouteHero eyebrow={t("payQrRequest")} title={t("payHero")} />

      <section className="workbench pay-request-shell" aria-labelledby="pay-request-heading">
        <header className="section-header">
          <h2 id="pay-request-heading">{t("paymentRequestTitle")}</h2>
          <p>{t("paymentRequestNote")}</p>
        </header>

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
              {isCrossChainPaymentRequest(request) && (
                <div className="route-summary">
                  <Metric label={t("settlesOn")} value="Arc Testnet" />
                  <Metric label={t("selectedSource")} value={getCrossChainLabel(sourceChainId)} />
                </div>
              )}
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
                {isCrossChainPaymentRequest(request) && (
                  <Field label={t("payFrom")}>
                    <select
                      value={sourceChainId}
                      onChange={(event) => onSourceChainChange(Number(event.target.value) as PaymentSourceChainId)}
                      disabled={Boolean(request.txHash)}
                    >
                      {(request.allowedSourceChainIds ?? getAllowedSourceChainIds())
                        .filter((id) => id !== ARC_DESTINATION_CHAIN_ID)
                        .map((chainId) => (
                          <option value={chainId} key={chainId}>
                            {getCrossChainLabel(chainId)}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}

                <WalletActionBlock
                  account={account}
                  wrongChain={wrongChain}
                  hasWalletProvider={hasWalletProvider}
                  isConnecting={isConnecting}
                  walletNotice={undefined}
                  onConnect={onConnect}
                  onSwitch={onSwitch}
                  switchLabel={t("switchToNetwork", { network: getCrossChainLabel(sourceChainId) })}
                />

                {account && !wrongChain && (
                  <TransferState
                    account={account}
                    token={request.token}
                    balances={balances}
                    insufficientToken={insufficientToken}
                    missingGas={missingGas}
                    networkLabel={getCrossChainLabel(sourceChainId)}
                    nativeSymbol={getCrossChain(sourceChainId).nativeSymbol}
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
                    <SettlementPipeline request={request} receipt={receipt} />
                  )}

                  {approvalHash && !receipt && (
                    <div className="receipt-line">
                      <div>
                        <span>{t("usdcApproval")}</span>
                        <strong>{shortAddress(approvalHash, 10, 8)}</strong>
                      </div>
                      <div className="receipt-actions">
                        <button className="text-button" type="button" onClick={() => approvalTxUrl && onCopy(approvalTxUrl)}>
                          {t("copyTx")}
                        </button>
                        <a href={approvalTxUrl} target="_blank" rel="noreferrer">
                          {t("openTx")}
                        </a>
                      </div>
                    </div>
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
                  <ReceiptDocument
                    receipt={receipt}
                    request={request}
                    attestationUid={attestation?.uid ?? receipt.attestationUid}
                    attestationFingerprint={attestation?.fingerprint ?? receipt.attestationFingerprint}
                    onCopyFingerprint={onCopy}
                    onExportPdf={isGeneratingInvoice ? undefined : onInvoice}
                    onExportUbl={onUBLExport}
                  />
                  <PspProofPanel requestId={request.id} onCopy={onCopy} />

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

function RouteHero({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <section id="top" className="hero route-hero">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
    </section>
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

function DocsTopNav({
  theme,
  onToggleTheme,
}: {
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const { t } = useI18n();
  const appHref = `https://app.disburse.online`;
  const homeHref = `https://disburse.online`;
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--paper-translucent)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between px-6 md:px-10">
        <a
          href={homeHref}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <img src="/favicon.png" alt="" className="h-5 w-5" aria-hidden="true" />
          <span className="text-[13px] font-semibold tracking-tight text-[var(--ink)]">
            Disburse
          </span>
          <span className="ml-1 rounded-full border border-[var(--line)] bg-[var(--input-bg)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            {t("docsTitle")}
          </span>
        </a>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleTheme}
            className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--line-soft)] hover:text-[var(--ink)]"
            aria-label={theme === "dark" ? t("switchToLight") : t("switchToDark")}
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            )}
          </button>
          <a
            href={appHref}
            className="group inline-flex items-center gap-1.5 rounded-md bg-[var(--primary-bg)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--primary-text)] transition-opacity hover:opacity-90"
          >
            {t("launchConsole")}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    </header>
  );
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section id="faq" className="faq-section" aria-labelledby="faq-heading">
      <header className="section-header">
        <h2 id="faq-heading">FAQ</h2>
      </header>
      <div className="faq-list">
        {faqItems.map((item, index) => (
          <article className={`faq-item ${openIndex === index ? "open" : ""}`} key={item.question}>
            <button
              className="faq-trigger"
              type="button"
              aria-expanded={openIndex === index}
              aria-controls={`faq-answer-${index}`}
              onClick={() => setOpenIndex((current) => (current === index ? -1 : index))}
            >
              <span>{item.question}</span>
            </button>
            <div className="faq-answer" id={`faq-answer-${index}`}>
              <div>
                <p>{item.answer}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SiteFooter({ onNavigate }: { onNavigate: NavigateHandler }) {
  const dashHref = getAppHref("/");
  const paymentsHref = getAppHref("/payments");
  const qrPaymentsHref = getAppHref("/qr-payments");
  const ieHref = getAppHref("/import-export");
  const docsHref = getDocsHref();

  return (
    <footer className="site-footer">
      <strong>Disburse</strong>
      <nav aria-label="Footer">
        <a href={dashHref} onClick={(event) => onNavigate(event, dashHref)}>
          Dashboard
        </a>
        <a href={paymentsHref} onClick={(event) => onNavigate(event, paymentsHref)}>
          Payments
        </a>
        <a href={qrPaymentsHref} onClick={(event) => onNavigate(event, qrPaymentsHref)}>
          QR Payments
        </a>
        <a href={ieHref} onClick={(event) => onNavigate(event, ieHref)}>
          Import / Export
        </a>
        <a href={docsHref} onClick={(event) => onNavigate(event, docsHref)}>
          Docs
        </a>
        <a href={ARC_DOCS_URL} target="_blank" rel="noreferrer">
          Arc docs
        </a>
      </nav>
    </footer>
  );
}

function WalletPill({
  account,
  chainId,
  expectedChainId,
  expectedChainLabel,
  isConnecting,
  onConnect,
  onSwitch
}: {
  account?: string;
  chainId?: number;
  expectedChainId: number;
  expectedChainLabel: string;
  isConnecting: boolean;
  onConnect: () => void;
  onSwitch: () => void;
}) {
  if (!account) {
    return (
      <button className="wallet-pill" type="button" onClick={onConnect} disabled={isConnecting}>
        {isConnecting ? "Connecting..." : "Connect"}
      </button>
    );
  }

  if (chainId !== expectedChainId) {
    return (
      <button className="wallet-pill warning" type="button" onClick={onSwitch} disabled={isConnecting}>
        Switch to {expectedChainLabel}
      </button>
    );
  }

  return <span className="wallet-pill connected">{shortAddress(account)}</span>;
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
  const { t } = useI18n();
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

function formatPayLifecycle(lifecycle: PayLifecycle, t?: (key: string, params?: Record<string, string | number>) => string): string {
  switch (lifecycle) {
    case "awaiting_wallet":
      return t ? t("awaitingWallet") : "awaiting wallet";
    case "proving":
      return t ? t("generatingProof") : "generating proof";
    default:
      return lifecycle.replace("_", " ");
  }
}

function remoteConfirmationToLifecycle(confirmation: QrConfirmationPayload): PayLifecycle {
  if (confirmation.status === "paid") {
    return "verified";
  }
  if (confirmation.status === "failed") {
    return "failed";
  }
  return confirmation.request.settlement?.stage === "settling" ? "settling" : "proving";
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
    status: "open",
    destinationChainId: ARC_DESTINATION_CHAIN_ID,
    allowedSourceChainIds: getAllowedSourceChainIds(),
    settlement: {
      destinationChainId: ARC_DESTINATION_CHAIN_ID
    }
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

function ensureNativeGasBalance(balances: Balances, estimate: TransferEstimate | undefined, networkLabel: string) {
  if (!estimate) {
    return;
  }
  if (parseUnits(balances.nativeGas, 18) < estimate.gas * estimate.gasPrice) {
    throw new Error(`Insufficient ${networkLabel} ETH for gas.`);
  }
}

function hasInsufficientGas(
  balances: Balances | undefined,
  transfer: SpendableTransfer | undefined,
  estimate?: TransferEstimate
): boolean {
  return hasInsufficientNativeSpendBalance(balances, transfer, estimate);
}

function usesRemoteSource(
  request: PaymentRequest | undefined,
  sourceChainId: PaymentSourceChainId
): sourceChainId is Exclude<PaymentSourceChainId, typeof ARC_CHAIN_ID> {
  return Boolean(isCrossChainPaymentRequest(request) && isRemotePaymentSourceChainId(sourceChainId));
}

function clearInvalidCrossChainSourceHash(request: PaymentRequest, sourceChainId: PaymentSourceChainId): PaymentRequest {
  if (!isCrossChainPaymentRequest(request)) {
    return request;
  }

  return {
    ...request,
    status: "open",
    txHash: undefined,
    settlement: {
      ...request.settlement,
      destinationChainId: ARC_DESTINATION_CHAIN_ID,
      sourceChainId,
      sourceTxHash: undefined,
      stage: undefined,
      failureReason: undefined
    }
  };
}

function chooseDefaultPaymentSource(request: PaymentRequest): PaymentSourceChainId {
  const allowed = isCrossChainPaymentRequest(request) ? request.allowedSourceChainIds : undefined;
  return allowed?.includes(BASE_SEPOLIA_CHAIN_ID)
    ? BASE_SEPOLIA_CHAIN_ID
    : allowed?.includes(ARC_CHAIN_ID)
      ? ARC_CHAIN_ID
      : allowed?.[0] ?? ARC_CHAIN_ID;
}

function hasInsufficientNativeGas(balances: Balances | undefined, estimate?: TransferEstimate): boolean {
  if (!balances || !estimate) {
    return false;
  }
  try {
    return parseUnits(balances.nativeGas, 18) < estimate.gas * estimate.gasPrice;
  } catch {
    return false;
  }
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
  if (isCrossChainPaymentRequest(request)) {
    switch (request.settlement?.stage) {
      case "submitted":
        return "Source payment submitted";
      case "proving":
        return "Generating Polymer proof";
      case "settling":
        return "Relaying settlement";
      case "settled":
        return "Payment settled";
      case "failed":
        return "Settlement failed";
      default:
        return "Watching Arc settlement";
    }
  }
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
  requests, receipts, account, rpcHealth, rpcStatusLabel, rpcBlockLabel, now, onNavigate, onExport
}: {
  requests: PaymentRequest[];
  receipts: Receipt[];
  account?: `0x${string}`;
  rpcHealth?: RpcHealth;
  rpcStatusLabel: string;
  rpcBlockLabel: string;
  now: Date;
  onNavigate: (target: string) => void;
  onExport: () => void;
}) {
  const { t } = useI18n();
  const totalVolume = requests.reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const verifiedVolume = requests
    .filter((request) => refreshDerivedStatus(request, now).status === "paid")
    .reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const pendingVolume = requests
    .filter((request) => refreshDerivedStatus(request, now).status === "open")
    .reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const paidCount = requests.filter((request) => refreshDerivedStatus(request, now).status === "paid").length;
  const openCount = requests.filter((request) => refreshDerivedStatus(request, now).status === "open").length;
  const expiredCount = requests.filter((request) => refreshDerivedStatus(request, now).status === "expired").length;
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
  const monthlyData = Array.from({ length: 6 }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - offset), 1);
    const month = date.toISOString().slice(0, 7);
    const monthRequests = requests.filter((request) => request.createdAt.slice(0, 7) === month);
    return {
      month: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
      volume: monthRequests.reduce((sum, request) => sum + Number(request.amount || 0), 0),
      count: monthRequests.length
    };
  });

  const hasActivity = requests.length > 0;
  // Compute a 7-day trend delta (second half vs first half) for the
  // headline sparkline chip. This mirrors the logic in MonthlyStats so
  // the two cards tell a consistent story.
  const trendSeries = activityData.map((d) => ({ value: d.volume }));
  const trendDeltaPct = computeTrendDelta(activityData.map((d) => d.volume));
  const onboardingSteps: { label: string; done: boolean; href: string }[] = [
    { label: t("connectWalletStep"), done: Boolean(account), href: "/" },
    { label: t("fundFaucetStep"), done: Boolean(account), href: ARC_FAUCET_URL },
    { label: t("createFirstQrStep"), done: hasActivity, href: "/qr-payments" },
    { label: t("verifyExportStep"), done: receipts.length > 0, href: "/qr-payments" }
  ];
  const completedSteps = onboardingSteps.filter((s) => s.done).length;
  const progressPct = Math.round((completedSteps / onboardingSteps.length) * 100);

  return (
    <div className="ql-dashboard relative z-10 mx-auto flex w-full max-w-[1240px] flex-col pb-16">

      {/* HERO ─ date, greeting, headline counts, period selector */}
      <DashboardHero
        now={now}
        account={account}
        rpcHealthy={rpcHealth?.healthy}
        requestCount={requests.length}
        receiptCount={receipts.length}
        paidCount={paidCount}
        openCount={openCount}
        expiredCount={expiredCount}
      />

      {/* HEADLINE BALANCE ─ full width, the day's main statement */}
      <section className="ql-section">
        <BalanceCard
          totalVolume={totalVolume}
          verifiedVolume={verifiedVolume}
          pendingVolume={pendingVolume}
          requestCount={requests.length}
          receiptCount={receipts.length}
          account={account}
          onNavigate={onNavigate}
          trend={trendSeries}
          trendDeltaPct={trendDeltaPct ?? undefined}
        />
      </section>

      {/* ACTIVITY ─ two charts side by side */}
      <SectionRule label={t("activity") || "Activity"} />
      <section className="ql-section grid grid-cols-1 gap-4 md:grid-cols-2">
        <MonthlyStats activityData={activityData} />
        <SystemStatusCard
          monthlyData={monthlyData}
          rpcStatusLabel={rpcStatusLabel}
          rpcBlockLabel={rpcBlockLabel}
          rpcHealthy={rpcHealth?.healthy}
        />
      </section>

      {/* OPERATIONS ─ quick actions, full-width grid */}
      <SectionRule label={t("operations") || "Operations"} />
      <section className="ql-section">
        <QuickActionsCard
          onNavigate={onNavigate}
          onExport={onExport}
          faucetUrl={ARC_FAUCET_URL}
          hasData={requests.length + receipts.length > 0}
        />
      </section>

      {/* LEDGER ─ recent transactions, full width */}
      <SectionRule label={t("ledger") || "Ledger"} />
      <section className="ql-section">
        <TransactionsTable
          requests={requests}
          receipts={receipts}
          now={now}
          onNavigate={onNavigate}
        />
      </section>

      {/* SIDE NOTES ─ getting started, proof inbox, resources */}
      <SectionRule label={t("notes") || "Notes"} />
      <section className="ql-section grid grid-cols-1 gap-4 md:grid-cols-3">
        <GettingStartedCard
          steps={onboardingSteps}
          completed={completedSteps}
          total={onboardingSteps.length}
          progressPct={progressPct}
        />
        <ProofInboxCard
          requests={requests}
          receipts={receipts}
          onNavigate={onNavigate}
        />
        <ResourcesCard />
      </section>

    </div>
  );
}

/** Section divider — a hairline rule with a small-caps eyebrow label.
 *  Visual rhythm cue between dashboard zones; quiet, not assertive. */
function SectionRule({ label }: { label: string }) {
  return (
    <div className="ql-section-rule" role="presentation">
      <span className="ql-section-rule-label">{label}</span>
      <span className="ql-section-rule-line" />
    </div>
  );
}

/** Dashboard hero — top-of-page band.
 *  Left: date eyebrow, serif greeting, lifetime ledger counts.
 *  Right: period selector + RPC status pill. */
function DashboardHero({
  now,
  account,
  rpcHealthy,
  requestCount,
  receiptCount,
  paidCount,
  openCount,
  expiredCount,
}: {
  now: Date;
  account?: `0x${string}`;
  rpcHealthy?: boolean;
  requestCount: number;
  receiptCount: number;
  paidCount: number;
  openCount: number;
  expiredCount: number;
}) {
  const greeting = getGreeting(now);
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(now);

  return (
    <section className="ql-hero">
      <div className="ql-hero-main">
        <p className="ql-hero-eyebrow">{dateLabel}</p>
        <h1 className="ql-hero-title">
          {greeting}
          {account ? "." : ", connect a wallet to begin."}
        </h1>
        <p className="ql-hero-meta">
          <span><strong>{requestCount}</strong> requests</span>
          <span className="ql-hero-meta-sep">·</span>
          <span><strong>{receiptCount}</strong> receipts</span>
          <span className="ql-hero-meta-sep">·</span>
          <span><strong>{paidCount}</strong> settled</span>
          <span className="ql-hero-meta-sep">·</span>
          <span><strong>{openCount}</strong> open</span>
          {expiredCount > 0 ? (
            <>
              <span className="ql-hero-meta-sep">·</span>
              <span><strong>{expiredCount}</strong> expired</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="ql-hero-aside">
        <div
          role="tablist"
          aria-label="Period"
          className="ql-period-tabs"
        >
          {(["7D", "30D", "90D", "All"] as const).map((p) => {
            const active = p === "All";
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                disabled={!active}
                className={cn("ql-period-tab", active && "is-active")}
                title={active ? undefined : "Coming soon"}
              >
                {p}
              </button>
            );
          })}
        </div>
        <span
          className={cn("ql-rpc-pill", rpcHealthy ? "is-healthy" : "is-starting")}
          title="RPC health"
        >
          <span className="ql-rpc-dot" />
          {rpcHealthy ? "Healthy" : "Starting"}
        </span>
      </div>
    </section>
  );
}

function getGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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

function QuickActionsCard({
  onNavigate,
  onExport,
  faucetUrl,
  hasData
}: {
  onNavigate: (target: string) => void;
  onExport: () => void;
  faucetUrl: string;
  hasData: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="overflow-hidden rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
            {t("actions")}
          </p>
          <h3 className="mt-0.5 text-[13px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
            {t("quickActions")}
          </h3>
        </div>
      </div>
      <div className="grid grid-cols-2">
        <QuickActionTile
          onClick={() => onNavigate("/qr-payments")}
          icon={<QrCode size={15} strokeWidth={1.6} />}
          label={t("createQrRequest")}
          tone="accent"
        />
        <QuickActionTile
          onClick={() => onNavigate("/payments")}
          icon={<Send size={15} strokeWidth={1.6} />}
          label={t("directSend")}
        />
        <QuickActionTile
          onClick={hasData ? onExport : () => onNavigate("/import-export")}
          icon={<Download size={15} strokeWidth={1.6} />}
          label={hasData ? t("exportLedger") : t("importLedger")}
        />
        <QuickActionTile
          href={faucetUrl}
          external
          icon={<ExternalLink size={15} strokeWidth={1.6} />}
          label={t("usdcFaucet")}
        />
      </div>
    </div>
  );
}

function QuickActionTile({
  onClick,
  href,
  external,
  icon,
  label,
  tone
}: {
  onClick?: () => void;
  href?: string;
  external?: boolean;
  icon: ReactNode;
  label: string;
  tone?: "accent";
}) {
  const body = (
    <div className="flex h-full items-center gap-3 px-4 py-3">
      <span
        className={cn(
          "inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[3px] border",
          tone === "accent"
            ? "border-[var(--primary-bg)]/25 bg-[var(--panel-accent)] text-[var(--green-text)]"
            : "border-[var(--line)] bg-[var(--input-bg)] text-[var(--muted)]"
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate text-[12px] font-medium text-[var(--ink)]">{label}</span>
      <ArrowRightLeft size={11} strokeWidth={1.6} className="text-[var(--muted)]/0 transition-colors group-hover:text-[var(--muted)]" />
    </div>
  );
  const className =
    "group block border-b border-r border-[var(--line-soft)] text-left transition-colors hover:bg-[var(--line-soft)]/60 focus-visible:bg-[var(--line-soft)]/60 focus-visible:outline-none [&:nth-child(2n)]:border-r-0 last:border-b-0 [&:nth-last-child(-n+2)]:border-b-0";
  if (href) {
    return (
      <a
        className={className}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
      >
        {body}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  );
}

function ProofInboxCard({
  requests,
  receipts,
  onNavigate
}: {
  requests: PaymentRequest[];
  receipts: Receipt[];
  onNavigate: (target: string) => void;
}) {
  const paidReceipts = receipts
    .map((receipt) => ({
      receipt,
      request: requests.find((item) => item.id === receipt.requestId)
    }))
    .filter((item) => Boolean(item.request))
    .slice(0, 3);
  return (
    <div className="overflow-hidden rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
            Proof inbox
          </p>
          <h3 className="mt-0.5 text-[13px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
            Arc Testnet PSPs
          </h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--green-text)]/25 bg-[var(--green-bg)] px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--green-text)]">
          <ShieldCheck size={11} strokeWidth={1.7} />
          {receipts.length}
        </span>
      </div>

      <div className="px-5 py-3">
        <p className="text-[11.5px] leading-relaxed text-[var(--muted)]">
          Settled receipts are ready for PSP lookup, CLI verification, statement bundles, and webhook delivery.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-sm border border-[var(--line-soft)] bg-[var(--input-bg)] px-2.5 py-2">
            <dt className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-[var(--muted)]">Webhook</dt>
            <dd className="mt-1 font-mono text-[10px] text-[var(--ink)]">/api/webhooks</dd>
          </div>
          <div className="rounded-sm border border-[var(--line-soft)] bg-[var(--input-bg)] px-2.5 py-2">
            <dt className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-[var(--muted)]">Failures</dt>
            <dd className="mt-1 font-mono text-[10px] text-[var(--ink)]">events table</dd>
          </div>
        </dl>
      </div>

      {paidReceipts.length > 0 ? (
        <ul className="divide-y divide-[var(--line-soft)] border-y border-[var(--line-soft)]">
          {paidReceipts.map(({ receipt, request }) => (
            <li key={receipt.txHash}>
              <button
                type="button"
                onClick={() => request && onNavigate(`/pay?r=${encodeRequestPayload(request)}`)}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-[var(--line-soft)]/50"
              >
                <FileText size={13} strokeWidth={1.6} className="text-[var(--muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-[var(--ink)]">
                    {request?.label ?? receipt.requestId}
                  </span>
                  <span className="block font-mono text-[10px] text-[var(--muted)]">
                    {shortAddress(receipt.txHash, 8, 6)}
                  </span>
                </span>
                <span className="font-mono text-[10.5px] text-[var(--ink-soft)]">
                  {receipt.amount} {receipt.token}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-y border-[var(--line-soft)] px-5 py-4">
          <p className="text-[11.5px] text-[var(--muted)]">
            Paid QR requests will appear here as proof-ready Arc Testnet receipts.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-[var(--line-soft)]">
        <button
          type="button"
          onClick={() => onNavigate("/statements")}
          className="px-4 py-2.5 text-[11.5px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--line-soft)]/50"
        >
          Statements
        </button>
        <button
          type="button"
          onClick={() => onNavigate("/docs")}
          className="px-4 py-2.5 text-[11.5px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--line-soft)]/50"
        >
          Verify docs
        </button>
      </div>
    </div>
  );
}

function GettingStartedCard({
  steps,
  completed,
  total,
  progressPct
}: {
  steps: { label: string; done: boolean; href: string }[];
  completed: number;
  total: number;
  progressPct: number;
}) {
  const { t } = useI18n();
  const allDone = completed === total;
  return (
    <div className="overflow-hidden rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
            {t("onboarding")}
          </p>
          <h3 className="mt-0.5 text-[13px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
            {allDone ? t("allStepsComplete") : t("gettingStarted")}
          </h3>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-[var(--muted)]">
          {completed}/{total}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-[2px] w-full bg-[var(--line-soft)]">
        <div
          className="h-full bg-[var(--primary-bg)] transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <ul className="divide-y divide-[var(--line-soft)]">
        {steps.map((step) => (
          <li key={step.label}>
            <a
              href={step.href}
              target={step.href.startsWith("http") ? "_blank" : undefined}
              rel={step.href.startsWith("http") ? "noreferrer" : undefined}
              className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-[var(--line-soft)]/50"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition-colors",
                  step.done
                    ? "border-[var(--primary-bg)] bg-[var(--primary-bg)]"
                    : "border-[var(--line-strong)] bg-transparent"
                )}
              >
                {step.done && (
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 stroke-[var(--primary-text)] stroke-[2]">
                    <path d="M2 5l2 2 4-4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span
                className={cn(
                  "flex-1 text-[12px]",
                  step.done ? "text-[var(--muted)] line-through decoration-[var(--line)]" : "text-[var(--ink)]"
                )}
              >
                {step.label}
              </span>
              <ArrowRightLeft size={11} strokeWidth={1.6} className="text-[var(--muted)]" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusDigestCard({
  paidCount,
  openCount,
  expiredCount,
  rpcHealthy
}: {
  paidCount: number;
  openCount: number;
  expiredCount: number;
  rpcHealthy?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="overflow-hidden rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
            {t("status")}
          </p>
          <h3 className="mt-0.5 text-[13px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
            {t("atGlance")}
          </h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--line)] bg-[var(--input-bg)] px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              rpcHealthy ? "bg-[var(--green-text)]" : "bg-[var(--yellow-text)]"
            )}
          />
          {rpcHealthy ? t("operational") : t("initializing")}
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-[var(--line-soft)]">
        <DigestCell label={t("paid")}    value={paidCount}    tone="accent" />
        <DigestCell label={t("open")}    value={openCount}    tone="info" />
        <DigestCell label={t("expired")} value={expiredCount} tone="muted" />
      </div>
    </div>
  );
}

function DigestCell({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "accent" | "info" | "muted";
}) {
  const toneClass =
    tone === "accent"
      ? "text-[var(--green-text)]"
      : tone === "info"
        ? "text-[var(--blue-text)]"
        : "text-[var(--muted)]";
  return (
    <div className="px-3 py-4 text-center">
      <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </p>
      <p className={cn("text-[18px] font-semibold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}

function ResourcesCard() {
  const { t } = useI18n();
  const links = [
    { label: t("documentation"), href: getDocsHref(), external: false, icon: BookOpen },
    { label: t("usdcFaucet"),   href: ARC_FAUCET_URL, external: true,  icon: ExternalLink },
    { label: "Arcscan",       href: ARC_EXPLORER_URL, external: true, icon: ExternalLink },
    { label: t("sourceGithub"), href: "https://github.com/Disburse-pay", external: true, icon: ExternalLink }
  ];
  return (
    <div className="overflow-hidden rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]">
      <div className="border-b border-[var(--line)] px-5 py-3.5">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
          {t("referenceSection")}
        </p>
        <h3 className="mt-0.5 text-[13px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
          {t("resources")}
        </h3>
      </div>
      <ul>
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <li key={link.label}>
              <a
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noreferrer" : undefined}
                className="flex items-center gap-3 border-b border-[var(--line-soft)] px-5 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--line-soft)]/50"
              >
                <Icon size={13} strokeWidth={1.6} className="text-[var(--muted)]" />
                <span className="flex-1 text-[12px] text-[var(--ink)]">{link.label}</span>
                <span className="font-mono text-[10px] text-[var(--muted)]">
                  {link.external ? "\u2197" : "\u2192"}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
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
      <RouteHero eyebrow={t("backup") || "Backup"} title={t("importExportTitle") || "Backup & Restore"} />

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

function RiskCheckPanel({ request, account, wrongChain, isExpired, requests }: {
  request: PaymentRequest;
  account?: `0x${string}`;
  wrongChain: boolean;
  isExpired: boolean;
  requests: PaymentRequest[];
}) {
  const networkOk = !wrongChain && Boolean(account);
  const recipientOk = Boolean(request.recipient);
  const tokenOk = request.token === "USDC" || request.token === "EURC";
  const amountOk = Number(request.amount) > 0;
  const notExpired = !isExpired;
  const noDuplicate = !requests.some(r => r.id !== request.id && r.txHash && r.recipient === request.recipient && r.amount === request.amount && r.token === request.token && r.status === "paid");

  const checks = [
    { label: "Correct network", ok: networkOk },
    { label: "Recipient matches request", ok: recipientOk },
    { label: "Token matches request", ok: tokenOk },
    { label: "Amount matches request", ok: amountOk },
    { label: "Request not expired", ok: notExpired },
    { label: "No duplicate payment detected", ok: noDuplicate }
  ];

  return (
    <div className="risk-panel">
      <div className="risk-panel-title">Pre-payment checks</div>
      {checks.map(c => (
        <div className="risk-row" key={c.label}>
          <span className={`risk-icon ${c.ok ? "pass" : "fail"}`}>{c.ok ? "✓" : "✗"}</span>
          <span>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Milestones Page ----------

function MilestonesPage() {
  const [chains, setChains] = useState<MilestoneChainView[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formRecipient, setFormRecipient] = useState("");
  const [formCounterparty, setFormCounterparty] = useState("");
  const [formSteps, setFormSteps] = useState<{ label: string; amount: string }[]>([
    { label: "", amount: "" }
  ]);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchChains();
  }, []);

  async function fetchChains() {
    setLoading(true);
    try {
      const res = await fetch("/api/milestones");
      if (res.ok) {
        const data = await res.json();
        setChains(data.chains || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setNotice(null);
    try {
      const res = await fetch("/api/milestones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: formTitle,
          recipient: formRecipient,
          counterparty: formCounterparty || undefined,
          token: "USDC",
          steps: formSteps.filter((s) => s.label && s.amount)
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create");
      }
      setNotice({ tone: "success", text: "Milestone chain created." });
      setShowForm(false);
      setFormTitle("");
      setFormRecipient("");
      setFormCounterparty("");
      setFormSteps([{ label: "", amount: "" }]);
      await fetchChains();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Error" });
    }
    setCreating(false);
  }

  function addStep() {
    setFormSteps([...formSteps, { label: "", amount: "" }]);
  }

  function updateStep(index: number, field: "label" | "amount", value: string) {
    const next = [...formSteps];
    next[index] = { ...next[index], [field]: value };
    setFormSteps(next);
  }

  function removeStep(index: number) {
    if (formSteps.length <= 1) return;
    setFormSteps(formSteps.filter((_, i) => i !== index));
  }

  return (
    <>
      <RouteHero eyebrow="Conditional Payments" title="Milestone Invoices" />

      <section className="ql-page" aria-labelledby="milestones-heading">
        <div className="ql-page-head">
          <p className="ql-page-lede">
            Multi-step payment chains where each step unlocks only when the previous payment is verified
            with a Portable Settlement Proof.
          </p>
          <button className="primary-button" type="button" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "New chain"}
          </button>
        </div>

        {notice && (
          <div className={`notice ${notice.tone === "success" ? "notice-success" : "notice-error"}`}>
            {notice.text}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleCreate} className="ql-form-card">
            <div className="form-section">
              <p className="form-section-label">Project</p>
              <Field label="Title">
                <input
                  placeholder="Website redesign"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  required
                />
              </Field>
            </div>

            <div className="form-section">
              <p className="form-section-label">Parties</p>
              <Field label="Recipient address">
                <input
                  placeholder="0x..."
                  value={formRecipient}
                  onChange={(e) => setFormRecipient(e.target.value)}
                  required
                  spellCheck={false}
                />
              </Field>
              <Field label="Counterparty / payer (optional)">
                <input
                  placeholder="0x..."
                  value={formCounterparty}
                  onChange={(e) => setFormCounterparty(e.target.value)}
                  spellCheck={false}
                />
              </Field>
            </div>

            <div className="form-section">
              <p className="form-section-label">Steps</p>
              <div className="ql-milestone-steps">
                {formSteps.map((step, i) => (
                  <div key={i} className="ql-milestone-step-row">
                    <span className="ql-milestone-step-index">{i + 1}.</span>
                    <input
                      className="ql-milestone-step-label"
                      placeholder="Step label"
                      value={step.label}
                      onChange={(e) => updateStep(i, "label", e.target.value)}
                      required
                    />
                    <input
                      className="ql-milestone-step-amount"
                      placeholder="0.00"
                      type="number"
                      step="0.01"
                      value={step.amount}
                      onChange={(e) => updateStep(i, "amount", e.target.value)}
                      required
                    />
                    <span className="ql-milestone-step-unit">USDC</span>
                    {formSteps.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeStep(i)}
                        className="ql-milestone-step-remove"
                        aria-label="Remove step"
                      >
                        \u2715
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={addStep} className="text-button ql-milestone-add-step">
                  + Add step
                </button>
              </div>
            </div>

            <div className="action-row">
              <button className="primary-button" type="submit" disabled={creating}>
                {creating ? "Creating\u2026" : "Create milestone chain"}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="ql-loading">Loading\u2026</p>
        ) : chains.length === 0 ? (
          <div className="ql-empty">
            <p>No milestone chains yet.</p>
            <p className="ql-empty-sub">Create your first conditional payment flow above.</p>
          </div>
        ) : (
          <div className="ql-milestone-list">
            {chains.map((chain) => {
              const totalSteps = chain.steps?.length || 0;
              const completedSteps = (chain.steps || []).filter((s) => s.status === "completed").length;
              return (
                <article key={chain.id} className="ql-milestone-card">
                  <header className="ql-milestone-card-head">
                    <div>
                      <h3>{chain.title}</h3>
                      <p className="ql-milestone-meta">
                        <span className="ql-milestone-amount">{chain.totalAmount}</span>{" "}
                        <span className="ql-milestone-unit">USDC</span>
                        <span className="ql-milestone-sep">\u00B7</span>
                        <span>
                          {completedSteps} of {totalSteps} steps complete
                        </span>
                      </p>
                    </div>
                    <span className={cn("ql-milestone-badge", `is-${chain.status}`)}>
                      {chain.status}
                    </span>
                  </header>

                  <div className="ql-milestone-progress" role="presentation">
                    {(chain.steps || []).map((step: MilestoneStepView, i: number) => (
                      <span
                        key={i}
                        className={cn(
                          "ql-milestone-progress-seg",
                          step.status === "completed" && "is-complete",
                          (step.status === "unlocked" || step.status === "payment_pending") && "is-active"
                        )}
                        title={`${step.label}: ${step.status}`}
                      />
                    ))}
                  </div>

                  <ul className="ql-milestone-step-list">
                    {(chain.steps || []).map((step: MilestoneStepView, i: number) => (
                      <li key={i} className={cn("ql-milestone-step-item", `is-${step.status}`)}>
                        <span className="ql-milestone-step-icon" aria-hidden="true">
                          {step.status === "completed" ? "\u2713" : step.status === "locked" ? "\uD83D\uDD12" : "\u25CB"}
                        </span>
                        <span className="ql-milestone-step-text">{step.label}</span>
                        <span className="ql-milestone-step-money">
                          {step.amount} <em>USDC</em>
                        </span>
                        <span className="ql-milestone-step-status">{step.status}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

type MilestoneChainView = {
  id: string;
  title: string;
  totalAmount: string;
  status: string;
  steps: MilestoneStepView[];
};
type MilestoneStepView = {
  label: string;
  amount: string;
  status: string;
  pspUid?: string;
};

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
      <RouteHero eyebrow="Reconciliation" title="Settlement Statements" />

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
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </Field>
              <Field label="To">
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
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
