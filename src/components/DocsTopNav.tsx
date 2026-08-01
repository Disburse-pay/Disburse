import { ArrowUpRight, Moon, Sun } from "lucide-react";
import { getAppHref, getBridgeHref } from "../lib/routing";
import type { Theme } from "../lib/theme";

export default function DocsTopNav({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return (
    <header className="docs-topbar">
      <a href="https://disburse.online" className="docs-wordmark" aria-label="Disburse home">
        <img src="/favicon.png" alt="" aria-hidden="true" />
        <strong>Disburse</strong>
        <span>/</span>
        <span>Docs</span>
      </a>

      <nav className="docs-topbar-nav" aria-label="Documentation links">
        <a href={getBridgeHref()}>Bridge</a>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
        <a className="docs-console-link" href={getAppHref("/")}>
          Open console <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </nav>
    </header>
  );
}
