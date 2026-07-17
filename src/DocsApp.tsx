import { Suspense, lazy, useEffect, useState } from "react";
import { I18nProvider } from "./lib/i18n";
import { getInitialTheme, THEME_KEY, type Theme } from "./lib/theme";
import DocsTopNav from "./components/DocsTopNav";

const DocsPage = lazy(() => import("./pages/DocsPage"));

/**
 * Standalone shell for the docs subdomain (docs.disburse.online).
 *
 * Mounted directly from main.tsx — OUTSIDE the wallet provider — so the docs
 * site does not load the 1.8 MB Dynamic wallet SDK it never uses. Docs are
 * read-only, English content; they only need theme + i18n.
 */
export default function DocsApp() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0a0b0e" : "#f6f6f3");
  }, [theme]);

  const onToggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <I18nProvider initialLang="en">
      <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
        <DocsTopNav theme={theme} onToggleTheme={onToggleTheme} />
        {/* DocsPage owns the full-width frame: edge-anchored sidebar +
            article + on-this-page. No centering wrapper here. */}
        <Suspense fallback={<DocsFallback />}>
          <DocsPage />
        </Suspense>
      </div>
    </I18nProvider>
  );
}

function DocsFallback() {
  return (
    <div className="px-6 py-12 text-base text-[var(--muted)]">
      Loading documentation…
    </div>
  );
}
