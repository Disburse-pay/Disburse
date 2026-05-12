import { type FormEvent, type MouseEvent, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type Page = "landing" | "dashboard" | "payments" | "qr-payments" | "pay" | "import-export" | "milestones" | "statements" | "docs";
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

const docsSectionsId: DocsSection[] = [
  {
    title: "Ruang lingkup proyek",
    body: [
      "Disburse adalah konsol pembayaran non-kustodial untuk Arc Testnet. Aplikasi ini dibuat untuk dua tugas praktis: mengirim transfer stablecoin dari wallet yang terhubung, dan membuat permintaan pembayaran QR yang bisa dibuka dan dibayar oleh wallet lain.",
      "Build saat ini sengaja dibuat fokus. Aplikasi tidak menyimpan saldo, mengambil private key, atau menjalankan akun kustodial. Browser menyiapkan permintaan, wallet menandatangani transaksi, dan status pembayaran diverifikasi dari data Arc Testnet."
    ],
    points: [
      "Route aplikasi utama: /payments, /qr-payments, dan /pay.",
      `Dokumentasi disajikan dari ${PRODUCTION_DOCS_HOSTNAME}.`,
      "Aksi yang didukung: koneksi wallet, perpindahan ke Arc Testnet, estimasi gas, transfer ERC-20, pembuatan permintaan QR, verifikasi transfer, import/export, dan unduhan invoice.",
      "Di luar cakupan release ini: saldo kustodial, Permit2, alur 402 yang ditegakkan backend, rail MPP, dan perlindungan replay di server."
    ]
  },
  {
    title: "Alur pembayaran",
    body: [
      "Disburse memisahkan transfer langsung dari pembayaran berbasis permintaan. Pembayaran Langsung dipakai saat pengirim sudah tahu penerima, token, dan jumlah. Pembayaran QR dipakai saat requester ingin menerbitkan permintaan tetap untuk dibayar orang lain.",
      "Permintaan QR yang dipindai membuka halaman payer dengan detail yang terkunci. Payer dapat menghubungkan wallet, memperkirakan transfer, mengirim transaksi, memverifikasi hasil, dan mengunduh invoice setelah konfirmasi."
    ],
    points: [
      "Payments: pengirim mengisi penerima, token, dan jumlah, lalu menandatangani transfer wallet.",
      "QR Payments: requester mengisi penerima, token, jumlah, label, catatan, dan tanggal invoice, lalu membagikan URL permintaan sebagai QR code.",
      "Pembayaran Langsung tidak membuat record permintaan QR di ledger lokal."
    ]
  },
  {
    title: "Jaringan dan aset",
    body: [
      "Aplikasi dipasang untuk Arc Testnet. Gas native direpresentasikan sebagai USDC dengan 18 desimal, sedangkan jumlah pembayaran ERC-20 yang didukung memakai 6 desimal.",
      "Akses RPC ditangani lewat daftar failover kecil. Antarmuka menampilkan endpoint aktif, blok terbaru, harga gas aman, chain id, dan pemeriksaan desimal token agar pengguna bisa melihat apakah jalur jaringan sehat sebelum menandatangani."
    ],
    points: [
      `Chain ID: ${ARC_CHAIN_ID}`,
      `RPC: ${new URL(ARC_RPC_URL).host}`,
      `Endpoint failover: ${ARC_RPC_ENDPOINTS.length}`,
      `USDC: ${TOKENS.USDC.address}`,
      `EURC: ${TOKENS.EURC.address}`
    ]
  },
  {
    title: "Payload permintaan QR",
    body: [
      "QR code berisi URL /pay dengan payload JSON base64url pada parameter query r. Payload hanya deskripsi permintaan portabel; tidak pernah berisi private key, approval wallet, saldo token, atau transaksi yang sudah ditandatangani.",
      "Permintaan menyimpan token, jumlah, penerima, label, waktu pembuatan, dan blok awal. Blok awal itu membatasi verifikasi ke transfer yang terjadi setelah permintaan dibuat."
    ],
    points: [
      "Field wajib: version, id, recipient, token, amount, label, createdAt, dan startBlock.",
      "Field opsional: note, invoiceDate, expiresAt, dan dueAt.",
      `Kedaluwarsa default: ${PAYMENT_VALIDITY_MINUTES} menit setelah dibuat. Percobaan pembayaran yang dimulai sebelum kedaluwarsa tetap bisa diverifikasi.`
    ],
    code: "/pay?r=<base64url({ version, id, recipient, token, amount, label, note?, invoiceDate?, expiresAt?, dueAt?, createdAt, startBlock })>"
  },
  {
    title: "Eksekusi wallet",
    body: [
      "Pembayaran adalah pemanggilan transfer ERC-20 standar yang ditandatangani oleh wallet terhubung. Aplikasi memperkirakan gas dengan viem, menerapkan batas bawah harga gas Arc, menyimpan hash transaksi wallet segera setelah dikirim, lalu menunggu konfirmasi.",
      "Wallet tetap menjadi otoritas untuk tanda tangan. Disburse menyiapkan calldata dan menampilkan pemeriksaan, tetapi approval akhir terjadi di dalam wallet."
    ],
    points: [
      "Connect: eth_requestAccounts.",
      "Jaringan: wallet_switchEthereumChain, dengan fallback wallet_addEthereumChain untuk Arc Testnet.",
      "Transfer: eth_sendTransaction dengan calldata ERC-20 transfer(recipient, parsedAmount) pada kontrak USDC atau EURC yang dipilih.",
      "Gas: estimasi dipakai untuk tampilan dan pemeriksaan saldo; wallet menentukan gas transaksi akhir saat signing."
    ]
  },
  {
    title: "Ledger lokal dan realtime",
    body: [
      "Permintaan QR dan receipt disimpan di localStorage browser agar requester bisa mengelola pekerjaan tanpa membuat akun. Ledger mendukung export dan import JSON untuk backup atau migrasi.",
      "Saat Supabase dikonfigurasi, permintaan QR juga bisa ditulis melalui fungsi API Vercel. Event realtime membuat tampilan requester dapat menutup QR code ketika payer mengirim, mengonfirmasi, menggagalkan, atau membuat permintaan kedaluwarsa."
    ],
    points: [
      "Storage key: disburse.requests dan disburse.receipts.",
      "Key lama tetap dibaca: arc-pay-desk.requests dan arc-pay-desk.receipts.",
      "Permintaan diindeks memakai request id. Receipt di-upsert memakai request id atau transaction hash.",
      "URL explorer hasil import dibuat ulang dari hash transaksi Arcscan yang sudah diverifikasi."
    ]
  },
  {
    title: "Output invoice",
    body: [
      "Setelah payer mengonfirmasi dan transfer diverifikasi dari data Arc Testnet, halaman bayar dapat membuat invoice PDF lokal.",
      "Invoice dibuat di browser. File tidak diunggah oleh aplikasi dan tidak dikirim lewat email oleh server pada build ini."
    ],
    points: [
      "Invoice berisi tx hash, blok, jumlah, label, catatan, tanggal invoice, payer, penerima, waktu konfirmasi, dan link Arcscan.",
      "Tanggal invoice adalah metadata tampilan, bukan waktu kedaluwarsa pembayaran.",
      "Tidak ada server yang menyimpan atau mengirim file invoice lewat email pada build ini."
    ]
  },
  {
    title: "Verifikasi",
    body: [
      "Verifikasi pertama memeriksa hash transaksi yang diketahui. Jika tidak ada hash, aplikasi memindai log Transfer ERC-20 dalam jendela 10.000 blok dari blok awal permintaan sampai blok terbaru dan membandingkan penerima serta jumlah token yang tepat.",
      "Permintaan ditandai lunas hanya ketika kontrak token, penerima, dan jumlah cocok. Transfer ke penerima yang benar dengan jumlah berbeda ditampilkan terpisah agar pengguna bisa meninjaunya tanpa memperlakukannya sebagai settled."
    ],
    points: [
      "Lunas: transfer tepat ke penerima untuk jumlah token yang diminta.",
      "Kemungkinan cocok: transfer ke penerima ada, tetapi jumlah berbeda.",
      "Terbuka: tidak ditemukan transfer yang cocok dari blok awal permintaan."
    ],
    code: "match = log.address == token && log.args.to == recipient && log.args.value == parseUnits(amount, token.decimals)"
  }
];

const docsSectionsDe: DocsSection[] = [
  {
    title: "Projektumfang",
    body: [
      "Disburse ist eine nicht-kustodiale Zahlungskonsole für Arc Testnet. Sie deckt zwei praktische Aufgaben ab: eine Stablecoin-Überweisung aus einer injected Wallet senden und eine QR-Zahlungsanfrage erstellen, die eine andere Wallet öffnen und bezahlen kann.",
      "Der aktuelle Build ist bewusst eng gehalten. Die App hält keine Guthaben, sammelt keine Private Keys und betreibt kein Verwahrkonto. Der Browser bereitet die Anfrage vor, die Wallet signiert die Transaktion, und der Zahlungsstatus wird gegen Arc-Testnet-Daten verifiziert."
    ],
    points: [
      "Primäre App-Routen: /payments, /qr-payments und /pay.",
      `Dokumentation wird von ${PRODUCTION_DOCS_HOSTNAME} ausgeliefert.`,
      "Unterstützt werden Wallet-Verbindung, Wechsel zu Arc Testnet, Gas-Schätzung, ERC-20-Transfers, QR-Anfragen, Transferverifizierung, Import/Export und Rechnungsdownload.",
      "Nicht enthalten in diesem Release: kustodiale Guthaben, Permit2, backend-erzwungene 402-Flows, MPP-Rails und serverseitiger Replay-Schutz."
    ]
  },
  {
    title: "Zahlungsabläufe",
    body: [
      "Disburse trennt direkte Überweisungen von anfragebasierten Zahlungen. Direkte Zahlungen werden genutzt, wenn Sender, Empfänger, Token und Betrag bereits bekannt sind. QR-Zahlungen werden genutzt, wenn ein Anforderer eine feste Anfrage veröffentlichen will.",
      "Eine gescannte QR-Anfrage öffnet die Zahlerseite mit gesperrten Details. Der Zahler kann eine Wallet verbinden, den Transfer schätzen, die Transaktion senden, das Ergebnis verifizieren und nach der Bestätigung die Rechnung herunterladen."
    ],
    points: [
      "Payments: Der Sender gibt Empfänger, Token und Betrag ein und signiert eine Wallet-Überweisung.",
      "QR Payments: Der Anforderer gibt Empfänger, Token, Betrag, Label, Notiz und Rechnungsdatum ein und teilt die Anfrage-URL als QR-Code.",
      "Direkte Zahlungen erzeugen keine QR-Anfragedatensätze im lokalen Ledger."
    ]
  },
  {
    title: "Netzwerk und Assets",
    body: [
      "Die App ist auf Arc Testnet festgelegt. Native Gas wird als USDC mit 18 Dezimalstellen dargestellt, während unterstützte ERC-20-Zahlungsbeträge 6 Dezimalstellen verwenden.",
      "RPC-Zugriff läuft über eine kleine Failover-Liste. Die Oberfläche zeigt aktiven Endpoint, neuesten Block, sicheren Gaspreis, Chain-ID und Token-Dezimalprüfungen, damit der Nutzer den Netzwerkpfad vor dem Signieren prüfen kann."
    ],
    points: [
      `Chain ID: ${ARC_CHAIN_ID}`,
      `RPC: ${new URL(ARC_RPC_URL).host}`,
      `Failover-Endpunkte: ${ARC_RPC_ENDPOINTS.length}`,
      `USDC: ${TOKENS.USDC.address}`,
      `EURC: ${TOKENS.EURC.address}`
    ]
  },
  {
    title: "QR-Anfrage-Payload",
    body: [
      "Ein QR-Code enthält eine /pay-URL mit einem base64url-JSON-Payload im Query-Parameter r. Der Payload ist nur eine portable Anfragebeschreibung; er enthält niemals Private Keys, Wallet-Freigaben, Token-Guthaben oder signierte Transaktionen.",
      "Die Anfrage speichert Token, Betrag, Empfänger, Label, Erstellungszeit und Startblock. Dieser Startblock begrenzt die Verifizierung auf Transfers, die nach der Erstellung passiert sind."
    ],
    points: [
      "Pflichtfelder: version, id, recipient, token, amount, label, createdAt und startBlock.",
      "Optionale Felder: note, invoiceDate, expiresAt und dueAt.",
      `Standardablauf: ${PAYMENT_VALIDITY_MINUTES} Minuten nach Erstellung. Ein vor Ablauf gestarteter Zahlungsversuch kann weiterhin verifiziert werden.`
    ],
    code: "/pay?r=<base64url({ version, id, recipient, token, amount, label, note?, invoiceDate?, expiresAt?, dueAt?, createdAt, startBlock })>"
  },
  {
    title: "Wallet-Ausführung",
    body: [
      "Zahlungen sind standardmäßige ERC-20-transfer-Aufrufe, die von der verbundenen Wallet signiert werden. Die App schätzt Gas mit viem, wendet den Arc-Gaspreis-Floor an, speichert den Transaktionshash sofort nach dem Senden und wartet dann auf Bestätigung.",
      "Die Wallet bleibt die Autorität für Signaturen. Disburse bereitet Calldata vor und zeigt Prüfungen an, aber die finale Freigabe passiert in der Wallet."
    ],
    points: [
      "Connect: eth_requestAccounts.",
      "Netzwerk: wallet_switchEthereumChain, mit wallet_addEthereumChain als Fallback für Arc Testnet.",
      "Transfer: eth_sendTransaction mit ERC-20 transfer(recipient, parsedAmount) calldata auf dem gewählten USDC- oder EURC-Kontrakt.",
      "Gas: Schätzungen werden für Anzeige und Saldo-Prüfungen genutzt; die Wallet finalisiert das Transaktionsgas beim Signieren."
    ]
  },
  {
    title: "Lokales Ledger und Realtime",
    body: [
      "QR-Anfragen und Belege werden im localStorage des Browsers gespeichert, damit der Anforderer ohne Konto arbeiten kann. Das Ledger unterstützt JSON-Export und -Import für Backup oder Migration.",
      "Wenn Supabase konfiguriert ist, können QR-Anfragen auch über Vercel-API-Funktionen geschrieben werden. Realtime-Events schließen den QR-Code in der Anfordereransicht, wenn der Zahler sendet, bestätigt, fehlschlägt oder eine Anfrage abläuft."
    ],
    points: [
      "Storage-Keys: disburse.requests und disburse.receipts.",
      "Legacy-Keys werden weiter gelesen: arc-pay-desk.requests und arc-pay-desk.receipts.",
      "Anfragen werden nach request id gespeichert. Belege werden nach request id oder transaction hash upserted.",
      "Importierte Explorer-URLs werden aus dem verifizierten Arcscan-Transaktionshash neu erzeugt."
    ]
  },
  {
    title: "Rechnungsausgabe",
    body: [
      "Nachdem der Zahler bestätigt und der Transfer aus Arc-Testnet-Daten verifiziert wurde, kann die Zahlungsseite eine lokale PDF-Rechnung erstellen.",
      "Rechnungen werden im Browser erzeugt. Sie werden in diesem Build weder von der App hochgeladen noch vom Server per E-Mail versendet."
    ],
    points: [
      "Die Rechnung enthält Tx-Hash, Block, Betrag, Label, Notiz, Rechnungsdatum, Zahler, Empfänger, Bestätigungszeit und Arcscan-Link.",
      "Das Rechnungsdatum ist Anzeige-Metadatum, nicht der Ablauf der Zahlung.",
      "Kein Server speichert oder versendet Rechnungsdateien in diesem Build."
    ]
  },
  {
    title: "Verifizierung",
    body: [
      "Die Verifizierung prüft zuerst einen bekannten Transaktionshash. Wenn kein Hash vorliegt, scannt sie ERC-20-Transfer-Logs in 10.000-Block-Fenstern vom Startblock bis zum neuesten Block und vergleicht Empfänger plus exakten Tokenbetrag.",
      "Eine Anfrage wird nur dann als bezahlt markiert, wenn Token-Kontrakt, Empfänger und Betrag übereinstimmen. Transfers an den richtigen Empfänger mit anderem Betrag werden separat angezeigt."
    ],
    points: [
      "Bezahlt: exakter Transfer an den Empfänger für den angeforderten Tokenbetrag.",
      "Möglicher Treffer: Transfer an den Empfänger existiert, aber der Betrag ist anders.",
      "Offen: kein passender Transfer ab dem Startblock gefunden."
    ],
    code: "match = log.address == token && log.args.to == recipient && log.args.value == parseUnits(amount, token.decimals)"
  }
];

const docsSectionsHi: DocsSection[] = [
  {
    title: "प्रोजेक्ट का दायरा",
    body: [
      "Disburse Arc Testnet के लिए non-custodial भुगतान कंसोल है. यह दो कामों के लिए बनाया गया है: injected wallet से stablecoin transfer भेजना, और QR भुगतान अनुरोध बनाना जिसे दूसरा wallet खोलकर भुगतान कर सके.",
      "मौजूदा build जानबूझकर सीमित है. यह balance नहीं रखता, private key नहीं लेता, और custodial account नहीं चलाता. Browser अनुरोध तैयार करता है, wallet transaction sign करता है, और payment status Arc Testnet data से verify होता है."
    ],
    points: [
      "मुख्य app routes: /payments, /qr-payments, और /pay.",
      `Documentation ${PRODUCTION_DOCS_HOSTNAME} से serve होती है.`,
      "Supported actions: wallet connection, Arc Testnet switching, gas estimation, ERC-20 transfers, QR request creation, transfer verification, import/export, और invoice download.",
      "इस release के बाहर: custodial balances, Permit2, backend-enforced 402 flows, MPP rails, और server-side replay protection."
    ]
  },
  {
    title: "भुगतान flow",
    body: [
      "Disburse immediate transfers और request-based payments को अलग रखता है. Direct Payments तब उपयोग होते हैं जब sender recipient, token और amount पहले से जानता है. QR Payments तब उपयोग होते हैं जब requester किसी और से भुगतान लेने के लिए fixed request publish करना चाहता है.",
      "Scanned QR request payer page खोलता है जहां request details locked रहती हैं. Payer wallet connect कर सकता है, transfer estimate कर सकता है, transaction submit कर सकता है, result verify कर सकता है, और confirmation के बाद invoice download कर सकता है."
    ],
    points: [
      "Payments: sender recipient, token और amount भरता है, फिर wallet transfer sign करता है.",
      "QR Payments: requester recipient, token, amount, label, note और invoice date भरता है, फिर request URL को QR code के रूप में share करता है.",
      "Direct Payments local ledger में QR request records नहीं बनाते."
    ]
  },
  {
    title: "नेटवर्क और asset",
    body: [
      "App Arc Testnet पर pinned है. Native gas को 18 decimals वाले USDC की तरह दिखाया जाता है, जबकि supported ERC-20 payment amounts 6 decimals उपयोग करते हैं.",
      "RPC access एक छोटी failover list से संभाला जाता है. Interface active endpoint, latest block, safe gas price, chain id और token decimal checks दिखाता है ताकि user signing से पहले network path की health देख सके."
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
    title: "QR अनुरोध payload",
    body: [
      "QR code में /pay URL होता है जिसमें r query parameter पर base64url JSON payload रहता है. Payload सिर्फ portable request description है; इसमें private key, wallet approval, token balance या signed transaction कभी नहीं होता.",
      "Request token, amount, recipient, label, creation time और start block रिकॉर्ड करता है. Start block verification को उन transfers तक सीमित करता है जो request बनने के बाद हुए."
    ],
    points: [
      "Required fields: version, id, recipient, token, amount, label, createdAt, और startBlock.",
      "Optional fields: note, invoiceDate, expiresAt, और dueAt.",
      `Default expiry: creation के ${PAYMENT_VALIDITY_MINUTES} मिनट बाद. Expiry से पहले शुरू हुआ submitted payment attempt बाद में भी verify हो सकता है.`
    ],
    code: "/pay?r=<base64url({ version, id, recipient, token, amount, label, note?, invoiceDate?, expiresAt?, dueAt?, createdAt, startBlock })>"
  },
  {
    title: "Wallet execution",
    body: [
      "Payments connected wallet द्वारा signed standard ERC-20 transfer calls हैं. App viem से gas estimate करता है, Arc gas-price floor लागू करता है, wallet transaction hash submit होते ही save करता है, और confirmation का wait करता है.",
      "Signing की authority wallet के पास रहती है. Disburse calldata तैयार करता है और checks दिखाता है, लेकिन final approval wallet के अंदर होता है."
    ],
    points: [
      "Connect: eth_requestAccounts.",
      "Network: wallet_switchEthereumChain, Arc Testnet के लिए wallet_addEthereumChain fallback के साथ.",
      "Transfer: selected USDC या EURC contract पर ERC-20 transfer(recipient, parsedAmount) calldata के साथ eth_sendTransaction.",
      "Gas: estimates display और balance checks के लिए इस्तेमाल होते हैं; wallet signing के समय final transaction gas तय करता है."
    ]
  },
  {
    title: "Local ledger और realtime",
    body: [
      "QR requests और receipts browser localStorage में stored हैं ताकि requester account बनाए बिना काम manage कर सके. Ledger backup या migration के लिए JSON export और import support करता है.",
      "Supabase configured होने पर QR requests Vercel API functions के जरिए भी लिखे जा सकते हैं. Realtime events requester view में QR code को close कर सकते हैं जब payer request submit, confirm, fail या expire करता है."
    ],
    points: [
      "Storage keys: disburse.requests और disburse.receipts.",
      "Legacy keys अभी भी read होते हैं: arc-pay-desk.requests और arc-pay-desk.receipts.",
      "Requests request id से keyed होते हैं. Receipts request id या transaction hash से upsert होते हैं.",
      "Imported explorer URLs verified Arcscan transaction hash से regenerate होते हैं."
    ]
  },
  {
    title: "Invoice output",
    body: [
      "Payer confirmation और Arc Testnet data से transfer verification के बाद pay page local PDF invoice generate कर सकता है.",
      "Invoices browser में बनते हैं. इस build में app उन्हें upload नहीं करता और server email नहीं भेजता."
    ],
    points: [
      "Invoice में tx hash, block, amount, label, note, invoice date, payer, recipient, confirmation time और Arcscan link शामिल हैं.",
      "Invoice date display metadata है, payment expiry नहीं.",
      "इस build में कोई server invoice files store या email नहीं करता."
    ]
  },
  {
    title: "Verification",
    body: [
      "Verification पहले known transaction hash check करता है. अगर hash नहीं है, तो request start block से latest तक 10,000-block windows में ERC-20 Transfer logs scan करता है और recipient plus exact token amount compare करता है.",
      "Request सिर्फ तब paid mark होती है जब token contract, recipient और amount match करते हैं. सही recipient को अलग amount वाले transfers अलग दिखाए जाते हैं ताकि user review कर सके."
    ],
    points: [
      "Paid: requested token amount के लिए recipient को exact transfer.",
      "Possible match: recipient को transfer मिला, लेकिन amount अलग है.",
      "Open: request start block से कोई matching transfer नहीं मिला."
    ],
    code: "match = log.address == token && log.args.to == recipient && log.args.value == parseUnits(amount, token.decimals)"
  }
];

const docsSectionsZh: DocsSection[] = [
  {
    title: "项目范围",
    body: [
      "Disburse 是 Arc Testnet 的非托管付款控制台。它面向两个实际任务：从注入式钱包发送稳定币转账，以及创建可由其他钱包打开并支付的 QR 付款请求。",
      "当前版本刻意保持聚焦。它不持有余额、不收集私钥，也不运营托管账户。浏览器准备请求，钱包签署交易，付款状态从 Arc Testnet 数据中验证。"
    ],
    points: [
      "主要应用路由：/payments、/qr-payments 和 /pay。",
      `文档由 ${PRODUCTION_DOCS_HOSTNAME} 提供。`,
      "支持的钱包连接、Arc Testnet 切换、gas 估算、ERC-20 转账、QR 请求创建、转账验证、导入/导出和发票下载。",
      "本版本不包含：托管余额、Permit2、后端强制的 402 流程、MPP rails 和服务端 replay 防护。"
    ]
  },
  {
    title: "付款流程",
    body: [
      "Disburse 将即时转账和基于请求的付款分开。直接付款用于发送方已知道收款人、token 和金额的场景。QR 付款用于请求方发布固定请求，让他人付款。",
      "扫描 QR 请求会打开付款页面，并锁定请求详情。付款人可以连接钱包、估算转账、提交交易、验证结果，并在确认后下载发票。"
    ],
    points: [
      "Payments：发送方输入收款人、token 和金额，然后签署钱包转账。",
      "QR Payments：请求方输入收款人、token、金额、标签、备注和发票日期，然后将请求 URL 作为 QR 码分享。",
      "直接付款不会在本地账本中创建 QR 请求记录。"
    ]
  },
  {
    title: "网络和资产",
    body: [
      "应用固定在 Arc Testnet。Native gas 显示为 18 位小数的 USDC，受支持的 ERC-20 付款金额使用 6 位小数。",
      "RPC 访问通过小型 failover 列表处理。界面展示当前 endpoint、最新区块、安全 gas 价格、chain id 和 token decimal 检查，便于用户签名前判断网络路径是否正常。"
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
    title: "QR 请求 payload",
    body: [
      "QR 码包含 /pay URL，并在 r 查询参数中放入 base64url JSON payload。payload 只是可携带的请求描述；它不会包含私钥、钱包授权、token 余额或已签名交易。",
      "请求记录 token、金额、收款人、标签、创建时间和起始区块。起始区块将验证范围限制在请求创建之后发生的转账。"
    ],
    points: [
      "必填字段：version、id、recipient、token、amount、label、createdAt 和 startBlock。",
      "可选字段：note、invoiceDate、expiresAt 和 dueAt。",
      `默认过期时间：创建后 ${PAYMENT_VALIDITY_MINUTES} 分钟。过期前已开始的付款尝试仍可验证。`
    ],
    code: "/pay?r=<base64url({ version, id, recipient, token, amount, label, note?, invoiceDate?, expiresAt?, dueAt?, createdAt, startBlock })>"
  },
  {
    title: "钱包执行",
    body: [
      "付款是由已连接钱包签署的标准 ERC-20 transfer 调用。应用使用 viem 估算 gas，应用 Arc 的 gas-price floor，提交后立即保存钱包交易哈希，然后等待确认。",
      "钱包仍然是签名的最终授权方。Disburse 准备 calldata 并展示检查结果，但最终 approval 发生在钱包内。"
    ],
    points: [
      "Connect: eth_requestAccounts.",
      "Network: wallet_switchEthereumChain，并使用 wallet_addEthereumChain 作为 Arc Testnet fallback。",
      "Transfer: 在所选 USDC 或 EURC 合约上使用 ERC-20 transfer(recipient, parsedAmount) calldata 调用 eth_sendTransaction。",
      "Gas: 估算用于展示和余额检查；钱包在签名时最终确定交易 gas。"
    ]
  },
  {
    title: "本地账本和 realtime",
    body: [
      "QR 请求和收据存储在浏览器 localStorage 中，请求方无需创建账户即可管理工作。账本支持 JSON 导出和导入，用于备份或迁移。",
      "配置 Supabase 后，QR 请求也可以通过 Vercel API 函数写入。Realtime 事件可在付款人提交、确认、失败或请求过期时关闭请求方视图中的 QR 码。"
    ],
    points: [
      "Storage keys: disburse.requests 和 disburse.receipts。",
      "仍会读取旧 key: arc-pay-desk.requests 和 arc-pay-desk.receipts。",
      "请求按 request id 存储。收据按 request id 或 transaction hash upsert。",
      "导入的 explorer URL 会从已验证的 Arcscan transaction hash 重新生成。"
    ]
  },
  {
    title: "发票输出",
    body: [
      "付款人确认且转账从 Arc Testnet 数据验证后，付款页面可以生成本地 PDF 发票。",
      "发票在浏览器中生成。本版本不会由应用上传，也不会由服务器通过邮件发送。"
    ],
    points: [
      "发票包含 tx hash、区块、金额、标签、备注、发票日期、付款人、收款人、确认时间和 Arcscan 链接。",
      "发票日期是展示元数据，不是付款过期时间。",
      "本版本没有服务器存储或发送发票文件。"
    ]
  },
  {
    title: "验证",
    body: [
      "验证会先检查已知交易哈希。如果没有哈希，它会从请求起始区块到最新区块按 10,000 区块窗口扫描 ERC-20 Transfer logs，并比较收款人和精确 token 金额。",
      "只有 token 合约、收款人和金额全部匹配时，请求才会标记为已支付。发送到正确收款人但金额不同的转账会单独显示，供用户复核。"
    ],
    points: [
      "已支付：向收款人转入请求的精确 token 金额。",
      "可能匹配：存在转给收款人的转账，但金额不同。",
      "未完成：从请求起始区块起未找到匹配转账。"
    ],
    code: "match = log.address == token && log.args.to == recipient && log.args.value == parseUnits(amount, token.decimals)"
  }
];

const docsSummaryItemsId: DocsSummaryItem[] = [
  {
    label: "Jaringan",
    value: `Arc Testnet ${ARC_CHAIN_ID}`
  },
  {
    label: "Aset",
    value: "USDC dan EURC"
  },
  {
    label: "Kustodi",
    value: "Ditandatangani wallet, non-kustodial"
  },
  {
    label: "Receipt",
    value: "Diverifikasi dari log Arc Testnet"
  }
];

const docsSummaryItemsDe: DocsSummaryItem[] = [
  {
    label: "Netzwerk",
    value: `Arc Testnet ${ARC_CHAIN_ID}`
  },
  {
    label: "Assets",
    value: "USDC und EURC"
  },
  {
    label: "Verwahrung",
    value: "Wallet-signiert, nicht-kustodial"
  },
  {
    label: "Belege",
    value: "Aus Arc-Testnet-Logs verifiziert"
  }
];

const docsSummaryItemsHi: DocsSummaryItem[] = [
  {
    label: "नेटवर्क",
    value: `Arc Testnet ${ARC_CHAIN_ID}`
  },
  {
    label: "एसेट",
    value: "USDC और EURC"
  },
  {
    label: "कस्टडी",
    value: "वॉलेट-signed, non-custodial"
  },
  {
    label: "रसीदें",
    value: "Arc Testnet logs से verified"
  }
];

const docsSummaryItemsZh: DocsSummaryItem[] = [
  {
    label: "网络",
    value: `Arc Testnet ${ARC_CHAIN_ID}`
  },
  {
    label: "资产",
    value: "USDC 和 EURC"
  },
  {
    label: "托管",
    value: "钱包签名，非托管"
  },
  {
    label: "收据",
    value: "从 Arc Testnet logs 验证"
  }
];

function getDocsSections(lang: LanguageCode): DocsSection[] {
  if (lang === "de") return docsSectionsDe;
  if (lang === "id") return docsSectionsId;
  if (lang === "hi") return docsSectionsHi;
  if (lang === "zh") return docsSectionsZh;
  return docsSections;
}

function getDocsSummaryItems(lang: LanguageCode): DocsSummaryItem[] {
  if (lang === "de") return docsSummaryItemsDe;
  if (lang === "id") return docsSummaryItemsId;
  if (lang === "hi") return docsSummaryItemsHi;
  if (lang === "zh") return docsSummaryItemsZh;
  return docsSummaryItems;
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY);
  const nextTheme = stored === "light" || stored === "dark" ? stored : "dark";
  document.documentElement.dataset.theme = nextTheme;
  return nextTheme;
}

function getInitialPage(): Page {
  const hostname = window.location.hostname;
  const p = window.location.pathname;

  // Dedicated docs subdomain: render the standalone docs layout.
  if (isDocsHostname(hostname)) {
    return "docs";
  }

  const isApp = hostname.startsWith("app.") || isLocalAppPreview(hostname, p);

  if (isApp) {
    if (p === "/payments") return "payments";
    if (p === "/qr-payments") return "qr-payments";
    if (p === "/pay") return "pay";
    if (p === "/import-export") return "import-export";
    if (p === "/milestones") return "milestones";
    if (p === "/statements") return "statements";
    // /docs inside the app shell renders the docs page as a regular route
    // (sidebar navigation, header, the whole console chrome). The dedicated
    // docs subdomain is served by the branch above.
    if (p === LEGACY_DOCS_PATH) return "docs";
    // /settings was a dedicated page; it is now a dialog that opens from the header.
    // Keep the URL working by falling through to the dashboard. The dialog
    // auto-opens via an effect in the App component.
    return "dashboard";
  }

  // Naked localhost / other local preview: allow /docs to render docs in-shell.
  if (isLocalDocsPreview(hostname, p)) {
    return "docs";
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
  return (
    appPreview ||
    ["/payments", "/qr-payments", "/pay", "/import-export", "/settings", "/docs"].includes(pathname)
  );
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
  // Local dev and app subdomain both render the in-app docs at /docs.
  if (
    isLocalHostname(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("app.")
  ) {
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
  const hostname = window.location.hostname;
  // Already on the docs subdomain, a local preview, or inside the app shell:
  // /docs is a valid route, do not redirect.
  if (
    isDocsHostname() ||
    isLocalHostname(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("app.")
  ) {
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
      landing: "Disburse - Settlement-grade stablecoin payments",
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

  return (
    <>
      <RouteHero eyebrow={t("qrPayments")} title={t("qrHero")} />

      <section className="workbench" aria-labelledby="qr-heading">
        <header className="section-header">
          <h2 id="qr-heading">{t("generateQr")}</h2>
        </header>

        <div className="desk-grid">
          <section className="desk-pane create-pane" aria-labelledby="qr-form-heading">
            <PaneTitle id="qr-form-heading" label={t("requestDetails")} />
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
                <Field label={t("token")}>
                  <input value="USDC" readOnly aria-readonly="true" />
                </Field>
                <Field label={t("amount")}>
                  <input
                    value={form.amount}
                    onChange={(event) => onFormChange({ ...form, amount: event.target.value })}
                    inputMode="decimal"
                    placeholder="10"
                  />
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

              <button className="primary-button" type="submit" disabled={isCreating}>
                {isCreating ? t("generating") : t("generateQr")}
              </button>
            </form>

            {notice && <NoticeBar notice={notice} />}
          </section>

          <section className="desk-pane pay-pane" aria-labelledby="qr-output-heading">
            <PaneTitle id="qr-output-heading" label={t("qrOutput")} />
            {displayRequest && shareUrl ? (
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
                      <img src={qrDataUrl} alt={t("qrPaymentAlt")} />
                    ) : (
                      <div className="qr-placeholder">{t("generatingQr")}</div>
                    )}
                    <div>
                      <span>{t("payUrl")}</span>
                      <code>{shareUrl}</code>
                      <div className="qr-live-line" aria-live="polite">
                        <span className="qr-live-dot" aria-hidden="true" />
                        {formatQrLiveStatus(displayRequest)}
                      </div>
                      <button className="secondary-button" type="button" onClick={() => onCopy(shareUrl)}>
                        {t("copyLink")}
                      </button>
                    </div>
                  </div>
                )}

                {selectedReceipt && !qrIsFinal && (
                  <div className="receipt-line">
                    <div>
                      <span>{t("receipt")}</span>
                      <strong>{shortAddress(selectedReceipt.txHash, 10, 8)}</strong>
                    </div>
                    <a href={selectedReceipt.explorerUrl} target="_blank" rel="noreferrer">
                      {t("openTx")}
                    </a>
                  </div>
                )}
              </>
            ) : (
              <EmptyState title={t("noQrGenerated")} text={t("noQrGeneratedText")} />
            )}
          </section>
        </div>
      </section>

      <section id="qr-ledger" className="ledger-section">
        <header className="section-header inline-header">
          <div>
            <h2>{t("qrLedger")}</h2>
            <p>{t("qrRequestsStored", { count: requests.length })}</p>
          </div>
          <div className="tool-actions">
            <button className="secondary-button" type="button" onClick={onExport} disabled={!requests.length}>
              {t("export")}
            </button>
            <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()}>
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
                        {request.amount} {request.token} {t("to")} {shortAddress(request.recipient)}
                      </span>
                    </div>
                  </button>
                  <div className="ledger-meta">
                    <span>{isCrossChainPaymentRequest(request) ? t("settlesOnArc") : t("walletQr")}</span>
                    <span>{formatInvoiceDate(request.invoiceDate)}</span>
                    <span>{formatTimeLeft(request, now)}</span>
                  </div>
                  <div className="ledger-actions">
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

  return (
    <>
      <RouteHero eyebrow={t("payQrRequest")} title={t("payHero")} />

      <section className="workbench pay-request-shell" aria-labelledby="pay-request-heading">
        <header className="section-header">
          <h2 id="pay-request-heading">{t("paymentRequestTitle")}</h2>
          <p>{t("paymentRequestNote")}</p>
        </header>

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
              <div className="expiry-grid">
                <Metric label={t("timeLeft")} value={formatTimeLeft(request, now)} />
                <Metric label={t("validUntil")} value={formatDateTime(request.expiresAt ?? request.dueAt)} />
              </div>
            </section>

            <section className="desk-pane pay-pane" aria-labelledby="pay-actions-heading">
              <PaneTitle id="pay-actions-heading" label={t("payWithWallet")} />
              {walletNotice && <NoticeBar notice={walletNotice} compact />}
              {!account && !hasWalletProvider && (
                <NoticeBar
                  compact
                  notice={{
                    tone: "info",
                    text: t("noWalletRequest")
                  }}
                />
              )}
              {isExpired && !isPayable && (
                <NoticeBar
                  compact
                  notice={{ tone: "error", text: t("qrExpiredNotice") }}
                />
              )}
              {hasSubmittedTransaction && (
                <NoticeBar
                  compact
                  notice={{
                    tone: "info",
                    text: t("txSavedNotice")
                  }}
                />
              )}
              {isCrossChainPaymentRequest(request) && (
                <Field label={t("payFrom")}>
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

              {lifecycle !== "idle" && (
                <div className="estimate-line">
                  <Metric label={t("payerStage")} value={formatPayLifecycle(lifecycle, t)} />
                </div>
              )}

              <div className="action-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onEstimate}
                  disabled={!account || wrongChain || !isPayable || isEstimating}
                >
                  {isEstimating ? t("estimating") : t("estimate")}
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
                  {isVerifying ? t("verifying") : t("verify")}
                </button>
              </div>

              {estimate && <EstimateGrid estimate={estimate} />}
              {notice && <NoticeBar notice={notice} />}

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
                  <div className="receipt-line">
                    <div>
                      <span>{t("receipt")}</span>
                      <strong>{shortAddress(receipt.txHash, 10, 8)}</strong>
                    </div>
                    <div className="receipt-actions">
                      <button className="text-button" type="button" onClick={() => onCopy(receipt.explorerUrl)}>
                        {t("copyTx")}
                      </button>
                      <button className="text-button" type="button" onClick={onInvoice} disabled={isGeneratingInvoice}>
                        {isGeneratingInvoice ? t("preparingPdf") : t("downloadInvoice")}
                      </button>
                      <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                        {t("openTx")}
                      </a>
                    </div>
                  </div>

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
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                          </svg>
                          {t("createAttestation")}
                        </button>
                      )}
                      {attestation && (
                        <button className="compliance-button attested" type="button" disabled>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          {t("attested")}
                        </button>
                      )}
                      {onSettlementProof && (
                        <button className="compliance-button" type="button" onClick={onSettlementProof}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                          </svg>
                          {t("settlementProof")}
                        </button>
                      )}
                      {onUBLExport && (
                        <button className="compliance-button" type="button" onClick={onUBLExport}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>
                          </svg>
                          {t("ublInvoiceXml")}
                        </button>
                      )}
                    </div>
                  </div>
                </>
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

function DocsPage() {
  const { lang, t } = useI18n();
  const sections = useMemo(() => getDocsSections(lang), [lang]);
  const summaryItems = useMemo(() => getDocsSummaryItems(lang), [lang]);
  const initialDocSlug = slugify(sections[0]?.title ?? "");
  const [activeSlug, setActiveSlug] = useState<string>(initialDocSlug);

  useEffect(() => {
    setActiveSlug(initialDocSlug);
  }, [initialDocSlug]);

  // Scrollspy. highlights the TOC entry for the section nearest the top.
  useEffect(() => {
    const slugs = sections.map((s) => slugify(s.title));
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
  }, [sections]);

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
          {t("documentation")}
        </p>
        <h1 className="max-w-[24ch] text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-[var(--ink)]">
          {t("docsHeroTitle")}
        </h1>
        <p className="mt-5 max-w-[66ch] text-[15px] leading-relaxed text-[var(--muted)]">
          {t("docsHeroText")}
        </p>

        <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--line-soft)] pt-6 sm:grid-cols-4">
          {summaryItems.map((item) => (
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
            {t("onThisPage")}
          </p>
          <nav className="flex flex-col gap-0.5">
            {sections.map((section) => {
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
          {sections.map((section, index) => (
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
  const onboardingSteps: { label: string; done: boolean; href: string }[] = [
    { label: t("connectWalletStep"), done: Boolean(account), href: "/" },
    { label: t("fundFaucetStep"), done: Boolean(account), href: ARC_FAUCET_URL },
    { label: t("createFirstQrStep"), done: hasActivity, href: "/qr-payments" },
    { label: t("verifyExportStep"), done: receipts.length > 0, href: "/qr-payments" }
  ];
  const completedSteps = onboardingSteps.filter((s) => s.done).length;
  const progressPct = Math.round((completedSteps / onboardingSteps.length) * 100);

  return (
    <div className="relative z-10 mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-4 pb-12 xl:grid-cols-12">
      {/* Main column */}
      <div className="space-y-4 xl:col-span-8">
        <BalanceCard
          totalVolume={totalVolume}
          verifiedVolume={verifiedVolume}
          pendingVolume={pendingVolume}
          requestCount={requests.length}
          receiptCount={receipts.length}
          account={account}
          onNavigate={onNavigate}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

      {/* Right rail */}
      <aside className="space-y-4 xl:col-span-4">
        <QuickActionsCard
          onNavigate={onNavigate}
          onExport={onExport}
          faucetUrl={ARC_FAUCET_URL}
          hasData={requests.length + receipts.length > 0}
        />

        <GettingStartedCard
          steps={onboardingSteps}
          completed={completedSteps}
          total={onboardingSteps.length}
          progressPct={progressPct}
        />

        <StatusDigestCard
          paidCount={paidCount}
          openCount={openCount}
          expiredCount={expiredCount}
          rpcHealthy={rpcHealth?.healthy}
        />

        <ResourcesCard />
      </aside>
    </div>
  );
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
      <section className="workbench" >
        <div className="ie-page">
          <div className="ie-card">
            <h3>{t("exportHistory")}</h3>
            <p>{t("exportHistoryText", { requests: requests.length, receipts: receipts.length })}</p>
            <button className="primary-button" type="button" onClick={onExport} disabled={!requests.length}>
              {t("exportJson")}
            </button>
          </div>
          <div className="ie-card">
            <h3>{t("importPaymentData")}</h3>
            <p>{t("importPaymentDataText")}</p>
            <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()}>
              {t("chooseFile")}
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
            <strong>{t("dataStaysLocal")}</strong>
            {t("dataStaysLocalText")}
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
      <section className="hero route-hero">
        <p className="eyebrow">Conditional Payments</p>
        <h1>Milestone Invoices</h1>
      </section>

      <section className="content-section">
        <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
            Multi-step payment chains where each step unlocks only when the previous payment is verified with a Portable Settlement Proof.
          </p>
          <button className="button button-primary" type="button" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ New Chain"}
          </button>
        </div>

        {notice && (
          <div className={`notice ${notice.tone === "success" ? "notice-success" : "notice-error"}`} style={{ marginBottom: "1rem" }}>
            {notice.text}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleCreate} className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <input className="input" placeholder="Project title (e.g. Website Redesign)" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} required />
              <input className="input" placeholder="Recipient address (0x...)" value={formRecipient} onChange={(e) => setFormRecipient(e.target.value)} required />
              <input className="input" placeholder="Counterparty / payer address (optional)" value={formCounterparty} onChange={(e) => setFormCounterparty(e.target.value)} />

              <div style={{ marginTop: "0.5rem" }}>
                <label style={{ fontWeight: 600, fontSize: "0.8125rem", color: "var(--muted)" }}>Steps</label>
                {formSteps.map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }}>
                    <span style={{ color: "var(--muted)", fontSize: "0.75rem", width: "1.5rem" }}>{i + 1}.</span>
                    <input className="input" style={{ flex: 2 }} placeholder="Step label" value={step.label} onChange={(e) => updateStep(i, "label", e.target.value)} required />
                    <input className="input" style={{ flex: 1 }} placeholder="Amount" type="number" step="0.01" value={step.amount} onChange={(e) => updateStep(i, "amount", e.target.value)} required />
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>USDC</span>
                    {formSteps.length > 1 && (
                      <button type="button" onClick={() => removeStep(i)} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer" }}>x</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={addStep} className="button button-ghost" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
                  + Add Step
                </button>
              </div>

              <button className="button button-primary" type="submit" disabled={creating} style={{ marginTop: "0.75rem" }}>
                {creating ? "Creating..." : "Create Milestone Chain"}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p style={{ color: "var(--muted)" }}>Loading...</p>
        ) : chains.length === 0 ? (
          <div className="empty-state">
            <p>No milestone chains yet. Create your first conditional payment flow.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {chains.map((chain) => (
              <div key={chain.id} className="card" style={{ padding: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>{chain.title}</h3>
                  <span className={`badge badge-${chain.status === "completed" ? "success" : chain.status === "cancelled" ? "error" : "info"}`}>
                    {chain.status}
                  </span>
                </div>
                <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: "0.25rem 0 0.75rem" }}>
                  {chain.totalAmount} USDC across {chain.steps?.length || 0} steps
                </p>
                <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                  {(chain.steps || []).map((step: MilestoneStepView, i: number) => (
                    <div key={i} style={{
                      flex: 1,
                      height: "6px",
                      borderRadius: "3px",
                      background: step.status === "completed" ? "var(--success)" :
                                  step.status === "unlocked" || step.status === "payment_pending" ? "var(--primary)" :
                                  "var(--border)"
                    }} title={`${step.label}: ${step.status}`} />
                  ))}
                </div>
                <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.25rem" }}>
                  {(chain.steps || []).map((step: MilestoneStepView, i: number) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem" }}>
                      <span style={{ width: "1.25rem", textAlign: "center", color: step.status === "completed" ? "var(--success)" : "var(--muted)" }}>
                        {step.status === "completed" ? "\u2713" : step.status === "locked" ? "\u{1F512}" : "\u25CB"}
                      </span>
                      <span style={{ flex: 1 }}>{step.label}</span>
                      <span style={{ color: "var(--muted)" }}>{step.amount} USDC</span>
                      <span className={`badge badge-${step.status === "completed" ? "success" : step.status === "locked" ? "muted" : "info"}`} style={{ fontSize: "0.6875rem" }}>
                        {step.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
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
      <section className="hero route-hero">
        <p className="eyebrow">Reconciliation</p>
        <h1>Settlement Statements</h1>
      </section>

      <section className="content-section">
        <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
          Generate a verified statement bundle — all settlement proofs between you and a counterparty over any time period.
          Export as JSON for accounting, audits, or tax reporting.
        </p>

        <form onSubmit={handleGenerate} className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <input className="input" placeholder="Recipient address (0x...)" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
              <input className="input" placeholder="Payer / counterparty (0x...)" value={payer} onChange={(e) => setPayer(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <input className="input" type="date" placeholder="From" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              <input className="input" type="date" placeholder="To" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <button className="button button-primary" type="submit" disabled={loading}>
              {loading ? "Generating..." : "Generate Statement"}
            </button>
          </div>
        </form>

        {error && <div className="notice notice-error" style={{ marginBottom: "1rem" }}>{error}</div>}

        {bundle && (
          <div className="card" style={{ padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Statement Summary</h3>
              <button className="button button-ghost" type="button" onClick={handleDownloadJson} style={{ fontSize: "0.75rem" }}>
                Download JSON
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <div style={{ fontSize: "0.6875rem", color: "var(--muted)", textTransform: "uppercase" }}>Total Amount</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{bundle.summary.totalAmount} {bundle.summary.token}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.6875rem", color: "var(--muted)", textTransform: "uppercase" }}>Proofs</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{bundle.summary.totalProofs}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.6875rem", color: "var(--muted)", textTransform: "uppercase" }}>Period</div>
                <div style={{ fontSize: "0.8125rem" }}>
                  {new Date(bundle.summary.period.from).toLocaleDateString()} — {new Date(bundle.summary.period.to).toLocaleDateString()}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "0.6875rem", color: "var(--muted)", textTransform: "uppercase" }}>Network</div>
                <div style={{ fontSize: "0.8125rem" }}>{bundle.summary.networkMode}</div>
              </div>
            </div>

            {bundle.proofs.length > 0 && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem" }}>Individual Proofs</div>
                <div style={{ display: "grid", gap: "0.5rem", maxHeight: "300px", overflowY: "auto" }}>
                  {bundle.proofs.map((psp: StatementPspView) => (
                    <div key={psp.uid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.75rem", background: "var(--surface)", borderRadius: "0.5rem", fontSize: "0.8125rem" }}>
                      <div>
                        <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{psp.uid}</span>
                        <span style={{ marginLeft: "0.75rem", color: "var(--muted)" }}>{psp.invoice?.label || "—"}</span>
                      </div>
                      <span style={{ fontWeight: 600 }}>{psp.invoice?.amount} {psp.invoice?.token}</span>
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
