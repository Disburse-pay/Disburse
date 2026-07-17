import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, LogOut, Menu, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useI18n } from "../lib/i18n";

type Props = {
  title: string;
  subtitle?: string;
  account?: string;
  chainId?: number;
  expectedChainId: number;
  expectedChainLabel: string;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect?: () => void;
  onSwitch: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenNav?: () => void;
  onOpenInbox?: () => void;
  inboxUnreadCount?: number;
  theme: "light" | "dark";
};

/**
 * Top bar for the console shell. Clean title hierarchy, environment shown
 * as plain text, single accent for primary actions.
 */
export default function Header({
  title,
  subtitle,
  account,
  chainId,
  expectedChainId,
  expectedChainLabel,
  isConnecting,
  onConnect,
  onDisconnect,
  onSwitch,
  onToggleTheme,
  onOpenSettings,
  onOpenNav,
  onOpenInbox,
  inboxUnreadCount = 0,
  theme,
}: Props) {
  const { t } = useI18n();
  const wrongChain = account && chainId !== undefined && chainId !== expectedChainId;
  const shortAddr = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : null;
  const displayTitle = translateHeaderTitle(title, t);
  const displaySubtitle = subtitle ? translateHeaderSubtitle(subtitle, t) : undefined;

  return (
    <header className="sticky top-0 z-20 flex h-[64px] items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--paper-translucent)] px-4 backdrop-blur-md sm:gap-6 sm:px-6">
      {/* Title cluster */}
      <div className="flex min-w-0 items-center gap-3">
        {onOpenNav && (
          <button
            type="button"
            onClick={onOpenNav}
            aria-label="Open navigation"
            className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--paper-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] md:hidden"
          >
            <Menu size={18} strokeWidth={1.75} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold leading-tight tracking-[-0.012em] text-[var(--ink)]">
            {displayTitle}
          </h1>
          {displaySubtitle && (
            <p className="mt-0.5 truncate text-sm leading-tight text-[var(--muted)]">
              {displaySubtitle}
            </p>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Environment indicator — quiet plain-text. */}
        <div
          className="hidden items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--paper-2)] px-3 py-1.5 md:inline-flex"
          title={`${expectedChainLabel} · chainId ${expectedChainId}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ink-soft)]" aria-hidden="true" />
          <span className="text-sm font-medium text-[var(--ink)]">
            {expectedChainLabel}
          </span>
          <span className="text-xs text-[var(--muted)]">{t("testnet")}</span>
        </div>

        {onOpenInbox && (
          <div className="relative">
            <IconButton onClick={onOpenInbox} ariaLabel={t("inbox")}>
              <Bell size={16} strokeWidth={1.75} />
            </IconButton>
            {inboxUnreadCount > 0 && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary-bg)] px-1 text-[10px] font-semibold leading-none text-[color:var(--primary-text)]"
              >
                {inboxUnreadCount > 9 ? "9+" : inboxUnreadCount}
              </span>
            )}
          </div>
        )}

        <IconButton onClick={onOpenSettings} ariaLabel={t("openSettings")}>
          <SettingsIcon size={16} strokeWidth={1.75} />
        </IconButton>

        <IconButton
          onClick={onToggleTheme}
          ariaLabel={theme === "dark" ? t("switchToLight") : t("switchToDark")}
        >
          <AnimatePresence mode="wait" initial={false}>
            {theme === "dark" ? (
              <motion.span
                key="moon"
                className="inline-flex"
                initial={{ opacity: 0, rotate: -30 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 30 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <Moon size={16} strokeWidth={1.75} />
              </motion.span>
            ) : (
              <motion.span
                key="sun"
                className="inline-flex"
                initial={{ opacity: 0, rotate: 30 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: -30 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <Sun size={16} strokeWidth={1.75} />
              </motion.span>
            )}
          </AnimatePresence>
        </IconButton>

        {/* Wallet state */}
        {!account ? (
          <button
            type="button"
            onClick={onConnect}
            disabled={isConnecting}
            className="rounded-md bg-[var(--primary-bg)] px-3.5 py-1.5 text-base font-medium text-[color:var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] disabled:opacity-60 shadow-sm"
          >
            {isConnecting ? t("connecting") : t("connectWallet")}
          </button>
        ) : wrongChain ? (
          <button
            type="button"
            onClick={onSwitch}
            disabled={isConnecting}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <AlertTriangle size={13} strokeWidth={1.75} />
            {t("switchToNetwork", { network: expectedChainLabel })}
          </button>
        ) : (
          <ConnectedWalletPill shortAddr={shortAddr ?? ""} onDisconnect={onDisconnect} />
        )}
      </div>
    </header>
  );
}

function translateHeaderTitle(title: string, t: (key: string, params?: Record<string, string | number>) => string) {
  const keyByTitle: Record<string, string> = {
    Overview: "overview",
    "Direct send": "directSend",
    "QR requests": "qrPayments",
    "Pay request": "routePayTitle",
    "Import · Export": "routeBackupTitle",
    Documentation: "documentation",
  };
  return keyByTitle[title] ? t(keyByTitle[title]) : title;
}

function translateHeaderSubtitle(subtitle: string, t: (key: string, params?: Record<string, string | number>) => string) {
  const keyBySubtitle: Record<string, string> = {
    "Requests, receipts and network health at a glance.": "routeOverviewSubtitle",
    "Pay a wallet address directly on Arc Testnet.": "routePaymentsSubtitle",
    "Create a QR invoice for someone else to scan and pay.": "routeQrSubtitle",
    "Review and settle a QR payment request.": "routePaySubtitle",
    "Back up or restore your requests and receipts.": "routeBackupSubtitle",
    "How Disburse settles, verifies, and exports payments.": "routeDocsSubtitle",
  };
  return keyBySubtitle[subtitle] ? t(keyBySubtitle[subtitle]) : subtitle;
}

function ConnectedWalletPill({
  shortAddr,
  onDisconnect,
}: {
  shortAddr: string;
  onDisconnect?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: globalThis.MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--paper-2)]"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--green-text)]" aria-hidden="true" />
        <span className="font-mono text-sm leading-none text-[var(--ink)]">
          {shortAddr}
        </span>
      </button>
      {open && onDisconnect && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-[170px] overflow-hidden rounded-md border border-[var(--line)] bg-[var(--paper)] shadow-md">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-[var(--ink)] transition-colors hover:bg-[var(--paper-2)]"
          >
            <LogOut size={13} strokeWidth={1.75} />
            {t("disconnect")}
          </button>
        </div>
      )}
    </div>
  );
}

function IconButton({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    // Fixed 32px square + flex centering: without this, an icon wrapped in an
    // inline span (the animated theme icon) rides the text baseline and
    // inflates its button to 40px while the ones next to it sit at 32px.
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--paper-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
    >
      {children}
    </button>
  );
}
