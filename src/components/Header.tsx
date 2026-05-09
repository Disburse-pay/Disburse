import { Wallet, Sun, Moon } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface HeaderProps {
  title: string;
  account?: string;
  chainId?: number;
  expectedChainId: number;
  expectedChainLabel: string;
  isConnecting: boolean;
  onConnect: () => void;
  onSwitch: () => void;
  onToggleTheme: () => void;
  theme: string;
}

export default function Header({ title, account, chainId, expectedChainId, expectedChainLabel, isConnecting, onConnect, onSwitch, onToggleTheme, theme }: HeaderProps) {
  return (
    <header className="h-14 flex items-center justify-between px-6 bg-brand-dark border-b border-brand-border sticky top-0 z-40">
      <h2 className="text-sm font-medium tracking-tight text-white">{title}</h2>

      <div className="flex items-center gap-3">
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-md border border-brand-border hover:bg-brand-surface transition-colors"
        >
          {theme === "dark" ? (
            <Sun className="w-4 h-4 text-muted" />
          ) : (
            <Moon className="w-4 h-4 text-muted" />
          )}
        </button>

        <div className="flex items-center gap-3 pl-3 border-l border-brand-border">
          {!account ? (
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-brand-surface hover:bg-brand-border transition-colors border border-brand-border text-xs font-mono text-white"
              onClick={onConnect}
              disabled={isConnecting}
            >
              <Wallet className="w-4 h-4 text-muted" />
              <span>{isConnecting ? "Connecting..." : "Connect"}</span>
            </button>
          ) : chainId !== expectedChainId ? (
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-brand-surface hover:bg-brand-border transition-colors border border-brand-border text-xs font-mono text-amber-400"
              onClick={onSwitch}
              disabled={isConnecting}
            >
              <Wallet className="w-4 h-4 text-amber-400" />
              <span>Switch to {expectedChainLabel}</span>
            </button>
          ) : (
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-brand-surface border border-brand-border text-xs font-mono text-white">
              <Wallet className="w-4 h-4 text-muted" />
              <span>{account.slice(0, 6)}...{account.slice(-4)}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
