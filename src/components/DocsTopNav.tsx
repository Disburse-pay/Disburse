import { useI18n } from "../lib/i18n";
import type { Theme } from "../lib/theme";

/**
 * Top bar for the standalone docs subdomain (docs.disburse.online). Rendered by
 * DocsApp, which mounts OUTSIDE the wallet provider, so the docs site never
 * loads the wallet SDK.
 */
export default function DocsTopNav({
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
      {/* Full-width bar — the sidebar below is anchored to the viewport edge,
          so the bar spans edge to edge too instead of floating in a column. */}
      <div className="flex h-14 items-center justify-between px-5 md:px-6">
        <a href={homeHref} className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
          <img src="/favicon.png" alt="" className="h-5 w-5" aria-hidden="true" />
          <span className="text-base font-semibold tracking-tight text-[var(--ink)]">Disburse</span>
          <span className="ml-1 rounded-md border border-[var(--line)] bg-[var(--paper-2)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
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
            // The global unlayered `a { color: inherit }` reset beats Tailwind's
            // layered color utilities, so an inline color is needed for the
            // label + arrow to stay visible on the primary button (both themes).
            style={{ color: "var(--primary-text)" }}
            className="group inline-flex items-center gap-1.5 rounded-md bg-[var(--primary-bg)] px-3.5 py-1.5 text-base font-medium shadow-sm transition-colors hover:bg-[var(--primary-bg-hover)]"
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
