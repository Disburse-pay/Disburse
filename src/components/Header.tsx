import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, LogOut, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
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
  theme: "light" | "dark";
};

/**
 * Top bar for the console shell.
 *
 * Calm, institutional. Page title + subtitle on the left, an environment
 * pill that gives constant context about where you are, and a tidy
 * cluster of wallet/settings controls on the right. No animated orbs,
 * no decorative gradients.
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
  theme,
}: Props) {
  const { t } = useI18n();
  const wrongChain = account && chainId !== undefined && chainId !== expectedChainId;
  const shortAddr = account ? `${account.slice(0, 6)}\u2009\u2009${account.slice(-4)}` : null;
  const displayTitle = translateHeaderTitle(title, t);
  const displaySubtitle = subtitle ? translateHeaderSubtitle(subtitle, t) : undefined;

  return (
    <header className="sticky top-0 z-20 flex h-[56px] items-center justify-between gap-6 border-b border-[var(--line)] bg-[var(--paper-translucent)] px-6 backdrop-blur-md">
      {/* Title cluster */}
      <div className="min-w-0">
        <h1 className="truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] text-[var(--ink)]">
          {displayTitle}
        </h1>
        {displaySubtitle && (
          <p className="mt-0.5 truncate text-[11.5px] leading-tight text-[var(--muted)]">
            {displaySubtitle}
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1.5">
        {/* Environment pill — constant context about which network we're on. */}
        <div
          className="hidden items-center gap-2 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--input-bg)] px-2.5 py-1 md:inline-flex"
          title={`${expectedChainLabel} \u00b7 chainId ${expectedChainId}`}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">
            Env
          </span>
          <span className="h-3 w-px bg-[var(--line)]" aria-hidden="true" />
          <span className="font-mono text-[10.5px] text-[var(--ink)]">
            {expectedChainLabel}
          </span>
          <span className="rounded-sm border border-[var(--line)] bg-[var(--paper)] px-1 py-[1px] font-mono text-[8.5px] uppercase leading-none tracking-[0.16em] text-[var(--muted)]">
            Testnet
          </span>
        </div>

        <span className="mx-1 hidden h-4 w-px bg-[var(--line)] md:inline-block" aria-hidden="true" />

        <IconButton onClick={onOpenSettings} ariaLabel={t("openSettings")}>
          <SettingsIcon size={15} strokeWidth={1.6} />
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
                <Moon size={15} strokeWidth={1.6} />
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
                <Sun size={15} strokeWidth={1.6} />
              </motion.span>
            )}
          </AnimatePresence>
        </IconButton>

        <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />

        {/* Wallet state */}
        {!account ? (
          <button
            type="button"
            onClick={onConnect}
            disabled={isConnecting}
            className="rounded-[var(--btn-radius)] bg-[var(--primary-bg)] px-3 py-1.5 text-[12px] font-semibold text-[var(--primary-text)] transition-colors hover:bg-[var(--primary-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] disabled:opacity-60"
          >
            {isConnecting ? t("connecting") : t("connectWallet")}
          </button>
        ) : wrongChain ? (
          <button
            type="button"
            onClick={onSwitch}
            disabled={isConnecting}
            className="inline-flex items-center gap-1.5 rounded-[var(--btn-radius)] border border-[var(--yellow-text)]/30 bg-[var(--yellow-bg)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--yellow-text)] transition-colors hover:border-[var(--yellow-text)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--yellow-text)]"
          >
            <AlertTriangle size={12} strokeWidth={1.75} />
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
    "Import Â· Export": "routeBackupTitle",
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
        className="flex items-center gap-2 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--input-bg)] px-2.5 py-1.5 transition-colors hover:border-[var(--ink)]"
      >
        <span
          className="relative flex h-1.5 w-1.5 items-center justify-center"
          aria-hidden="true"
        >
          <span className="absolute h-full w-full animate-ping rounded-full bg-[var(--primary-bg)] opacity-40" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--primary-bg)]" />
        </span>
        <span className="font-mono text-[11px] leading-none text-[var(--ink)]">
          {shortAddr}
        </span>
      </button>
      {open && onDisconnect && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[160px] overflow-hidden rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--paper)] shadow-md">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--line-soft)]"
          >
            <LogOut size={12} strokeWidth={1.75} />
            Disconnect
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
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="rounded-[var(--btn-radius)] p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--line-soft)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
    >
      {children}
    </button>
  );
}
