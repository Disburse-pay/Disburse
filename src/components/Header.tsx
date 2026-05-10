import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
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
  onSwitch: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  theme: "light" | "dark";
};

/**
 * Top bar for the console shell.
 *
 * Deliberately quiet. No glowing orbs or pill chromatics. Page title in
 * serif-weighted sans, optional subtitle in small muted text, a tidy
 * cluster of controls on the right.
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
    <header className="sticky top-0 z-20 flex h-[52px] items-center justify-between gap-6 border-b border-[var(--line)] bg-[var(--paper-translucent)] px-6 backdrop-blur-md">
      {/* Title cluster */}
      <div className="min-w-0">
        <h1 className="truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] text-[var(--ink)]">
          {displayTitle}
        </h1>
        {displaySubtitle && (
          <p className="truncate text-[11.5px] leading-tight text-[var(--muted)]">
            {displaySubtitle}
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
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

        <span className="mx-1.5 h-4 w-px bg-[var(--line)]" aria-hidden="true" />

        {/* Wallet state */}
        {!account ? (
          <button
            type="button"
            onClick={onConnect}
            disabled={isConnecting}
            className="rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--input-bg)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--paper-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-60"
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
          <div className="flex items-center gap-2 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--input-bg)] px-2.5 py-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full bg-[var(--primary-bg)]"
              aria-hidden="true"
            />
            <span className="font-mono text-[11px] leading-none text-[var(--ink)]">
              {shortAddr}
            </span>
          </div>
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
