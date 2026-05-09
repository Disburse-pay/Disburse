import { cn } from "../lib/utils";
import type { Page } from "./Sidebar";

type Props = {
  title: string;
  account?: string;
  chainId?: number;
  expectedChainId: number;
  expectedChainLabel: string;
  isConnecting: boolean;
  onConnect: () => void;
  onSwitch: () => void;
  onToggleTheme: () => void;
  theme: "light" | "dark";
};

export default function Header({
  title,
  account,
  chainId,
  expectedChainId,
  expectedChainLabel,
  isConnecting,
  onConnect,
  onSwitch,
  onToggleTheme,
  theme,
}: Props) {
  const wrongChain = account && chainId !== undefined && chainId !== expectedChainId;
  const shortAddr = account ? `${account.slice(0, 6)}...${account.slice(-4)}` : null;

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-brand-border bg-brand-dark/80 backdrop-blur-md sticky top-0 z-20">
      {/* Left: Title */}
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-semibold text-white tracking-wide">{title}</h1>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-3">
        {/* Theme toggle */}
        <button
          type="button"
          onClick={onToggleTheme}
          className="p-1.5 text-muted hover:text-white transition-colors"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {/* Wallet */}
        {!account ? (
          <button
            type="button"
            onClick={onConnect}
            disabled={isConnecting}
            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-white/15 text-white hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            {isConnecting ? "Connecting..." : "Connect"}
          </button>
        ) : wrongChain ? (
          <button
            type="button"
            onClick={onSwitch}
            disabled={isConnecting}
            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Switch to {expectedChainLabel}
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 border border-brand-border bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-mono text-white/70">{shortAddr}</span>
          </div>
        )}
      </div>
    </header>
  );
}
