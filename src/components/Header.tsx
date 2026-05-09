import { AnimatePresence, motion } from "motion/react";
import { Moon, Settings as SettingsIcon, Sun } from "lucide-react";

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
  const wrongChain = account && chainId !== undefined && chainId !== expectedChainId;
  const shortAddr = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : null;

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--line)] bg-[var(--paper-translucent)] px-6 backdrop-blur-md">
      {/* Left: title + subtitle */}
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-[var(--ink)]">
          {title}
        </h1>
        {subtitle && (
          <p className="truncate text-xs leading-tight text-[var(--muted)]">
            {subtitle}
          </p>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1.5">
        <IconButton onClick={onOpenSettings} ariaLabel="Open settings">
          <SettingsIcon size={16} strokeWidth={1.75} />
        </IconButton>

        <IconButton
          onClick={onToggleTheme}
          ariaLabel={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          <AnimatePresence mode="wait" initial={false}>
            {theme === "dark" ? (
              <motion.span
                key="moon"
                className="inline-flex"
                initial={{ opacity: 0, rotate: -40 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 40 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <Moon size={16} strokeWidth={1.75} />
              </motion.span>
            ) : (
              <motion.span
                key="sun"
                className="inline-flex"
                initial={{ opacity: 0, rotate: 40 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: -40 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <Sun size={16} strokeWidth={1.75} />
              </motion.span>
            )}
          </AnimatePresence>
        </IconButton>

        <span className="mx-1 h-5 w-px bg-[var(--line)]" aria-hidden="true" />

        {/* Wallet pill */}
        {!account ? (
          <button
            type="button"
            onClick={onConnect}
            disabled={isConnecting}
            className="rounded-full border border-[var(--line)] bg-[var(--input-bg)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--focus)] hover:bg-[var(--panel-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-60"
          >
            {isConnecting ? "Connecting…" : "Connect wallet"}
          </button>
        ) : wrongChain ? (
          <button
            type="button"
            onClick={onSwitch}
            disabled={isConnecting}
            className="rounded-full border border-[var(--red-text)]/40 bg-[var(--red-bg)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--red-text)] transition-colors hover:bg-[var(--red-text)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red-text)]"
          >
            Switch to {expectedChainLabel}
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--input-bg)] px-3 py-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
              aria-hidden="true"
            />
            <span className="font-mono text-[11px] text-[var(--ink)]">{shortAddr}</span>
          </div>
        )}
      </div>
    </header>
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
      className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--line-soft)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
    >
      {children}
    </button>
  );
}
