import { type FormEvent, type MouseEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  BookOpen,
  ChevronsLeftRight,
  Download,
  ExternalLink,
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
import { I18nProvider } from "./lib/i18n";
import {
  type AppSettings,
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
import LandingPage from "./LandingPage";

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
type Theme = "light" | "dark";
type Page = "landing" | "dashboard" | "payments" | "qr-payments" | "pay" | "import-export" | "docs";
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
type NavigateHandler = (event: MouseEvent<HTMLAnchorElement>, target: string) => void;
type DocsSection = {
  title: string;
  body: string[];
  points?: string[];
  code?: string;
};
type DocsSummaryItem = {
  label: string;
  value: string;
};

const THEME_KEY = "disburse.theme";
const LEGACY_THEME_KEY = "arc-pay-desk.theme";
const LEGACY_DOCS_PATH = "/docs";
const PRODUCTION_DOCS_HOSTNAME = "docs.disburse.online";
const PRODUCTION_APP_HOSTNAME = "app.disburse.online";

function cx(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

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

const faqItems = [
  {
    question: "What is the difference between Payments and QR Payments?",
    answer:
      "Payments is for a wallet owner sending funds to another address. QR Payments is for creating a fixed request that another wallet scans and pays."
  },
  {
    question: "Does this app custody funds?",
    answer:
      "No. Payments are submitted from the connected wallet directly to the recipient address. The app does not hold private keys or stablecoin balances."
  },
  {
    question: "Which network does Disburse use?",
    answer:
      "Disburse is configured for Arc Testnet, chain ID 5042002, using Arc RPC failover and Arcscan for transaction review."
  },
  {
    question: "What is stored in the browser?",
    answer:
      "QR requests and verified receipts are stored in localStorage. Direct Payments only keep their latest transaction hash in the current browser session."
  },
  {
    question: "Which payment rails are available?",
    answer:
      "The current build uses wallet-signed ERC-20 transfers only. MPP and backend-enforced 402 payment flows are not active in this release."
  }
];

const docsSections: DocsSection[] = [
  {
    title: "Project scope",
    body: [
      "Disburse is a non-custodial payment console for Arc Testnet. It is built for two practical tasks: sending a stablecoin transfer from an injected wallet, and issuing a QR payment request that another wallet can open and pay.",
      "The current build is intentionally narrow. It does not hold balances, collect private keys, or operate a custodial account. The browser prepares the request, the wallet signs the transaction, and payment status is verified against Arc Testnet data."
    ],
    points: [
      "Primary app routes: /payments, /qr-payments, and /pay.",
      `Documentation is served from ${PRODUCTION_DOCS_HOSTNAME}.`,
      "Supported actions: wallet connection, Arc Testnet switching, gas estimation, ERC-20 transfers, QR request creation, transfer verification, import/export, and invoice download.",
      "Out of scope for this release: custodial balances, Permit2, backend-enforced 402 flows, MPP rails, and server-side replay protection."
    ]
  },
  {
    title: "Payment flows",
    body: [
      "Disburse separates immediate transfers from request-based payments. Direct Payments are used when the sender already knows the recipient, token, and amount. QR Payments are used when a requester wants to publish a fixed request for someone else to pay.",
      "A scanned QR request opens the payer page with the request details locked. The payer can connect a wallet, estimate the transfer, submit the transaction, verify the result, and download the invoice after confirmation."
    ],
    points: [
      "Payments: the sender enters recipient, token, and amount, then signs a wallet transfer.",
      "QR Payments: the requester enters recipient, token, amount, label, note, and invoice date, then shares a request URL as a QR code.",
      "Direct Payments do not create QR request records in the local ledger."
    ]
  },
  {
    title: "Network and assets",
    body: [
      "The app is pinned to Arc Testnet. Native gas is represented as USDC with 18 decimals, while supported ERC-20 payment amounts use 6 decimals.",
      "RPC access is handled through a small failover list. The interface reports the active endpoint, latest block, safe gas price, chain id, and token decimal checks so a user can see whether the network path is healthy before signing."
    ],
    points: [
      `Chain ID: ${ARC_CHAIN_ID}`,
      `RPC: ${new URL(ARC_RPC_URL).host}`,
      `Failover endpoints: ${ARC_RPC_ENDPOINTS.length}`,
      `USDC: ${TOKENS.USDC.address}`,
      `EURC: ${TOKENS.EURC.address}`
    ]
  },
  {
    title: "QR request payload",
    body: [
      "A QR code contains a /pay URL with a base64url JSON payload in the r query parameter. The payload is only a portable request description; it never contains a private key, wallet approval, token balance, or signed transaction.",
      "The request records the token, amount, recipient, label, creation time, and start block. That start block limits verification to transfers that happened after the request was created."
    ],
    points: [
      "Required fields: version, id, recipient, token, amount, label, createdAt, and startBlock.",
      "Optional fields: note, invoiceDate, expiresAt, and dueAt.",
      `Default expiry: ${PAYMENT_VALIDITY_MINUTES} minutes after creation. A submitted payment attempt that started before expiry can still be verified.`
    ],
    code: "/pay?r=<base64url({ version, id, recipient, token, amount, label, note?, invoiceDate?, expiresAt?, dueAt?, createdAt, startBlock })>"
  },
  {
    title: "Wallet execution",
    body: [
      "Payments are standard ERC-20 transfer calls signed by the connected wallet. The app estimates gas with viem, applies Arc's configured gas-price floor, saves the wallet transaction hash as soon as it is submitted, and then waits for confirmation.",
      "The wallet remains the authority for signing. Disburse prepares calldata and displays checks, but the final approval happens inside the wallet."
    ],
    points: [
      "Connect: eth_requestAccounts.",
      "Network: wallet_switchEthereumChain, with wallet_addEthereumChain fallback for Arc Testnet.",
      "Transfer: eth_sendTransaction with ERC-20 transfer(recipient, parsedAmount) calldata on the selected USDC or EURC contract.",
      "Gas: estimates are used for display and balance checks; the wallet finalizes transaction gas at signing."
    ]
  },
  {
    title: "Local ledger and realtime",
    body: [
      "QR requests and receipts are stored in browser localStorage so the requester can manage work without creating an account. The ledger supports JSON export and import for backup or migration.",
      "When Supabase is configured, QR requests can also be written through Vercel API functions. Realtime events allow the requester view to close a QR code when the payer submits, confirms, fails, or expires a request."
    ],
    points: [
      "Storage keys: disburse.requests and disburse.receipts.",
      "Legacy keys are still read: arc-pay-desk.requests and arc-pay-desk.receipts.",
      "Requests are keyed by request id. Receipts are upserted by request id or transaction hash.",
      "Imported explorer URLs are regenerated from the verified Arcscan transaction hash."
    ]
  },
  {
    title: "Invoice output",
    body: [
      "After the payer confirms and the transfer is verified from Arc Testnet data, the pay page can generate a local PDF invoice.",
      "Invoices are produced in the browser. They are not uploaded by the app and are not emailed by the server in this build."
    ],
    points: [
      "Invoice includes tx hash, block, amount, label, note, invoice date, payer, recipient, confirmation time, and Arcscan link.",
      "Invoice date is display metadata, not the payment expiry.",
      "No server stores or emails invoice files in this build."
    ]
  },
  {
    title: "Verification",
    body: [
      "Verification first checks a known transaction hash. If no hash is present, it scans ERC-20 Transfer logs in 10,000-block windows from the request start block to latest and compares recipient plus exact token amount.",
      "A request is marked paid only when the token contract, recipient, and amount match. Transfers to the right recipient with a different amount are surfaced separately so the user can review them without treating them as settled."
    ],
    points: [
      "Paid: exact transfer to the recipient for the requested token amount.",
      "Possible match: transfer to the recipient exists, but the amount differs.",
      "Open: no matching transfer was found from the request start block."
    ],
    code: "match = log.address == token && log.args.to == recipient && log.args.value == parseUnits(amount, token.decimals)"
  }
];

const docsSummaryItems: DocsSummaryItem[] = [
  {
    label: "Network",
    value: `Arc Testnet ${ARC_CHAIN_ID}`
  },
  {
    label: "Assets",
    value: "USDC and EURC"
  },
  {
    label: "Custody",
    value: "Wallet signed, non-custodial"
  },
  {
    label: "Receipts",
    value: "Verified from Arc Testnet logs"
  }
];

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY);
  const nextTheme = stored === "light" || stored === "dark" ? stored : "dark";
  document.documentElement.dataset.theme = nextTheme;
  return nextTheme;
}

function getInitialPage(): Page {
  const hostname = window.location.hostname;
  const p = window.location.pathname;
  if (isDocsHostname(hostname) || isLocalDocsPreview(hostname, p)) {
    return "docs";
  }
  
  const isApp = hostname.startsWith("app.") || isLocalAppPreview(hostname, p);
  
  if (isApp) {
    if (p === "/payments") return "payments";
    if (p === "/qr-payments") return "qr-payments";
    if (p === "/pay") return "pay";
    if (p === "/import-export") return "import-export";
    // /settings was a dedicated page; it is now a dialog that opens from the header.
    // Keep the URL working by falling through to the dashboard — the dialog auto-opens (see App component).
    return "dashboard";
  }
  
  return "landing";
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

function isLocalAppPreview(hostname: string, pathname: string): boolean {
  if (!isLocalHostname(hostname)) {
    return false;
  }

  const appPreview = new URLSearchParams(window.location.search).get("app") === "1";
  return appPreview || ["/payments", "/qr-payments", "/pay", "/import-export", "/settings"].includes(pathname);
}

function isLocalDocsPreview(hostname: string, pathname: string): boolean {
  return (isLocalHostname(hostname) || hostname.endsWith(".localhost")) && pathname === LEGACY_DOCS_PATH;
}

function isDocsHostname(hostname = window.location.hostname): boolean {
  return hostname === "docs.localhost" || hostname === PRODUCTION_DOCS_HOSTNAME;
}

function stripPublicSubdomain(hostname: string): string {
  if (hostname.startsWith("docs.")) {
    return hostname.slice("docs.".length);
  }
  if (hostname.startsWith("www.")) {
    return hostname.slice("www.".length);
  }
  return hostname;
}

function getDocsHostname(hostname: string): string {
  if (isDocsHostname(hostname)) {
    return hostname;
  }
  if (isLocalHostname(hostname) || hostname.endsWith(".localhost")) {
    return "docs.localhost";
  }
  return PRODUCTION_DOCS_HOSTNAME;
}

function getAppHostname(hostname: string): string {
  if (hostname.startsWith("app.")) {
    return hostname;
  }
  if (isLocalHostname(hostname) || hostname.endsWith(".localhost")) {
    return "app.localhost";
  }
  return PRODUCTION_APP_HOSTNAME;
}

function getOriginForHostname(hostname: string): string {
  const port = window.location.port ? `:${window.location.port}` : "";
  return `${window.location.protocol}//${hostname}${port}`;
}

function getDocsHref(): string {
  const hostname = window.location.hostname;
  if (isDocsHostname(hostname)) {
    return "/";
  }
  if (isLocalHostname(hostname) || hostname.endsWith(".localhost")) {
    return LEGACY_DOCS_PATH;
  }
  return `${getOriginForHostname(getDocsHostname(hostname))}/`;
}

function getAppHref(path: string): string {
  const hostname = window.location.hostname;
  
  // If we are already on an app subdomain, we can use relative paths
  if (hostname.startsWith("app.")) {
    return path;
  }

  // If we are on localhost but not the app version, use the query param hack
  if (isLocalHostname(hostname) && !hostname.startsWith("app.")) {
    if (path === "/") return "/?app=1";
    return `${path}${path.includes("?") ? "&" : "?"}app=1`;
  }

  // Otherwise, use the full origin for the app subdomain
  return `${getOriginForHostname(getAppHostname(hostname))}${path}`;
}

function getInternalTargetPath(target: string): string | undefined {
  const url = new URL(target, window.location.href);
  if (url.origin !== window.location.origin) {
    return undefined;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function shouldRedirectLegacyDocsRoute(): boolean {
  if (isDocsHostname() || isLocalHostname(window.location.hostname) || window.location.hostname.endsWith(".localhost")) {
    return false;
  }
  return window.location.pathname === LEGACY_DOCS_PATH;
}

function getCurrentRouteKey(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

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
  const hasWalletProvider = Boolean(getInjectedProvider());
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0c0e12" : "#f8f9fb");
  }, [theme]);

  useEffect(() => {
    if (shouldRedirectLegacyDocsRoute()) {
      window.location.replace(getDocsHref());
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
    const titles: Record<Page, string> = {
      landing: "Disburse — Settlement-grade stablecoin payments",
      dashboard: "Overview · Disburse",
      payments: "Direct send · Disburse",
      "qr-payments": "QR requests · Disburse",
      pay: "Pay request · Disburse",
      "import-export": "Backup · Disburse",
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
  }, []);

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
    const provider = getInjectedProvider();
    if (!provider) {
      setWalletNotice({
        tone: "error",
        text: "No injected wallet found. Open this page in a wallet browser or install a supported desktop wallet."
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

  async function handleSwitchNetwork() {
    const provider = getInjectedProvider();
    if (!provider) {
      setWalletNotice({
        tone: "error",
        text: "No injected wallet found. Open this page in a wallet browser or install a supported desktop wallet."
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

    const provider = getInjectedProvider();
    if (!provider) {
      setWalletNotice({
        tone: "error",
        text: "No injected wallet found. Open this page in a wallet browser or install a supported desktop wallet."
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
    const provider = getInjectedProvider();
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
    const provider = getInjectedProvider();
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
            <DocsPage />
          </main>
        </div>
      </I18nProvider>
    );
  }

  const routeMeta: Record<Exclude<Page, "landing">, { title: string; subtitle: string }> = {
    dashboard:       { title: "Overview",       subtitle: "Requests, receipts and network health at a glance." },
    payments:        { title: "Direct send",    subtitle: "Pay a wallet address directly on Arc Testnet." },
    "qr-payments":   { title: "QR requests",    subtitle: "Create a QR invoice for someone else to scan and pay." },
    pay:             { title: "Pay request",    subtitle: "Review and settle a QR payment request." },
    "import-export": { title: "Import · Export", subtitle: "Back up or restore your requests and receipts." },
    docs:            { title: "Documentation",  subtitle: "How Disburse settles, verifies, and exports payments." },
  };
  const { title: headerTitle, subtitle: headerSubtitle } = routeMeta[page as Exclude<Page, "landing">] ?? routeMeta.dashboard;

  return (
    <I18nProvider initialLang={appSettings.language} initialCurrency={appSettings.currency}>
    <div className="flex min-h-screen bg-[var(--canvas)] text-[var(--ink)] overflow-x-hidden relative">
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        page={page}
        onNavigate={handleNavigate}
      />

      <main className={cn("flex-1 flex flex-col transition-all duration-300 relative z-10", isSidebarCollapsed ? "ml-20" : "ml-60")}>
        <Header
          title={headerTitle}
          subtitle={headerSubtitle}
          account={account}
          chainId={chainId}
          expectedChainId={commonShellProps.expectedChainId}
          expectedChainLabel={commonShellProps.expectedChainLabel}
          isConnecting={isConnecting}
          onConnect={handleConnectWallet}
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
        
        <div className="flex-1 p-6 overflow-y-auto relative">
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
          {page === "docs" && <DocsPage />}
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
  return (
    <>
      <RouteHero eyebrow="Payments" title="Send stablecoins directly from your wallet." />

      <section className="workbench" aria-labelledby="payments-heading">
        <header className="section-header">
          <h2 id="payments-heading">Direct transfer</h2>
        </header>

        <div className="desk-grid single-flow-grid">
          <section className="desk-pane" aria-labelledby="direct-form-heading">
            <PaneTitle id="direct-form-heading" label="Payment details" />
            <form className="form-stack" onSubmit={(event) => event.preventDefault()}>
              <Field label="Recipient" helper="Address receiving your transfer">
                <input
                  value={form.recipient}
                  onChange={(event) => onFormChange({ ...form, recipient: event.target.value })}
                  placeholder="0x..."
                  spellCheck={false}
                />
              </Field>

              <div className="field-grid">
                <Field label="Token">
                  <select
                    value={form.token}
                    onChange={(event) => onFormChange({ ...form, token: event.target.value as PaymentToken })}
                  >
                    <option value="USDC">USDC</option>
                    <option value="EURC">EURC</option>
                  </select>
                </Field>
                <Field label="Amount">
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
                  {isEstimating ? "Estimating..." : "Estimate"}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={onSend}
                  disabled={!account || wrongChain || insufficientToken || missingGas || isSending}
                >
                  {isSending ? "Sending..." : "Send payment"}
                </button>
              </div>
            </form>

            {notice && <NoticeBar notice={notice} />}
          </section>

          <section className="desk-pane pay-pane" aria-labelledby="direct-summary-heading">
            <PaneTitle id="direct-summary-heading" label="Transfer summary" />
            <PaymentPreview
              title="Direct payment"
              amount={form.amount || "0"}
              token={form.token}
              recipient={form.recipient}
            />

            {estimate && <EstimateGrid estimate={estimate} />}

            {hash && (
              <div className="receipt-line">
                <div>
                  <span>Transaction</span>
                  <strong>{shortAddress(hash, 10, 8)}</strong>
                </div>
                <div className="receipt-actions">
                  <button className="text-button" type="button" onClick={() => onCopy(toExplorerTxUrl(hash))}>
                    Copy tx
                  </button>
                  <a href={toExplorerTxUrl(hash)} target="_blank" rel="noreferrer">
                    Open tx
                  </a>
                </div>
              </div>
            )}

            <div className="request-callout">
              <strong>Need someone else to pay you?</strong>
              <button className="secondary-button" type="button" onClick={() => onNavigate("/qr-payments")}>
                Generate QR request
              </button>
            </div>
          </section>
        </div>
      </section>
    </>
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
  const displayRequest = selectedRequest ? refreshDerivedStatus(selectedRequest, now) : undefined;
  const qrIsFinal = displayRequest ? shouldHideQrForStatus(displayRequest.status) : false;

  return (
    <>
      <RouteHero eyebrow="QR Payments" title="Create a fixed request for someone else to scan and pay." />

      <section className="workbench" aria-labelledby="qr-heading">
        <header className="section-header">
          <h2 id="qr-heading">Generate QR</h2>
        </header>

        <div className="desk-grid">
          <section className="desk-pane create-pane" aria-labelledby="qr-form-heading">
            <PaneTitle id="qr-form-heading" label="Request details" />
            <form className="form-stack" onSubmit={onSubmit}>
              <Field label="Recipient">
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
                    aria-label="Use connected wallet"
                    title="Use connected wallet"
                    onClick={() => account && onFormChange({ ...form, recipient: account })}
                    disabled={!account}
                  >
                    Me
                  </button>
                </div>
              </Field>

              <div className="field-grid">
                <Field label="Token">
                  <input value="USDC" readOnly aria-readonly="true" />
                </Field>
                <Field label="Amount">
                  <input
                    value={form.amount}
                    onChange={(event) => onFormChange({ ...form, amount: event.target.value })}
                    inputMode="decimal"
                    placeholder="10"
                  />
                </Field>
              </div>

              <Field label="Label">
                <input
                  value={form.label}
                  onChange={(event) => onFormChange({ ...form, label: event.target.value })}
                  placeholder="Invoice 2"
                />
              </Field>

              <Field label="Note">
                <textarea
                  value={form.note}
                  onChange={(event) => onFormChange({ ...form, note: event.target.value })}
                  placeholder="Food and Drink"
                  rows={3}
                />
              </Field>

              <Field label="Invoice date">
                <input
                  type="date"
                  value={form.invoiceDate}
                  onChange={(event) => onFormChange({ ...form, invoiceDate: event.target.value })}
                />
              </Field>

              <button className="primary-button" type="submit" disabled={isCreating}>
                {isCreating ? "Generating..." : "Generate QR"}
              </button>
            </form>

            {notice && <NoticeBar notice={notice} />}
          </section>

          <section className="desk-pane pay-pane" aria-labelledby="qr-output-heading">
            <PaneTitle id="qr-output-heading" label="QR output" />
            {displayRequest && shareUrl ? (
              <>
                <PaymentPreview
                  title={displayRequest.label}
                  note={displayRequest.note ?? "No note"}
                  amount={displayRequest.amount}
                  token={displayRequest.token}
                  recipient={displayRequest.recipient}
                  invoiceDate={displayRequest.invoiceDate}
                  status={displayRequest.status}
                />
                {isCrossChainPaymentRequest(displayRequest) && (
                  <div className="route-summary">
                    <Metric label="settles on" value="Arc Testnet" />
                    <Metric
                      label="pay from"
                      value={(displayRequest.allowedSourceChainIds ?? getAllowedSourceChainIds())
                        .map(getCrossChainLabel)
                        .join(", ")}
                    />
                  </div>
                )}

                {qrIsFinal ? (
                  <QrFinalState request={displayRequest} receipt={selectedReceipt} />
                ) : (
                  <div className={`qr-share ${displayRequest.txHash ? "submitted" : "watching"}`}>
                    {qrDataUrl ? (
                      <img src={qrDataUrl} alt="QR payment request code" />
                    ) : (
                      <div className="qr-placeholder">Generating QR</div>
                    )}
                    <div>
                      <span>Pay URL</span>
                      <code>{shareUrl}</code>
                      <div className="qr-live-line" aria-live="polite">
                        <span className="qr-live-dot" aria-hidden="true" />
                        {formatQrLiveStatus(displayRequest)}
                      </div>
                      <button className="secondary-button" type="button" onClick={() => onCopy(shareUrl)}>
                        Copy link
                      </button>
                    </div>
                  </div>
                )}

                {selectedReceipt && !qrIsFinal && (
                  <div className="receipt-line">
                    <div>
                      <span>Receipt</span>
                      <strong>{shortAddress(selectedReceipt.txHash, 10, 8)}</strong>
                    </div>
                    <a href={selectedReceipt.explorerUrl} target="_blank" rel="noreferrer">
                      Open tx
                    </a>
                  </div>
                )}
              </>
            ) : (
              <EmptyState title="No QR generated" text="Fill the request details and generate a QR payment link." />
            )}
          </section>
        </div>
      </section>

      <section id="qr-ledger" className="ledger-section">
        <header className="section-header inline-header">
          <div>
            <h2>QR ledger</h2>
            <p>{requests.length} QR requests stored locally.</p>
          </div>
          <div className="tool-actions">
            <button className="secondary-button" type="button" onClick={onExport} disabled={!requests.length}>
              Export
            </button>
            <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()}>
              Import
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={(event) => onImport(event.target.files?.[0])}
            />
          </div>
        </header>

        {requests.length ? (
          <div className="ledger-list">
            {requests.map((request) => {
              const receipt = receipts.find((item) => item.requestId === request.id);
              const requestUrl = buildShareUrl(request, window.location.origin);
              const displayRequest = refreshDerivedStatus(request, now);
              return (
                <article className={`ledger-row ${request.id === selectedRequest?.id ? "selected" : ""}`} key={request.id}>
                  <button type="button" className="ledger-main" onClick={() => onSelectRequest(request)}>
                    <StatusBadge status={displayRequest.status} />
                    <div>
                      <strong>{request.label}</strong>
                      <span>
                        {request.amount} {request.token} to {shortAddress(request.recipient)}
                      </span>
                    </div>
                  </button>
                  <div className="ledger-meta">
                    <span>{isCrossChainPaymentRequest(request) ? "Settles on Arc" : "Wallet QR"}</span>
                    <span>{formatInvoiceDate(request.invoiceDate)}</span>
                    <span>{formatTimeLeft(request, now)}</span>
                  </div>
                  <div className="ledger-actions">
                    <button className="text-button" type="button" onClick={() => onCopy(requestUrl)}>
                      Copy
                    </button>
                    <a className="text-button" href={requestUrl}>
                      Pay page
                    </a>
                    {receipt && (
                      <a className="text-button" href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                        Receipt
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title="QR ledger is empty" text="Generated QR payment requests appear here." />
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
  const hasSubmittedTransaction = Boolean(request?.txHash && request.status !== "paid");
  const submittedTxHash = request?.txHash;
  const submittedTxUrl =
    submittedTxHash && request && isCrossChainPaymentRequest(request)
      ? getCrossChainExplorerTxUrl(request.settlement?.sourceChainId ?? sourceChainId, submittedTxHash)
      : submittedTxHash
        ? toExplorerTxUrl(submittedTxHash)
        : undefined;
  const approvalTxUrl = approvalHash ? getCrossChainExplorerTxUrl(sourceChainId, approvalHash) : undefined;
  const payButtonLabel = getPayButtonLabel(isPaying, lifecycle);

  return (
    <>
      <RouteHero eyebrow="Pay QR request" title="Review the locked request, connect wallet, and pay." />

      <section className="workbench pay-request-shell" aria-labelledby="pay-request-heading">
        <header className="section-header">
          <h2 id="pay-request-heading">Payment request</h2>
          <p>The payer cannot change the amount, recipient, label, note, or invoice date from this scanned QR page.</p>
        </header>

        {request ? (
          <div className="desk-grid">
            <section className="desk-pane create-pane" aria-labelledby="locked-details-heading">
              <PaneTitle id="locked-details-heading" label="Locked details" />
              <PaymentPreview
                title={request.label}
                note={request.note ?? "No note"}
                amount={request.amount}
                token={request.token}
                recipient={request.recipient}
                invoiceDate={request.invoiceDate}
                status={status}
              />
              {isCrossChainPaymentRequest(request) && (
                <div className="route-summary">
                  <Metric label="settles on" value="Arc Testnet" />
                  <Metric label="selected source" value={getCrossChainLabel(sourceChainId)} />
                </div>
              )}
              <div className="expiry-grid">
                <Metric label="time left" value={formatTimeLeft(request, now)} />
                <Metric label="valid until" value={formatDateTime(request.expiresAt ?? request.dueAt)} />
              </div>
            </section>

            <section className="desk-pane pay-pane" aria-labelledby="pay-actions-heading">
              <PaneTitle id="pay-actions-heading" label="Pay with wallet" />
              {walletNotice && <NoticeBar notice={walletNotice} compact />}
              {!account && !hasWalletProvider && (
                <NoticeBar
                  compact
                  notice={{
                    tone: "info",
                    text: "No injected wallet found. Open this request in a wallet browser or install a supported desktop wallet."
                  }}
                />
              )}
              {isExpired && !isPayable && (
                <NoticeBar
                  compact
                  notice={{ tone: "error", text: "This QR request expired. Ask the requester for a fresh QR code." }}
                />
              )}
              {hasSubmittedTransaction && (
                <NoticeBar
                  compact
                  notice={{
                    tone: "info",
                    text: "A transaction hash is already saved for this request. Verify it before sending another payment."
                  }}
                />
              )}
              {isCrossChainPaymentRequest(request) && (
                <Field label="Pay from">
                  <select
                    value={sourceChainId}
                    onChange={(event) => onSourceChainChange(Number(event.target.value) as PaymentSourceChainId)}
                    disabled={Boolean(request.txHash)}
                  >
                    {(request.allowedSourceChainIds ?? getAllowedSourceChainIds()).map((chainId) => (
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
                switchLabel={`Switch to ${getCrossChainLabel(sourceChainId)}`}
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

              {lifecycle !== "idle" && (
                <div className="estimate-line">
                  <Metric label="payer stage" value={formatPayLifecycle(lifecycle)} />
                </div>
              )}

              <div className="action-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onEstimate}
                  disabled={!account || wrongChain || !isPayable || isEstimating}
                >
                  {isEstimating ? "Estimating..." : "Estimate"}
                </button>
                <button
                  className="primary-button"
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
                <button className="secondary-button" type="button" onClick={onVerify} disabled={isVerifying}>
                  {isVerifying ? "Verifying..." : "Verify"}
                </button>
              </div>

              {estimate && <EstimateGrid estimate={estimate} />}
              {notice && <NoticeBar notice={notice} />}

              {approvalHash && !receipt && (
                <div className="receipt-line">
                  <div>
                    <span>USDC approval</span>
                    <strong>{shortAddress(approvalHash, 10, 8)}</strong>
                  </div>
                  <div className="receipt-actions">
                    <button className="text-button" type="button" onClick={() => approvalTxUrl && onCopy(approvalTxUrl)}>
                      Copy tx
                    </button>
                    <a href={approvalTxUrl} target="_blank" rel="noreferrer">
                      Open tx
                    </a>
                  </div>
                </div>
              )}

              {submittedTxHash && !receipt && (
                <div className="receipt-line">
                  <div>
                    <span>Submitted transaction</span>
                    <strong>{shortAddress(submittedTxHash, 10, 8)}</strong>
                  </div>
                  <div className="receipt-actions">
                    <button className="text-button" type="button" onClick={() => submittedTxUrl && onCopy(submittedTxUrl)}>
                      Copy tx
                    </button>
                    <a href={submittedTxUrl} target="_blank" rel="noreferrer">
                      Open tx
                    </a>
                  </div>
                </div>
              )}

              {receipt && (
                <>
                  <div className="receipt-line">
                    <div>
                      <span>Receipt</span>
                      <strong>{shortAddress(receipt.txHash, 10, 8)}</strong>
                    </div>
                    <div className="receipt-actions">
                      <button className="text-button" type="button" onClick={() => onCopy(receipt.explorerUrl)}>
                        Copy tx
                      </button>
                      <button className="text-button" type="button" onClick={onInvoice} disabled={isGeneratingInvoice}>
                        {isGeneratingInvoice ? "Preparing PDF" : "Download invoice"}
                      </button>
                      <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                        Open tx
                      </a>
                    </div>
                  </div>

                  {/* Compliance Export Actions */}
                  <div className="compliance-actions">
                    <div className="compliance-header">
                      <span className="compliance-label">Settlement Exports</span>
                      {attestation && (
                        <span className="attestation-badge">
                          VSR: {attestation.uid}
                        </span>
                      )}
                    </div>
                    <div className="compliance-buttons">
                      {!attestation && onAttest && (
                        <button className="compliance-button" type="button" onClick={onAttest}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                          </svg>
                          Create Attestation
                        </button>
                      )}
                      {attestation && (
                        <button className="compliance-button attested" type="button" disabled>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Attested
                        </button>
                      )}
                      {onSettlementProof && (
                        <button className="compliance-button" type="button" onClick={onSettlementProof}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                          </svg>
                          Settlement Proof
                        </button>
                      )}
                      {onUBLExport && (
                        <button className="compliance-button" type="button" onClick={onUBLExport}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>
                          </svg>
                          UBL Invoice (XML)
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        ) : (
          <EmptyState title="No QR request loaded" text="Scan a QR payment code or open a valid /pay request URL." />
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
        <span>{recipient ? shortAddress(recipient) : "recipient not set"}</span>
      </div>
      {invoiceDate && (
        <div className="expiry-grid">
          <Metric label="invoice date" value={formatInvoiceDate(invoiceDate)} />
        </div>
      )}
    </div>
  );
}

function QrFinalState({ request, receipt }: { request: PaymentRequest; receipt?: Receipt }) {
  const copy =
    request.status === "paid"
      ? {
          title: "Payment confirmed",
          text: "The requester has the confirmation. This QR code is now closed."
        }
      : request.status === "failed"
        ? {
            title: "Payment failed",
            text: "This QR code is no longer payable. Generate a fresh request before trying again."
          }
        : {
            title: "QR expired",
            text: "The payment window has closed. Generate a fresh QR code for this request."
          };

  return (
    <div className={`qr-final-state ${request.status}`} aria-live="polite">
      <span className="qr-final-mark" aria-hidden="true" />
      <div>
        <strong>{copy.title}</strong>
        <p>{copy.text}</p>
        {receipt && (
          <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
            Open receipt
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
  return (
    <>
      {walletNotice && <NoticeBar notice={walletNotice} compact />}
      {!account && !hasWalletProvider && (
        <NoticeBar
          compact
          notice={{
            tone: "info",
            text: "No injected wallet found. Open this page in a wallet browser or install a supported desktop wallet."
          }}
        />
      )}
      {!account && (
        <button className="primary-button" type="button" onClick={onConnect} disabled={isConnecting}>
          {isConnecting ? "Connecting..." : "Connect wallet"}
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
  return (
    <>
      <div className="wallet-table">
        <Metric label="wallet" value={shortAddress(account)} />
        <Metric label={`${token} balance`} value={balances ? `${trimDisplay(balances.tokenBalance, 6)} ${token}` : "loading"} />
        <Metric label="gas balance" value={balances ? `${trimDisplay(balances.nativeGas, 8)} ${nativeSymbol}` : "loading"} />
        <Metric label="network" value={networkLabel} />
      </div>
      {insufficientToken && <NoticeBar compact notice={{ tone: "error", text: `Insufficient ${token} balance.` }} />}
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
  const symbol = estimate.nativeSymbol ?? "USDC";
  const gasLabel = estimate.needsApproval && estimate.approvalGas ? "approval + payment gas" : "estimated gas";
  return (
    <div className="estimate-line">
      <Metric label={gasLabel} value={estimate.gas.toString()} />
      <Metric label="gas price" value={`${trimDisplay(formatUnits(estimate.gasPrice, 18), 8)} ${symbol}`} />
      <Metric label="estimated fee" value={`${trimDisplay(estimate.fee, 8)} ${symbol}`} />
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
            Docs
          </span>
        </a>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleTheme}
            className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--line-soft)] hover:text-[var(--ink)]"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
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
            Launch console
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

function DocsPage() {
  const [activeSlug, setActiveSlug] = useState<string>(() => slugify(docsSections[0]?.title ?? ""));

  // Scrollspy — highlights the TOC entry for the section nearest the top.
  useEffect(() => {
    const slugs = docsSections.map((s) => slugify(s.title));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) {
          setActiveSlug(visible.target.id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: [0, 1] },
    );
    for (const slug of slugs) {
      const el = document.getElementById(slug);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  function scrollToSlug(slug: string) {
    const el = document.getElementById(slug);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSlug(slug);
    }
  }

  return (
    <div className="mx-auto max-w-[1180px] pb-16">
      {/* Hero */}
      <section className="border-b border-[var(--line)] pb-10">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
          Documentation
        </p>
        <h1 className="max-w-[24ch] text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-[var(--ink)]">
          How Disburse settles, verifies, and exports a payment.
        </h1>
        <p className="mt-5 max-w-[66ch] text-[15px] leading-relaxed text-[var(--muted)]">
          A concise technical reference for the Arc Testnet payment console: what
          the product does, how requests move from QR code to wallet transaction,
          and where the current release draws its boundaries.
        </p>

        <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--line-soft)] pt-6 sm:grid-cols-4">
          {docsSummaryItems.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                {item.label}
              </dt>
              <dd className="truncate text-[13px] font-medium text-[var(--ink)]">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Manual */}
      <section className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        {/* TOC */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            On this page
          </p>
          <nav className="flex flex-col gap-0.5">
            {docsSections.map((section) => {
              const slug = slugify(section.title);
              const active = slug === activeSlug;
              return (
                <a
                  key={slug}
                  href={`#${slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSlug(slug);
                    window.history.replaceState(null, "", `#${slug}`);
                  }}
                  className={cx(
                    "relative rounded-md py-1.5 pl-3 pr-2 text-[13px] transition-colors",
                    active
                      ? "text-[var(--ink)]"
                      : "text-[var(--muted)] hover:text-[var(--ink)]",
                  )}
                >
                  <span
                    className={cx(
                      "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full transition-all",
                      active ? "bg-[var(--primary-bg)]" : "bg-transparent",
                    )}
                    aria-hidden="true"
                  />
                  {section.title}
                </a>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="min-w-0">
          {docsSections.map((section, index) => (
            <article
              key={section.title}
              id={slugify(section.title)}
              className="scroll-mt-20 border-b border-[var(--line-soft)] py-10 first:pt-0 last:border-b-0"
            >
              <p className="mb-3 font-mono text-[11px] text-[var(--muted)]">
                § {String(index + 1).padStart(2, "0")}
              </p>
              <h2 className="mb-4 text-[22px] font-semibold tracking-tight text-[var(--ink)]">
                {section.title}
              </h2>
              <div className="space-y-3 text-[15px] leading-[1.7] text-[var(--muted)]">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="max-w-[72ch]">
                    {paragraph}
                  </p>
                ))}
              </div>
              {section.points && (
                <ul className="mt-5 max-w-[72ch] space-y-2">
                  {section.points.map((point) => (
                    <li
                      key={point}
                      className="relative pl-5 text-[14px] leading-[1.65] text-[var(--muted)] before:absolute before:left-0 before:top-[0.65em] before:h-1.5 before:w-1.5 before:rounded-full before:border before:border-[var(--primary-bg)]/60"
                    >
                      {point}
                    </li>
                  ))}
                </ul>
              )}
              {section.code && (
                <pre className="mt-5 max-w-[72ch] overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--input-bg)] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[var(--ink)]">
                  <code>{section.code}</code>
                </pre>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function slugify(value: string): string {
  return value.toLowerCase().replaceAll(" ", "-");
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
  const showArcLinks = networkLabel === "Arc Testnet";
  const extraToken = insufficientToken && token !== "USDC" ? ` and ${token}` : "";
  const message = missingGas
    ? token === "USDC"
      ? `Fund enough ${networkLabel} ${token} plus ${nativeSymbol} gas.`
      : `Fund ${networkLabel} ${nativeSymbol} for gas${extraToken}.`
    : `Fund more ${token} on ${networkLabel}.`;

  return (
    <div className="recovery-panel">
      <div>
        <strong>Balance recovery</strong>
        <span>{message}</span>
      </div>
      {showArcLinks && (
        <div className="tool-actions">
          <a className="secondary-button" href={ARC_FAUCET_URL} target="_blank" rel="noreferrer">
            Faucet
          </a>
          <a className="secondary-button" href={toExplorerAddressUrl(account)} target="_blank" rel="noreferrer">
            Arcscan wallet
          </a>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  return <span className={`status-badge ${status}`}>{status.replace("_", " ")}</span>;
}

function formatPayLifecycle(lifecycle: PayLifecycle): string {
  switch (lifecycle) {
    case "awaiting_wallet":
      return "awaiting wallet";
    case "proving":
      return "generating proof";
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

function getPayButtonLabel(isPaying: boolean, lifecycle: PayLifecycle): string {
  if (!isPaying) {
    return "Pay request";
  }

  switch (lifecycle) {
    case "preparing":
      return "Preparing...";
    case "awaiting_wallet":
      return "Approve in wallet";
    case "submitted":
    case "confirming":
      return "Confirming...";
    case "proving":
      return "Generating proof...";
    case "settling":
      return "Settling...";
    case "verified":
      return "Verified";
    case "failed":
      return "Retry payment";
    case "idle":
    default:
      return "Pay request";
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
  const totalVolume = requests.reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const verifiedVolume = requests
    .filter((request) => refreshDerivedStatus(request, now).status === "paid")
    .reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const pendingVolume = requests
    .filter((request) => refreshDerivedStatus(request, now).status === "open")
    .reduce((sum, request) => sum + Number(request.amount || 0), 0);
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

  return (
    <div className="w-full mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6 pb-12 relative z-10">
      {/* Main Area */}
      <div className="xl:col-span-8 space-y-6">
        <BalanceCard
          totalVolume={totalVolume.toFixed(2)}
          verifiedVolume={verifiedVolume.toFixed(2)}
          pendingVolume={pendingVolume.toFixed(2)}
          requestCount={requests.length}
          receiptCount={receipts.length}
          account={account}
          onNavigate={onNavigate}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <MonthlyStats activityData={activityData} />
          <SystemStatusCard
            monthlyData={monthlyData}
            rpcStatusLabel={rpcStatusLabel}
            rpcBlockLabel={rpcBlockLabel}
            rpcHealthy={rpcHealth?.healthy}
          />
        </div>

        <TransactionsTable
          requests={requests}
          receipts={receipts}
          now={now}
          onNavigate={onNavigate}
        />
      </div>

      {/* Right Sidebar */}
      <aside className="xl:col-span-4 space-y-6">
        <div className="border border-brand-border bg-brand-dark p-6 text-xs text-muted leading-relaxed hover:border-[#222] transition-all duration-300 hover:-translate-y-0.5">
          <p className="font-medium text-white mb-1">Console Note</p>
          <p>Test the complete payment flow using the QR Generator without signing real transactions on Arc Testnet.</p>
        </div>
      </aside>
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
  return (
    <>
      <section className="workbench" >
        <div className="ie-page">
          <div className="ie-card">
            <h3>Export payment history</h3>
            <p>Download all {requests.length} payment requests and {receipts.length} receipts as a JSON file. This file can be imported on another device or browser.</p>
            <button className="primary-button" type="button" onClick={onExport} disabled={!requests.length}>
              Export JSON
            </button>
          </div>
          <div className="ie-card">
            <h3>Import payment data</h3>
            <p>Upload a previously exported JSON file to merge payment requests and receipts into your local data.</p>
            <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()}>
              Choose file
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={(event) => onImport(event.target.files?.[0])}
            />
          </div>
          <div className="onboarding-card">
            <strong>Data stays local</strong>
            All payment request and receipt data is stored in your browser's localStorage. Exporting creates a portable backup that does not leave your device until you choose to share it.
          </div>
        </div>
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

export default App;
