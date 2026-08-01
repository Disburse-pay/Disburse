import {
  type ComponentProps,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Check, Download, FileText, Moon, ShieldCheck, Sun, Wallet } from "lucide-react";
import Sidebar from "@/src/components/Sidebar";
import Header from "@/src/components/Header";
import SidePanel from "@/src/components/ui/SidePanel";
import DateInput from "@/src/components/ui/DateInput";
import StatementsPage from "@/src/components/StatementsPage";
import SettingsPanel from "@/src/components/SettingsPanel";
import DashboardPage from "@/src/components/DashboardPage";
import ImportExportPage from "@/src/components/ImportExportPage";
import QrShareCard from "@/src/components/QrShareCard";
import HandleHint from "@/src/components/HandleHint";
import InboxPanel, { useInboxUnread } from "@/src/components/InboxPanel";
import DepositPanel from "@/src/components/DepositPanel";
import { fetchGatewayBalance } from "@/src/lib/gateway/balance";
import { transferViaGateway } from "@/src/lib/gateway/transfer";
import { registerDirectPayment } from "@/src/lib/directApi";
import { clearHistoryAuthorization, fetchWalletHistory } from "@/src/lib/historyApi";
import { clearInboxAuth } from "@/src/lib/notificationsApi";
import { isCurrentWalletAccount, isSameWalletAccount } from "@/src/lib/accountScope";
import { assertProviderAccount } from "@/src/lib/providerAccount";
import ReceiptView from "@/src/components/receipt";
import { cn } from "@/src/lib/utils";
import { createSettlementAttestation, type SettlementAttestation } from "./lib/attestation";
import { generateSettlementProof, downloadSettlementProof, downloadUBLInvoice } from "./lib/compliance";

import { formatUnits, zeroAddress, type Hash } from "viem";
import { ARC_CHAIN_ID, ARC_FAUCET_URL } from "./lib/arc";
import { errorToMessage } from "./lib/errors";
import { I18nProvider, useI18n } from "./lib/i18n";
import { type AppSettings, loadSettings } from "./lib/settings";
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
  waitForConfirmedTokenTransfer,
  type Balances,
  type EthereumProvider,
  type SpendableTransfer,
  type TokenTransfer,
  type TransferEstimate
} from "./lib/onchain";
import {
  buildShareUrl,
  decodeRequestReference,
  formatTokenAmount,
  hasSameRequestPayload,
  isPaymentExpired,
  isPaymentPayable,
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
import { buildExportBundle, clearBrowserLedgerCache, upsertReceipt, upsertRequest } from "./lib/storage";
import { handleFromInput, looksLikeHandleInput, resolveIdByHandle } from "./lib/idsApi";
import {
  confirmRemoteQrPayment,
  createRemoteQrRequest,
  fetchRemoteQrStatus,
  recordRemoteQrSubmission,
  type QrConfirmationPayload
} from "./lib/qrApi";
import { shouldHideQrForStatus, type QrStatusPayload } from "./lib/realtime";
import { requestQrPaymentAuthorization } from "./lib/qrAuthorization";
import {
  buildPaymentRequestAuthorizationTypedData,
  PAYMENT_REQUEST_AUTH_TTL_SECONDS
} from "./lib/paymentRequestNotificationAuthorization";
import { useDisburseDynamicWallet } from "./lib/dynamic";

const QR_STATUS_POLL_INTERVAL_MS = 5_000;
const QR_STATUS_MAX_POLLS = 60;
const DISBURSE_EIP712_DOMAIN_TYPES = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }
] as const;

import { cx } from "./lib/cx";
import { THEME_KEY, getInitialTheme, type Theme } from "./lib/theme";
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

type PendingDirectTransfer = {
  owner: `0x${string}`;
  hash: Hash;
  transfer: TokenTransfer;
  expectedFrom: `0x${string}`;
  label: string;
  note?: string;
  invoiceDate: string;
  gatewayHandle?: string;
  submittedAt: string;
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
  const [page, setPage] = useState<Page>(() => getInitialPage());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [routeKey, setRouteKey] = useState(() => getCurrentRouteKey());
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [directForm, setDirectForm] = useState<DirectFormState>(emptyDirectForm);
  const [qrForm, setQrForm] = useState<QrFormState>(emptyQrForm);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [paySurfaceRequest, setPaySurfaceRequest] = useState<PaymentRequest | undefined>();
  const [paySurfaceReceipt, setPaySurfaceReceipt] = useState<Receipt | undefined>();
  const [shareUrl, setShareUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [directNotice, setDirectNotice] = useState<Notice | undefined>();
  const [qrNotice, setQrNotice] = useState<Notice | undefined>();
  const [payNotice, setPayNotice] = useState<Notice | undefined>();
  const [walletNotice, setWalletNotice] = useState<Notice | undefined>();
  const [account, setAccount] = useState<`0x${string}` | undefined>();
  const activeAccountRef = useRef<`0x${string}` | undefined>(account);
  activeAccountRef.current = account;
  const [chainId, setChainId] = useState<number | undefined>();
  const [directBalances, setDirectBalances] = useState<Balances | undefined>();
  const [payBalances, setPayBalances] = useState<Balances | undefined>();
  const [directEstimate, setDirectEstimate] = useState<TransferEstimate | undefined>();
  const [payEstimate, setPayEstimate] = useState<TransferEstimate | undefined>();
  const [pendingDirect, setPendingDirect] = useState<PendingDirectTransfer | undefined>();
  const pendingDirectByOwnerRef = useRef(new Map<string, PendingDirectTransfer>());
  const [directHash, setDirectHash] = useState<Hash | undefined>();
  const [rpcHealth, setRpcHealth] = useState<RpcHealth | undefined>();
  const [now, setNow] = useState(() => new Date());
  const [isCreatingQr, setIsCreatingQr] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isEstimatingDirect, setIsEstimatingDirect] = useState(false);
  const [isSendingDirect, setIsSendingDirect] = useState(false);
  const [isReconcilingDirect, setIsReconcilingDirect] = useState(false);
  const [isEstimatingPay, setIsEstimatingPay] = useState(false);
  const [isPayingQr, setIsPayingQr] = useState(false);
  const [payLifecycle, setPayLifecycle] = useState<PayLifecycle>("idle");
  const [payRequestVerified, setPayRequestVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [payAttestation, setPayAttestation] = useState<SettlementAttestation | undefined>();
  const [appSettings] = useState<AppSettings>(() => loadSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const [inboxRefreshKey, setInboxRefreshKey] = useState(0);
  const inboxUnreadCount = useInboxUnread(account, inboxRefreshKey);
  const dynamicWallet = useDisburseDynamicWallet();

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedId) ?? requests[0],
    [requests, selectedId]
  );

  const payRequest = paySurfaceRequest;

  const selectedReceipt = useMemo(
    () => receipts.find((receipt) => receipt.requestId === selectedRequest?.id),
    [receipts, selectedRequest?.id]
  );

  const payReceipt = paySurfaceReceipt;

  const wrongChain = Boolean(account && chainId !== undefined && chainId !== ARC_CHAIN_ID);
  const payWrongChain = wrongChain;
  const hasWalletProvider = dynamicWallet.enabled || Boolean(getInjectedProvider());
  const payDisplayStatus = payRequest ? refreshDerivedStatus(payRequest, now).status : "open";
  const payIsExpired = payRequest ? isPaymentExpired(payRequest, now) : false;
  const payIsPayable = payRequestVerified && payRequest ? isPaymentPayable(payRequest, now) : false;
  // A Disburse ID is paid from the sender's Circle Gateway balance, not the
  // wallet token balance shown for ordinary address transfers.
  const directUsesGateway = looksLikeHandleInput(directForm.recipient);
  const directWalletInsufficientToken = useInsufficientToken(directBalances, directForm);
  const directInsufficientToken = directUsesGateway ? false : directWalletInsufficientToken;
  const payInsufficientToken = useInsufficientToken(payBalances, payRequest);
  const directMissingGas = directUsesGateway
    ? false
    : hasInsufficientGas(directBalances, directForm, directEstimate);
  const payMissingGas = hasInsufficientGas(payBalances, payRequest, payEstimate);
  const rpcIsStale = Boolean(rpcHealth && Date.now() - new Date(rpcHealth.checkedAt).getTime() > 18_000);
  const rpcStatusLabel = !rpcHealth
    ? "checking"
    : !rpcHealth.healthy
      ? "rpc down"
      : rpcIsStale
        ? "stale"
        : (rpcHealth.activeEndpoint?.label ?? "active");
  const rpcBlockLabel =
    rpcHealth?.healthy && rpcHealth.blockNumber ? `block ${rpcHealth.blockNumber}` : rpcStatusLabel;

  const getWalletProvider = useCallback(async (): Promise<EthereumProvider | undefined> => {
    if (dynamicWallet.enabled) {
      return dynamicWallet.getEthereumProvider();
    }
    return getInjectedProvider();
  }, [dynamicWallet]);

  const transitionAccount = useCallback((nextAccount: `0x${string}` | undefined) => {
    const previousAccount = activeAccountRef.current;
    if (isSameWalletAccount(previousAccount, nextAccount)) {
      setAccount(nextAccount);
      return;
    }

    // Change the ownership guard before React renders the new wallet. This
    // prevents late responses and even a single paint from exposing the prior
    // wallet's ledger or bearer-style authorizations.
    activeAccountRef.current = nextAccount;
    clearHistoryAuthorization();
    clearInboxAuth(previousAccount);
    setRequests([]);
    setReceipts([]);
    setSelectedId(undefined);
    const nextPending = nextAccount
      ? pendingDirectByOwnerRef.current.get(nextAccount.toLowerCase())
      : undefined;
    setPendingDirect(nextPending);
    setDirectHash(nextPending?.hash);
    setDirectForm(emptyDirectForm);
    setQrForm({
      ...emptyQrForm,
      recipient: nextAccount ?? "",
      invoiceDate: todayInputValue()
    });
    setDirectNotice(undefined);
    setQrNotice(undefined);
    setWalletNotice(undefined);
    setShareUrl("");
    setQrDataUrl("");
    setDirectBalances(undefined);
    setPayBalances(undefined);
    setDirectEstimate(undefined);
    setPayEstimate(undefined);
    setAccount(nextAccount);
  }, []);

  function applyPaySurfacePayload(
    payload: QrStatusPayload,
    requestToken: string,
    paymentAuthorization?: `0x${string}`
  ) {
    const request: PaymentRequest = {
      ...payload.request,
      requestToken,
      paymentAuthorization
    };
    setPaySurfaceRequest(request);
    setPaySurfaceReceipt(payload.receipt);

    const activeAccount = activeAccountRef.current;
    if (!activeAccount) {
      return;
    }
    const accountLower = activeAccount.toLowerCase();
    const isOwnedLedgerRecord =
      request.recipient.toLowerCase() === accountLower ||
      payload.receipt?.from.toLowerCase() === accountLower;
    if (!isOwnedLedgerRecord) {
      return;
    }
    setRequests((current) => upsertRequest(current, request));
    if (payload.receipt) {
      setReceipts((current) => upsertReceipt(current, payload.receipt as Receipt));
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0a0b0e" : "#f6f6f3");
  }, [theme]);

  useEffect(() => {
    clearBrowserLedgerCache();
  }, []);

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
      statements: "Statements · Disburse"
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
    const ledgerOwner = activeAccountRef.current;
    if (page !== "qr-payments" || !selectedRequest?.requestToken || !ledgerOwner) {
      return;
    }

    let isActive = true;
    let timer: number | undefined;
    let pollCount = 0;
    let requestInFlight = false;
    const requestToken = selectedRequest.requestToken;

    const scheduleNext = () => {
      if (isActive && pollCount < QR_STATUS_MAX_POLLS) {
        timer = window.setTimeout(poll, QR_STATUS_POLL_INTERVAL_MS);
      }
    };

    const poll = async () => {
      if (!isActive || requestInFlight || pollCount >= QR_STATUS_MAX_POLLS) {
        return;
      }
      requestInFlight = true;
      pollCount += 1;
      try {
        const payload = await fetchRemoteQrStatus(selectedRequest.id, requestToken);
        if (!isActive || !isCurrentWalletAccount(activeAccountRef.current, ledgerOwner)) {
          return;
        }
        if (payload) {
          applyQrStatusPayload(payload, setRequests, setReceipts, requestToken);
          if (payload.message) {
            setQrNotice({
              tone:
                payload.request.status === "paid"
                  ? "success"
                  : shouldHideQrForStatus(payload.request.status)
                    ? "error"
                    : "info",
              text: payload.message
            });
          }
          if (shouldHideQrForStatus(payload.request.status)) {
            return;
          }
        }
      } catch (error) {
        if (isActive) {
          setQrNotice({ tone: "error", text: errorToMessage(error) });
        }
      } finally {
        requestInFlight = false;
      }
      scheduleNext();
    };

    void poll();

    return () => {
      isActive = false;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [account, page, selectedRequest?.id, selectedRequest?.requestToken]);

  useEffect(() => {
    if (!selectedRequest?.requestToken) {
      setShareUrl("");
      return;
    }
    setShareUrl(buildShareUrl(selectedRequest, getPayShareOrigin()));
  }, [selectedRequest]);

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

    let isActive = true;
    const encoded = new URLSearchParams(window.location.search).get("r");
    setPayRequestVerified(false);
    setPaySurfaceRequest(undefined);
    setPaySurfaceReceipt(undefined);
    setPayBalances(undefined);
    setPayEstimate(undefined);
    setPayLifecycle("idle");

    if (!encoded) {
      setPayNotice({ tone: "error", text: "Payment QR link is missing request data." });
      return;
    }

    try {
      const reference = decodeRequestReference(encoded);
      setPayNotice({ tone: "info", text: "Verifying this payment request with Disburse." });
      void fetchRemoteQrStatus(reference.id, reference.requestToken)
        .then((payload) => {
          if (!isActive) {
            return;
          }
          if (!payload || payload.request.id !== reference.id) {
            throw new Error(
              "Disburse could not verify this payment request. Ask the requester for a fresh QR code."
            );
          }
          applyPaySurfacePayload(payload, reference.requestToken);
          setPayRequestVerified(true);
          setPayNotice({ tone: "success", text: "Payment request verified with Disburse." });
        })
        .catch((error) => {
          if (!isActive) {
            return;
          }
          setPaySurfaceRequest(undefined);
          setPaySurfaceReceipt(undefined);
          setPayRequestVerified(false);
          setPayNotice({ tone: "error", text: errorToMessage(error) });
        });
    } catch (error) {
      setPayNotice({ tone: "error", text: errorToMessage(error) });
    }

    return () => {
      isActive = false;
    };
  }, [page, routeKey]);

  useEffect(() => {
    if (!dynamicWallet.enabled) {
      return;
    }

    let isActive = true;
    const syncDynamicWallet = async () => {
      if (!dynamicWallet.primaryWallet) {
        transitionAccount(undefined);
        setChainId(undefined);
        setDirectBalances(undefined);
        setPayBalances(undefined);
        setDirectEstimate(undefined);
        setPayEstimate(undefined);
        return;
      }

      const nextAccount = dynamicWallet.getAccount();
      if (!nextAccount) {
        transitionAccount(undefined);
        setChainId(undefined);
        setWalletNotice({ tone: "error", text: "Dynamic connected wallet is not an EVM wallet." });
        return;
      }

      const nextChainId = await dynamicWallet.getChainId();
      if (!isActive) {
        return;
      }

      transitionAccount(nextAccount);
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
  }, [dynamicWallet, transitionAccount]);

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
      transitionAccount(accounts?.[0] ? validateRecipient(accounts[0]) : undefined);
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
  }, [dynamicWallet.enabled, transitionAccount]);

  useEffect(() => {
    let isActive = true;
    clearHistoryAuthorization();

    // Ledger state is deliberately memory-only and keyed by the active wallet.
    // Clear synchronously before any fetch so account B never renders account
    // A's history while its signed Supabase snapshot is loading.
    setRequests([]);
    setReceipts([]);
    setSelectedId(undefined);
    const accountPending = account ? pendingDirectByOwnerRef.current.get(account.toLowerCase()) : undefined;
    setPendingDirect(accountPending);
    setDirectHash(accountPending?.hash);
    setDirectForm(emptyDirectForm);
    setQrForm({ ...emptyQrForm, recipient: account ?? "", invoiceDate: todayInputValue() });
    setDirectNotice(undefined);
    setQrNotice(undefined);
    setShareUrl("");
    setQrDataUrl("");

    if (!account) {
      return () => {
        isActive = false;
      };
    }
    const historyOwner = account;

    const loadHistory = async () => {
      const provider = await getWalletProvider();
      if (!provider || !isActive || !isCurrentWalletAccount(activeAccountRef.current, historyOwner)) {
        return;
      }
      try {
        const history = await fetchWalletHistory(provider, historyOwner);
        if (!isActive || !isCurrentWalletAccount(activeAccountRef.current, historyOwner)) {
          return;
        }
        setRequests(history.requests);
        setReceipts(history.receipts);
        setSelectedId(history.requests[0]?.id);
        if (history.hasMore) {
          setWalletNotice({
            tone: "info",
            text: "Showing the newest 200 account-scoped payment records. Export a statement for a complete accounting range."
          });
        }
      } catch (error) {
        if (isActive && isCurrentWalletAccount(activeAccountRef.current, historyOwner)) {
          setWalletNotice({ tone: "error", text: errorToMessage(error) });
        }
      }
    };

    void loadHistory();
    return () => {
      isActive = false;
    };
  }, [account, getWalletProvider]);

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
    let isActive = true;
    if (!account) {
      return () => {
        isActive = false;
      };
    }

    const balanceOwner = account;
    if (page === "payments" && directForm.recipient.trim() && directForm.amount.trim() && !wrongChain) {
      try {
        const transfer = buildTokenTransfer(directForm);
        void readBalances(balanceOwner, transfer)
          .then((balances) => {
            if (isActive && activeAccountRef.current === balanceOwner) {
              setDirectBalances(balances);
            }
          })
          .catch((error) => {
            if (isActive && activeAccountRef.current === balanceOwner) {
              setDirectNotice({ tone: "error", text: errorToMessage(error) });
            }
          });
      } catch (error) {
        setDirectNotice({ tone: "error", text: errorToMessage(error) });
      }
    }

    if (page === "pay" && payRequest && payRequestVerified && !payWrongChain) {
      const request = payRequest;
      void readBalances(balanceOwner, request)
        .then((balances) => {
          if (isActive && activeAccountRef.current === balanceOwner) {
            setPayBalances(balances);
          }
        })
        .catch((error) => {
          if (isActive && activeAccountRef.current === balanceOwner) {
            setPayNotice({ tone: "error", text: errorToMessage(error) });
          }
        });
    }

    return () => {
      isActive = false;
    };
  }, [account, directForm, wrongChain, payWrongChain, page, payRequestVerified, payRequest]);

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
      transitionAccount(nextAccount);
      setChainId(nextChainId);
      setWalletNotice({ tone: "success", text: "Wallet connected." });
    } catch (error) {
      setWalletNotice({ tone: "error", text: errorToMessage(error) });
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnectWallet() {
    const disconnectedAccount = account;
    try {
      if (dynamicWallet.enabled) {
        await dynamicWallet.disconnect();
      }
    } catch (error) {
      setWalletNotice({ tone: "error", text: errorToMessage(error) });
      return;
    }
    if (disconnectedAccount) {
      clearHistoryAuthorization(disconnectedAccount);
    }
    transitionAccount(undefined);
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

    const estimateOwner = account;
    setIsEstimatingDirect(true);
    setDirectNotice({
      tone: "info",
      text: directUsesGateway ? "Checking Disburse balance." : "Estimating direct transfer."
    });

    try {
      if (directUsesGateway) {
        await resolveGatewayRecipient(directForm);
        if (!isCurrentWalletAccount(activeAccountRef.current, estimateOwner)) return;
        setDirectEstimate(undefined);
        setDirectNotice({
          tone: "success",
          text: "This payment will credit the recipient's Disburse balance. Circle Gateway confirms its fee when you send."
        });
        return;
      }
      const transfer = buildTokenTransfer(directForm);
      const nextEstimate = await estimatePayment(estimateOwner, transfer);
      if (!isCurrentWalletAccount(activeAccountRef.current, estimateOwner)) return;
      setDirectEstimate(nextEstimate);
      await refreshDirectBalances(transfer);
      if (isCurrentWalletAccount(activeAccountRef.current, estimateOwner)) {
        setDirectNotice({ tone: "success", text: "Estimate ready." });
      }
    } catch (error) {
      if (isCurrentWalletAccount(activeAccountRef.current, estimateOwner)) {
        setDirectNotice({ tone: "error", text: errorToMessage(error) });
      }
    } finally {
      setIsEstimatingDirect(false);
    }
  }

  function rememberPendingDirect(
    next: PendingDirectTransfer | undefined,
    owner = next?.owner ?? pendingDirect?.owner ?? account
  ) {
    if (!owner) return;
    const ownerKey = owner.toLowerCase();
    if (next) {
      pendingDirectByOwnerRef.current.set(ownerKey, next);
    } else {
      pendingDirectByOwnerRef.current.delete(ownerKey);
    }
    if (isCurrentWalletAccount(activeAccountRef.current, owner)) {
      setPendingDirect(next);
      setDirectHash(next?.hash);
    }
  }

  async function settlePendingDirect(pending: PendingDirectTransfer) {
    if (!account || pending.owner.toLowerCase() !== account.toLowerCase()) {
      throw new Error(
        "This recovery journal belongs to a different wallet. Switch back to that wallet before verifying it."
      );
    }
    await waitForConfirmedTokenTransfer(pending.hash, pending.transfer, pending.expectedFrom);
    if (activeAccountRef.current?.toLowerCase() !== pending.owner.toLowerCase()) {
      throw new Error(
        "Wallet changed while verification was running. Switch back to the submitting wallet and retry Verify; do not resend."
      );
    }
    const provider = await getWalletProvider();
    if (!provider) {
      throw new Error("The transfer is confirmed, but its wallet is unavailable for server registration.");
    }
    await assertProviderAccount(provider, pending.owner);
    const { request, receipt } = await registerDirectPayment(provider, pending.owner, {
      txHash: pending.hash,
      rail: pending.gatewayHandle ? "gateway" : "direct",
      token: pending.transfer.token,
      recipient: pending.transfer.recipient,
      amount: pending.transfer.amount,
      label: pending.label,
      note: pending.note,
      invoiceDate: pending.invoiceDate
    });
    if (activeAccountRef.current?.toLowerCase() !== pending.owner.toLowerCase()) {
      return;
    }
    setRequests((current) => upsertRequest(current, request));
    setReceipts((current) => upsertReceipt(current, receipt));
    setBalanceRefreshKey((current) => current + 1);
    rememberPendingDirect(undefined, pending.owner);
    setDirectForm(emptyDirectForm);
    setDirectEstimate(undefined);
    setDirectBalances(undefined);
    setDirectNotice({
      tone: "success",
      text: pending.gatewayHandle
        ? `Payment sent to @${pending.gatewayHandle}'s Disburse balance. They can withdraw it to their wallet from Disburse.`
        : "Direct payment confirmed. Receipt saved to your history."
    });
  }

  async function handleReconcileDirect() {
    if (!pendingDirect) {
      return;
    }
    const reconcileOwner = pendingDirect.owner;
    setIsReconcilingDirect(true);
    setDirectNotice({
      tone: "info",
      text: "Checking the already-submitted transaction. Do not send another payment."
    });
    try {
      await settlePendingDirect(pendingDirect);
    } catch (error) {
      if (!isCurrentWalletAccount(activeAccountRef.current, reconcileOwner)) return;
      setDirectNotice({
        tone: "info",
        text: `${errorToMessage(error)} The transaction is still journaled. Do not resend; use Verify again after the RPC recovers.`
      });
    } finally {
      setIsReconcilingDirect(false);
    }
  }

  async function handleDirectSend() {
    if (pendingDirect) {
      setDirectNotice({
        tone: "info",
        text: "A transaction was already submitted and is awaiting reconciliation. Verify it before starting another payment."
      });
      return;
    }
    const provider = await getWalletProvider();
    if (!provider || !account) {
      setDirectNotice({ tone: "error", text: "Connect a wallet before sending." });
      return;
    }
    if (wrongChain) {
      setDirectNotice({ tone: "error", text: "Switch to Arc Testnet before sending." });
      return;
    }
    const paymentOwner = account;

    setIsSendingDirect(true);
    setDirectNotice({ tone: "info", text: "Preparing direct transfer." });
    let submitted: PendingDirectTransfer | undefined;

    try {
      await assertProviderAccount(provider, paymentOwner);
      const metadata = normalizeDirectPaymentMetadata(directForm);
      if (directUsesGateway) {
        const { id, transfer } = await resolveGatewayRecipient(directForm);
        const gatewayBalance = await fetchGatewayBalance(paymentOwner);
        const amount = parseTokenAmount(transfer.amount, "USDC");
        if (gatewayBalance.available < amount) {
          throw new Error("Insufficient Disburse balance. Deposit USDC before sending to a Disburse ID.");
        }

        setDirectNotice({
          tone: "info",
          text: `Sending to @${id.handle}'s Disburse balance. Approve the Gateway transfer in your wallet.`
        });
        if (!isCurrentWalletAccount(activeAccountRef.current, paymentOwner)) {
          throw new Error("The connected wallet changed. Review the payment again.");
        }
        await assertProviderAccount(provider, paymentOwner);
        const { mintHash } = await transferViaGateway(provider, paymentOwner, {
          recipient: transfer.recipient,
          amount
        });
        submitted = {
          owner: paymentOwner,
          hash: mintHash,
          transfer,
          expectedFrom: zeroAddress,
          label: metadata.label,
          note: metadata.note,
          invoiceDate: metadata.invoiceDate,
          gatewayHandle: id.handle,
          submittedAt: new Date().toISOString()
        };
        rememberPendingDirect(submitted);
        if (isCurrentWalletAccount(activeAccountRef.current, paymentOwner)) {
          setDirectNotice({ tone: "info", text: "Transaction submitted. Waiting for confirmation." });
        }
        await settlePendingDirect(submitted);
        return;
      }

      const transfer = buildTokenTransfer(directForm);
      const balances = await readBalances(paymentOwner, transfer);
      setDirectBalances(balances);
      ensureTokenBalance(balances, transfer);

      let transferEstimate = directEstimate;
      if (!transferEstimate) {
        setDirectNotice({ tone: "info", text: "Estimating direct transfer." });
        transferEstimate = await estimatePayment(paymentOwner, transfer);
        setDirectEstimate(transferEstimate);
      }
      ensureGasBalance(balances, transfer, transferEstimate);

      setDirectNotice({ tone: "info", text: "Open your wallet and approve the transfer." });
      if (!isCurrentWalletAccount(activeAccountRef.current, paymentOwner)) {
        throw new Error("The connected wallet changed. Review the payment again.");
      }
      await assertProviderAccount(provider, paymentOwner);
      const hash = await submitTokenTransfer(provider, paymentOwner, transfer);
      submitted = {
        owner: paymentOwner,
        hash,
        transfer,
        expectedFrom: paymentOwner,
        label: metadata.label,
        note: metadata.note,
        invoiceDate: metadata.invoiceDate,
        submittedAt: new Date().toISOString()
      };
      rememberPendingDirect(submitted);
      if (isCurrentWalletAccount(activeAccountRef.current, paymentOwner)) {
        setDirectNotice({ tone: "info", text: "Transaction submitted. Waiting for confirmation." });
      }
      await settlePendingDirect(submitted);
    } catch (error) {
      if (!isCurrentWalletAccount(activeAccountRef.current, paymentOwner)) return;
      setDirectNotice({
        tone: submitted ? "info" : "error",
        text: submitted
          ? `${errorToMessage(error)} The transaction was submitted and journaled. Do not resend; use Verify to reconcile it.`
          : errorToMessage(error)
      });
    } finally {
      setIsSendingDirect(false);
    }
  }

  async function handleCreateQrRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestOwner = account;
    setIsCreatingQr(true);
    setQrNotice(undefined);

    try {
      const notify = qrForm.notify.trim() ? handleFromInput(qrForm.notify) : undefined;
      if (!requestOwner) {
        throw new Error("Connect the recipient wallet before creating a QR request.");
      }
      const provider = await getWalletProvider();
      if (!provider) {
        throw new Error("A wallet is required to authorize QR creation.");
      }
      const recipient = validateRecipient(qrForm.recipient);
      if (recipient.toLowerCase() !== requestOwner.toLowerCase()) {
        throw new Error("Connect the recipient wallet before creating this QR request.");
      }
      const expiresAt = BigInt(Math.floor(Date.now() / 1_000) + PAYMENT_REQUEST_AUTH_TTL_SECONDS - 30);
      const typedData = buildPaymentRequestAuthorizationTypedData({
        wallet: requestOwner,
        notify: notify ?? "",
        recipient,
        token: "USDC",
        amount: formatTokenAmount(parseTokenAmount(qrForm.amount, "USDC"), "USDC"),
        label: normalizeLabel(qrForm.label),
        note: normalizeNote(qrForm.note),
        invoiceDate: normalizeInvoiceDate(qrForm.invoiceDate),
        expiresAt
      });
      const walletTypedData = {
        ...typedData,
        types: {
          EIP712Domain: DISBURSE_EIP712_DOMAIN_TYPES,
          ...typedData.types
        }
      };
      setQrNotice({ tone: "info", text: "Authorize this verified QR request in your wallet." });
      await assertProviderAccount(provider, requestOwner);
      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [
          requestOwner,
          JSON.stringify(walletTypedData, (_key, value) =>
            typeof value === "bigint" ? value.toString() : value
          )
        ]
      });
      if (typeof signature !== "string" || !/^0x(?:[a-fA-F0-9]{2}){64,2048}$/.test(signature)) {
        throw new Error("Wallet did not return a valid payment-request authorization.");
      }
      const notificationAuthorization = {
        wallet: requestOwner,
        expiresAt: expiresAt.toString(),
        signature: signature as `0x${string}`
      };
      const remote = await createRemoteQrRequest({ ...qrForm, notify, ...notificationAuthorization });
      if (!remote) {
        throw new Error(
          "Disburse could not create a server-verified QR request. Try again when the service is available."
        );
      }
      const request: PaymentRequest = {
        ...remote.request,
        requestToken: remote.requestToken
      };

      if (!isCurrentWalletAccount(activeAccountRef.current, requestOwner)) {
        throw new Error(
          "The wallet changed after this request was created. Switch back to the recipient wallet to view it in history."
        );
      }

      setRequests((current) => upsertRequest(current, request));
      setSelectedId(request.id);
      setQrNotice({
        tone: "success",
        text: remote.notified
          ? `QR payment request generated and synced. @${remote.notified} was notified in their inbox.`
          : "QR payment request generated and synced."
      });
      setQrForm((current) => ({
        ...emptyQrForm,
        recipient: current.recipient,
        token: "USDC",
        invoiceDate: current.invoiceDate
      }));
    } catch (error) {
      if (!requestOwner || isCurrentWalletAccount(activeAccountRef.current, requestOwner)) {
        setQrNotice({ tone: "error", text: errorToMessage(error) });
      }
    } finally {
      setIsCreatingQr(false);
    }
  }

  async function handlePayEstimate() {
    const request = payRequest;
    if (!request || !account || !payRequestVerified || !request.requestToken) {
      setPayNotice({ tone: "error", text: "Connect a wallet and load a QR request." });
      return;
    }
    if (payWrongChain) {
      setPayNotice({ tone: "error", text: "Switch to Arc Testnet before estimating." });
      return;
    }
    if (!isPaymentPayable(request)) {
      setPayNotice({
        tone: "error",
        text: "This QR payment request expired. Ask the requester for a fresh QR code."
      });
      return;
    }

    const estimateOwner = account;
    setIsEstimatingPay(true);
    setPayNotice({ tone: "info", text: "Estimating QR payment." });

    try {
      const nextEstimate = await estimatePayment(estimateOwner, request);
      if (!isCurrentWalletAccount(activeAccountRef.current, estimateOwner)) return;
      setPayEstimate(nextEstimate);
      await refreshPayBalances(request);
      if (isCurrentWalletAccount(activeAccountRef.current, estimateOwner)) {
        setPayNotice({ tone: "success", text: "Estimate ready." });
      }
    } catch (error) {
      if (isCurrentWalletAccount(activeAccountRef.current, estimateOwner)) {
        setPayNotice({ tone: "error", text: errorToMessage(error) });
      }
    } finally {
      setIsEstimatingPay(false);
    }
  }

  async function handlePayQrRequest() {
    const provider = await getWalletProvider();
    const request = payRequest;
    if (!request || !provider || !account || !payRequestVerified || !request.requestToken) {
      setPayNotice({ tone: "error", text: "Connect a wallet and load a QR request." });
      return;
    }
    if (payWrongChain) {
      setPayNotice({ tone: "error", text: "Switch to Arc Testnet before paying." });
      return;
    }
    const paymentOwner = account;

    setIsPayingQr(true);
    setPayLifecycle("preparing");
    setPayNotice({ tone: "info", text: "Re-checking the canonical payment request." });

    try {
      await assertProviderAccount(provider, paymentOwner);
      const canonicalPayload = await fetchRemoteQrStatus(request.id, request.requestToken);
      if (!canonicalPayload || canonicalPayload.request.id !== request.id) {
        throw new Error("Disburse could not re-verify this request. No transaction was sent.");
      }
      const canonicalRequest: PaymentRequest = {
        ...canonicalPayload.request,
        requestToken: request.requestToken
      };
      if (!hasSameRequestPayload(request, canonicalRequest)) {
        applyPaySurfacePayload(canonicalPayload, request.requestToken);
        throw new Error("The canonical payment details changed. Review them before approving a payment.");
      }

      const attemptStartedAt = new Date();
      if (!isPaymentPayable(canonicalRequest, attemptStartedAt)) {
        throw new Error("This QR payment request expired or closed. Ask the requester for a fresh QR code.");
      }

      const balances = await readBalances(paymentOwner, canonicalRequest);
      setPayBalances(balances);
      ensureTokenBalance(balances, canonicalRequest);

      let transferEstimate = payEstimate;
      if (!transferEstimate) {
        setPayNotice({ tone: "info", text: "Estimating QR payment." });
        transferEstimate = await estimatePayment(paymentOwner, canonicalRequest);
        setPayEstimate(transferEstimate);
      }
      ensureGasBalance(balances, canonicalRequest, transferEstimate);

      setPayLifecycle("awaiting_wallet");
      setPayNotice({
        tone: "info",
        text: "Authorize the verified invoice in your wallet, then approve the transfer."
      });
      if (!isCurrentWalletAccount(activeAccountRef.current, paymentOwner)) {
        throw new Error("The connected wallet changed. Review the payment again.");
      }
      await assertProviderAccount(provider, paymentOwner);
      const paymentAuthorization = await requestQrPaymentAuthorization(
        provider,
        paymentOwner,
        canonicalRequest
      );

      const requestWithAttempt: PaymentRequest = {
        ...canonicalRequest,
        paymentAuthorization,
        submittedAt: attemptStartedAt.toISOString()
      };
      setPayNotice({ tone: "info", text: "Open your wallet and approve the payment." });

      if (!isCurrentWalletAccount(activeAccountRef.current, paymentOwner)) {
        throw new Error("The connected wallet changed. Review the payment again.");
      }
      await assertProviderAccount(provider, paymentOwner);
      const hash = await submitPayment(provider, paymentOwner, requestWithAttempt);
      setPayLifecycle("submitted");
      setPayNotice({ tone: "info", text: "Transaction submitted. Verifying receipt." });

      let requestWithHash: PaymentRequest = { ...requestWithAttempt, txHash: hash };
      try {
        const submission = await recordRemoteQrSubmission(
          request.id,
          request.requestToken,
          hash,
          paymentAuthorization,
          paymentOwner,
          requestWithAttempt.submittedAt
        );
        if (submission?.request) {
          requestWithHash = {
            ...submission.request,
            requestToken: request.requestToken,
            paymentAuthorization,
            txHash: hash
          };
        }
      } catch (error) {
        setPayNotice({ tone: "info", text: `Transaction submitted. ${errorToMessage(error)}` });
      }
      setPaySurfaceRequest(requestWithHash);

      setPayLifecycle("confirming");
      try {
        await waitForConfirmedTokenTransfer(hash, canonicalRequest, paymentOwner);
        const remoteConfirmation = await confirmRemoteQrPayment(
          request.id,
          request.requestToken,
          hash,
          paymentAuthorization
        ).catch((error) => {
          setPayNotice({ tone: "info", text: errorToMessage(error) });
          return undefined;
        });
        if (remoteConfirmation) {
          applyPaySurfacePayload(remoteConfirmation, request.requestToken, paymentAuthorization);
          setPayLifecycle(remoteConfirmationToLifecycle(remoteConfirmation));
          setPayNotice(remoteConfirmationToNotice(remoteConfirmation));
        } else {
          setPaySurfaceRequest({ ...requestWithHash, status: "open" });
          setPayLifecycle("submitted");
          setPayNotice({
            tone: "info",
            text: "The transfer was observed on chain, but Disburse confirmation is pending. Use Verify to retry."
          });
        }
      } catch (error) {
        setPayLifecycle("submitted");
        setPayNotice({ tone: "error", text: errorToMessage(error) });
        return;
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
      let paymentAuthorization = request.paymentAuthorization;
      if (request.txHash && request.requestToken && !paymentAuthorization && account) {
        const provider = await getWalletProvider();
        if (provider) {
          await assertProviderAccount(provider, account);
          paymentAuthorization = await requestQrPaymentAuthorization(provider, account, request);
          setPaySurfaceRequest({ ...request, paymentAuthorization });
        }
      }
      let remoteConfirmationError: string | undefined;
      let remotePayload: QrStatusPayload | undefined =
        request.txHash && request.requestToken && paymentAuthorization
          ? await confirmRemoteQrPayment(
              request.id,
              request.requestToken,
              request.txHash,
              paymentAuthorization
            ).catch((error) => {
              remoteConfirmationError = errorToMessage(error);
              return undefined;
            })
          : undefined;
      if (!remotePayload && request.requestToken) {
        remotePayload = await fetchRemoteQrStatus(request.id, request.requestToken).catch((error) => {
          remoteConfirmationError ??= errorToMessage(error);
          return undefined;
        });
      }
      if (remotePayload && request.requestToken) {
        applyPaySurfacePayload(remotePayload, request.requestToken, paymentAuthorization);
        setPayLifecycle(qrStatusPayloadToLifecycle(remotePayload));
        setPayNotice(qrStatusPayloadToNotice(remotePayload));
      } else if (request.requestToken) {
        setPayLifecycle(request.txHash ? "submitted" : "preparing");
        setPayNotice({
          tone: "info",
          text:
            remoteConfirmationError ??
            "Disburse confirmation is still pending. No paid receipt was created; retry Verify shortly."
        });
      } else {
        setPayLifecycle("failed");
        setPayNotice({
          tone: "error",
          text: "This saved record has no server verification capability and cannot be marked paid. Create a fresh verified QR request."
        });
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
      setPaySurfaceReceipt((current) =>
        current?.requestId === receipt.requestId
          ? { ...current, attestationUid: attestation.uid, attestationFingerprint: attestation.fingerprint }
          : current
      );
      setReceipts((current) =>
        current.map((r) =>
          r.requestId === receipt.requestId
            ? { ...r, attestationUid: attestation.uid, attestationFingerprint: attestation.fingerprint }
            : r
        )
      );
      setPayNotice({
        tone: "success",
        text: `Local receipt fingerprint created. It is not an issuer signature. VSR: ${attestation.uid}`
      });
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
    const balanceOwner = account;
    try {
      const balances = await readBalances(balanceOwner, transfer);
      if (activeAccountRef.current === balanceOwner) {
        setDirectBalances(balances);
      }
    } catch (error) {
      if (activeAccountRef.current === balanceOwner) {
        setDirectNotice({ tone: "error", text: errorToMessage(error) });
      }
    }
  }

  async function refreshPayBalances(request = payRequest) {
    if (!account || !request) {
      return;
    }
    const balanceOwner = account;
    try {
      const balances = await readBalances(balanceOwner, request);
      if (activeAccountRef.current === balanceOwner) {
        setPayBalances(balances);
      }
    } catch (error) {
      if (activeAccountRef.current === balanceOwner) {
        setPayNotice({ tone: "error", text: errorToMessage(error) });
      }
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
                  <Wallet size={12} strokeWidth={1.75} aria-hidden="true" />
                  {shortAddress(account)}
                </span>
              )}
              <button
                type="button"
                className="pay-host-icon"
                onClick={handleThemeToggle}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? (
                  <Moon size={16} strokeWidth={1.75} />
                ) : (
                  <Sun size={16} strokeWidth={1.75} />
                )}
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
              onSettlementProof={() =>
                payRequest && payReceipt && handleDownloadSettlementProof(payRequest, payReceipt)
              }
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
    dashboard: { title: "Dashboard", subtitle: "Requests, receipts and network health at a glance." },
    payments: { title: "Send", subtitle: "Pay a wallet address directly on Arc Testnet." },
    "qr-payments": { title: "QR", subtitle: "Create a QR invoice for someone else to scan and pay." },
    pay: { title: "Pay request", subtitle: "Review and settle a QR payment request." },
    "import-export": {
      title: "Data export",
      subtitle: "Export the active wallet's server-backed payment records."
    },
    statements: { title: "Statements", subtitle: "Generate settlement proof bundles for reconciliation." }
  };
  const { title: headerTitle, subtitle: headerSubtitle } =
    routeMeta[page as AppShellPage] ?? routeMeta.dashboard;

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
        <main
          className={cn(
            "min-w-0 flex-1 flex flex-col transition-all duration-300 relative z-10 md:py-2 md:pr-2 md:pl-2",
            isSidebarCollapsed ? "md:ml-[56px]" : "md:ml-[240px]"
          )}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--paper)] md:overflow-hidden md:rounded-xl md:border md:border-[var(--line)]">
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
              onDeposited={() => setBalanceRefreshKey((key) => key + 1)}
            />

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6 relative">
              {page === "dashboard" && (
                <DashboardPage
                  requests={requests}
                  receipts={receipts}
                  account={account}
                  now={now}
                  onNavigate={navigateTo}
                  getProvider={getWalletProvider}
                  onDeposit={() => setIsDepositOpen(true)}
                  balanceRefreshKey={balanceRefreshKey}
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
                  usesGatewayRecipient={directUsesGateway}
                  insufficientToken={directInsufficientToken}
                  missingGas={directMissingGas}
                  isConnecting={isConnecting}
                  isEstimating={isEstimatingDirect}
                  isSending={isSendingDirect}
                  isReconciling={isReconcilingDirect}
                  hasPendingTransfer={Boolean(pendingDirect)}
                  onFormChange={(next) => {
                    setDirectForm(next);
                    setDirectEstimate(undefined);
                    setDirectBalances(undefined);
                    if (!pendingDirect) {
                      setDirectHash(undefined);
                    }
                  }}
                  onConnect={handleConnectWallet}
                  onSwitch={handleSwitchNetwork}
                  onEstimate={handleDirectEstimate}
                  onSend={handleDirectSend}
                  onVerify={handleReconcileDirect}
                  onCopy={(value) => copyValue(value, setDirectNotice)}
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
                  onFormChange={setQrForm}
                  onSubmit={handleCreateQrRequest}
                  onSelectRequest={handleSelectRequest}
                  onCopy={(value) => copyValue(value, setQrNotice)}
                  onExport={handleExport}
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
                  onSettlementProof={() =>
                    payRequest && payReceipt && handleDownloadSettlementProof(payRequest, payReceipt)
                  }
                  onUBLExport={() =>
                    payRequest && payReceipt && handleDownloadUBLInvoice(payRequest, payReceipt)
                  }
                  attestation={payAttestation}
                  onCopy={(value) => copyValue(value, setPayNotice)}
                />
              )}
              {page === "import-export" && (
                <ImportExportPage requests={requests} receipts={receipts} onExport={handleExport} />
              )}
              {page === "statements" && (
                <StatementsPage account={account} getWalletProvider={getWalletProvider} />
              )}
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
  usesGatewayRecipient,
  insufficientToken,
  missingGas,
  isConnecting,
  isEstimating,
  isSending,
  isReconciling,
  hasPendingTransfer,
  onFormChange,
  onConnect,
  onSwitch,
  onEstimate,
  onSend,
  onVerify,
  onCopy
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
  usesGatewayRecipient: boolean;
  insufficientToken: boolean;
  missingGas: boolean;
  isConnecting: boolean;
  isEstimating: boolean;
  isSending: boolean;
  isReconciling: boolean;
  hasPendingTransfer: boolean;
  onFormChange: (next: DirectFormState) => void;
  onConnect: () => void;
  onSwitch: () => void;
  onEstimate: () => void;
  onSend: () => void;
  onVerify: () => void;
  onCopy: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <section className="workbench" aria-label={t("directTransferTitle")}>
        <div className="desk-grid single-flow-grid">
          <section className="desk-pane" aria-labelledby="direct-form-heading">
            <PaneTitle id="direct-form-heading" label={t("paymentDetails")} />
            <form className="form-stack" onSubmit={(event) => event.preventDefault()}>
              <Field
                label={t("recipient")}
                helper={
                  usesGatewayRecipient
                    ? "Disburse ID payments credit the recipient's Disburse balance."
                    : t("recipientHelper")
                }
              >
                <input
                  value={form.recipient}
                  onChange={(event) => onFormChange({ ...form, recipient: event.target.value })}
                  placeholder="0x... or @name"
                  spellCheck={false}
                  disabled={hasPendingTransfer}
                />
                <HandleHint
                  value={form.recipient}
                  onApply={(address) => {
                    if (!hasPendingTransfer) {
                      onFormChange({ ...form, recipient: address });
                    }
                  }}
                  gatewayRecipient
                />
              </Field>

              <div className="field-grid">
                <Field label={t("token")}>
                  <select
                    value={form.token}
                    onChange={(event) => onFormChange({ ...form, token: event.target.value as PaymentToken })}
                    disabled={hasPendingTransfer}
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
                    disabled={hasPendingTransfer}
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

              {account &&
                !wrongChain &&
                (usesGatewayRecipient ? (
                  <p className="text-sm text-[var(--muted)]">
                    Send USDC from your Disburse balance. The recipient withdraws it to their wallet from
                    Disburse.
                  </p>
                ) : (
                  <TransferState
                    account={account}
                    token={form.token}
                    balances={balances}
                    insufficientToken={insufficientToken}
                    missingGas={missingGas}
                  />
                ))}

              <div className="action-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onEstimate}
                  disabled={!account || wrongChain || isEstimating || hasPendingTransfer}
                >
                  {isEstimating ? t("estimating") : t("estimate")}
                </button>
                {hasPendingTransfer && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={onVerify}
                    disabled={isReconciling}
                  >
                    {isReconciling ? t("verifying") : "Verify submitted transfer"}
                  </button>
                )}
                <button
                  className="primary-button"
                  type="button"
                  onClick={onSend}
                  disabled={
                    !account ||
                    wrongChain ||
                    insufficientToken ||
                    missingGas ||
                    isSending ||
                    isReconciling ||
                    hasPendingTransfer
                  }
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
            <span className="stage-step-mark" aria-hidden="true">
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
  const requestUrl = request.requestToken ? buildShareUrl(request, getPayShareOrigin()) : undefined;
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
      <span className={cx("status-mark", displayRequest.status)} aria-hidden="true" />
      <span className="ledger-row-compact-label">{request.label}</span>
      <span className="ledger-row-compact-amount">
        {request.amount} {request.token}
      </span>
      <span className="ledger-row-compact-meta">
        {shortAddress(request.recipient)} · {formatInvoiceDate(request.invoiceDate)}
      </span>
      <div className="ledger-row-compact-actions" onClick={(event) => event.stopPropagation()}>
        <button
          className="text-button"
          type="button"
          disabled={!requestUrl}
          onClick={() => requestUrl && onCopy(requestUrl)}
        >
          {t("copy")}
        </button>
        {requestUrl && (
          <a className="text-button" href={requestUrl}>
            {t("payPage")}
          </a>
        )}
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
  onFormChange,
  onSubmit,
  onSelectRequest,
  onCopy,
  onExport
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
  onFormChange: (next: QrFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSelectRequest: (request: PaymentRequest) => void;
  onCopy: (value: string) => void;
  onExport: () => void;
}) {
  const { t } = useI18n();
  const displayRequest = selectedRequest ? refreshDerivedStatus(selectedRequest, now) : undefined;
  const qrIsFinal = displayRequest ? shouldHideQrForStatus(displayRequest.status) : false;

  return (
    <>
      <section className="workbench qr-composer" aria-label={t("generateQr")}>
        <form className="form-stack qr-composer-form" onSubmit={onSubmit}>
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

          <Field label={t("amount")}>
            <div className="amount-input">
              <input
                value={form.amount}
                onChange={(event) => onFormChange({ ...form, amount: event.target.value })}
                inputMode="decimal"
                placeholder="10"
                aria-describedby="qr-token-suffix"
              />
              <span id="qr-token-suffix">USDC</span>
            </div>
          </Field>

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

        {displayRequest && shareUrl && (
          <section className="qr-composer-output" aria-label={t("qrOutput")}>
            {selectedReceipt ? (
              <ReceiptView
                data={{
                  request: displayRequest,
                  receipt: selectedReceipt,
                  attestation: {
                    uid: selectedReceipt.attestationUid,
                    fingerprint: selectedReceipt.attestationFingerprint
                  },
                  onCopy,
                  onCopyFingerprint: onCopy
                }}
              >
                <ReceiptView.Summary />
                <ReceiptView.Timeline />
                <ReceiptView.Proof />
              </ReceiptView>
            ) : qrIsFinal ? (
              <QrFinalState request={displayRequest} />
            ) : displayRequest.txHash ? (
              <NoticeBar notice={{ tone: "info", text: t("txSavedNotice") }} />
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
          </section>
        )}
      </section>

      <section id="qr-ledger" className="ledger-section" aria-label={t("qrLedger")}>
        <div className="ledger-toolbar">
          <span className="ledger-toolbar-label">{t("qrRequestsStored", { count: requests.length })}</span>
          <div className="tool-actions">
            <button className="text-button" type="button" onClick={onExport} disabled={!requests.length}>
              {t("export")}
            </button>
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
                  <Metric
                    label={t("validUntil")}
                    value={formatDateTime(request.expiresAt ?? request.dueAt)}
                  />
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
                    <NoticeBar compact notice={{ tone: "info", text: t("noWalletRequest") }} />
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
                      <button className="text-button" type="button" onClick={onVerify} disabled={isVerifying}>
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
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => submittedTxUrl && onCopy(submittedTxUrl)}
                        >
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
                            <span className="attestation-badge">Local VSR: {attestation.uid}</span>
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
          <div className="form-section">
            <EmptyState title={t("noQrRequestLoaded")} text={t("noQrRequestLoadedText")} />
            {notice && <NoticeBar notice={notice} />}
          </div>
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
        {hasSubmittedTransaction && <NoticeBar compact notice={{ tone: "info", text: t("txSavedNotice") }} />}

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
                <button
                  className="text-button"
                  type="button"
                  onClick={() => submittedTxUrl && onCopy(submittedTxUrl)}
                >
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
                {attestation && <span className="attestation-badge">Local VSR: {attestation.uid}</span>}
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
        <Metric
          label={t("tokenBalance", { token })}
          value={balances ? `${trimDisplay(balances.tokenBalance, 6)} ${token}` : t("loading")}
        />
        <Metric
          label={t("gasBalance")}
          value={balances ? `${trimDisplay(balances.nativeGas, 8)} ${nativeSymbol}` : t("loading")}
        />
        <Metric label={t("network")} value={networkLabel} />
      </div>
      {insufficientToken && (
        <NoticeBar compact notice={{ tone: "error", text: t("insufficientTokenBalance", { token }) }} />
      )}
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
  const gasLabel =
    estimate.needsApproval && estimate.approvalGas ? t("approvalPaymentGas") : t("estimatedGas");
  return (
    <div className="estimate-line">
      <Metric label={gasLabel} value={estimate.gas.toString()} />
      <Metric
        label={t("gasPrice")}
        value={`${trimDisplay(formatUnits(estimate.gasPrice, 18), 8)} ${symbol}`}
      />
      <Metric label={t("estimatedFee")} value={`${trimDisplay(estimate.fee, 8)} ${symbol}`} />
    </div>
  );
}

function Field({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
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
          <a
            className="secondary-button"
            href={toExplorerAddressUrl(account)}
            target="_blank"
            rel="noreferrer"
          >
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
    possible_match: "review"
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

function qrStatusPayloadToLifecycle(payload: QrStatusPayload): PayLifecycle {
  if (payload.request.status === "paid") {
    return "verified";
  }
  if (payload.request.status === "failed" || payload.request.status === "expired") {
    return "failed";
  }
  return payload.request.txHash ? "submitted" : "preparing";
}

function qrStatusPayloadToNotice(payload: QrStatusPayload): Notice {
  if (payload.request.status === "paid") {
    return {
      tone: "success",
      text: payload.message ?? "Payment settled on Arc. Invoice is ready."
    };
  }
  if (payload.request.status === "failed" || payload.request.status === "expired") {
    return {
      tone: "error",
      text: payload.message ?? "This payment request is no longer payable."
    };
  }
  return {
    tone: "info",
    text: payload.message ?? "Disburse confirmation is still pending."
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

function applyQrStatusPayload(
  payload: QrStatusPayload,
  setRequests: RequestStateWriter,
  setReceipts: ReceiptStateWriter,
  requestToken?: string,
  paymentAuthorization?: `0x${string}`
) {
  setRequests((current) => {
    const local = current.find((request) => request.id === payload.request.id);
    return upsertRequest(current, {
      ...payload.request,
      requestToken: requestToken ?? local?.requestToken,
      paymentAuthorization: paymentAuthorization ?? local?.paymentAuthorization
    });
  });
  if (payload.receipt) {
    setReceipts((current) => upsertReceipt(current, payload.receipt as Receipt));
  }
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

/**
 * A typed Disburse ID is deliberately a different rail from a pasted wallet
 * address. It resolves only at send time so the directory result cannot go
 * stale between typing and wallet approval, then targets the ID owner's
 * Circle Gateway balance.
 */
async function resolveGatewayRecipient(form: DirectFormState) {
  if (form.token !== "USDC") {
    throw new Error("Disburse ID payments use the USDC Disburse balance. Select USDC to continue.");
  }

  const id = await resolveIdByHandle(form.recipient);
  if (!id) {
    throw new Error(
      `No Disburse ID named @${handleFromInput(form.recipient)}. Use a wallet address to send directly instead.`
    );
  }

  return {
    id,
    transfer: {
      recipient: id.address,
      token: "USDC" as const,
      amount: formatTokenAmount(parseTokenAmount(form.amount, "USDC"), "USDC")
    }
  };
}

function normalizeDirectPaymentMetadata(form: DirectFormState): {
  label: string;
  note?: string;
  invoiceDate: string;
} {
  return {
    label: form.label && form.label.trim() ? normalizeLabel(form.label) : `Direct send · ${form.token}`,
    note: form.note && form.note.trim() ? normalizeNote(form.note) : undefined,
    invoiceDate: todayInputValue()
  };
}

function ensureTokenBalance(balances: Balances, transfer: TokenTransfer) {
  if (
    parseTokenAmount(balances.tokenBalance, transfer.token) <
    parseTokenAmount(transfer.amount, transfer.token)
  ) {
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

function useInsufficientToken(
  balances: Balances | undefined,
  transfer: TokenTransfer | DirectFormState | undefined
): boolean {
  return useMemo(() => {
    if (!balances || !transfer?.amount || !transfer.token) {
      return false;
    }
    try {
      return (
        parseTokenAmount(balances.tokenBalance, transfer.token) <
        parseTokenAmount(transfer.amount, transfer.token)
      );
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

export default App;
