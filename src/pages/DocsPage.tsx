import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { cx, slugify } from "../lib/cx";
import { getDocsCategories, getDocsSummaryItems } from "../content/docs";
import type { DocsCategory, DocsPage } from "../content/docs";

/**
 * Gitbook-style docs.
 *
 * Layout:
 *   ┌─ sidebar (categories + pages) ─┬─ content (single page) ─┬─ on-this-page ─┐
 *
 * URL hash: `#<category-slug>/<page-slug>` (e.g. `#bet/lending`). Falls back
 * to the first page of the first category when no hash is set.
 */
type Location = { categorySlug: string; pageSlug: string };

function parseHash(hash: string, categories: DocsCategory[]): Location {
  const cleaned = hash.replace(/^#/, "");
  const [cat, page] = cleaned.split("/");
  const found = categories.find((c) => c.slug === cat);
  if (found) {
    const p = found.pages.find((pg) => pg.slug === page) ?? found.pages[0];
    if (p) return { categorySlug: found.slug, pageSlug: p.slug };
  }
  const first = categories[0];
  return { categorySlug: first.slug, pageSlug: first.pages[0]?.slug ?? "" };
}

function flattenPages(categories: DocsCategory[]): Array<{ category: DocsCategory; page: DocsPage }> {
  return categories.flatMap((c) => c.pages.map((page) => ({ category: c, page })));
}

export default function DocsPage() {
  const { lang, t } = useI18n();
  const categories = useMemo(() => getDocsCategories(lang), [lang]);
  const summaryItems = useMemo(() => getDocsSummaryItems(lang), [lang]);
  const flat = useMemo(() => flattenPages(categories), [categories]);

  const [location, setLocation] = useState<Location>(() =>
    parseHash(typeof window !== "undefined" ? window.location.hash : "", categories),
  );

  // Re-resolve on hash changes (back/forward, manual edits).
  useEffect(() => {
    const onHashChange = () => setLocation(parseHash(window.location.hash, categories));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [categories]);

  const currentIndex = flat.findIndex(
    (e) => e.category.slug === location.categorySlug && e.page.slug === location.pageSlug,
  );
  const current = flat[currentIndex];
  const prev = currentIndex > 0 ? flat[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < flat.length - 1 ? flat[currentIndex + 1] : null;

  const navigateTo = useCallback((categorySlug: string, pageSlug: string) => {
    const target = `#${categorySlug}/${pageSlug}`;
    if (window.location.hash !== target) {
      window.history.pushState(null, "", target);
    }
    setLocation({ categorySlug, pageSlug });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Section anchors on the current page (for the right-side TOC).
  const sectionAnchors = useMemo(
    () => current?.page.sections.map((s) => ({ slug: slugify(s.title), title: s.title })) ?? [],
    [current],
  );

  const [activeSection, setActiveSection] = useState<string>(sectionAnchors[0]?.slug ?? "");

  useEffect(() => {
    setActiveSection(sectionAnchors[0]?.slug ?? "");
  }, [sectionAnchors]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: [0, 1] },
    );
    for (const a of sectionAnchors) {
      const el = document.getElementById(a.slug);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sectionAnchors, location]);

  function scrollToAnchor(slug: string) {
    const el = document.getElementById(slug);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSection(slug);
    }
  }

  if (!current) {
    return (
      <div className="mx-auto max-w-[1280px] px-6 py-12 text-[var(--muted)]">
        No documentation available.
      </div>
    );
  }

  const isOverview = location.categorySlug === categories[0].slug && currentIndex === 0;

  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-16">
      <div className="docs-gitbook grid grid-cols-1 gap-8 lg:grid-cols-[220px_minmax(0,1fr)_200px] lg:gap-12">
        {/* Sidebar */}
        <aside className="docs-sidebar lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <p className="mb-3 text-[12.5px] font-semibold tracking-[-0.005em] text-[var(--ink)]">
            {t("documentation")}
          </p>
          {categories.map((category) => (
            <div key={category.slug} className="docs-sidebar-section">
              <p className="docs-sidebar-section-title">{category.title}</p>
              <nav className="flex flex-col">
                {category.pages.map((p) => {
                  const active = category.slug === location.categorySlug && p.slug === location.pageSlug;
                  return (
                    <a
                      key={p.slug}
                      href={`#${category.slug}/${p.slug}`}
                      onClick={(e) => {
                        e.preventDefault();
                        navigateTo(category.slug, p.slug);
                      }}
                      className={cx(
                        "docs-sidebar-link",
                        active && "docs-sidebar-link-active",
                      )}
                    >
                      <span aria-hidden="true" className="docs-sidebar-link-bar" />
                      {p.title}
                    </a>
                  );
                })}
              </nav>
            </div>
          ))}
        </aside>

        {/* Content */}
        <main className="min-w-0">
          {isOverview && (
            <section className="border-b border-[var(--line)] pb-10">
              <p className="mb-3 text-[12px] font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("documentation")}
              </p>
              <h1 className="max-w-[26ch] text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-[var(--ink)]">
                {t("docsHeroTitle")}
              </h1>
              <p className="mt-5 max-w-[66ch] text-[15px] leading-relaxed text-[var(--muted)]">
                {t("docsHeroText")}
              </p>
              <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--line-soft)] pt-6 sm:grid-cols-4">
                {summaryItems.map((item) => (
                  <div key={item.label} className="min-w-0">
                    <dt className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                      {item.label}
                    </dt>
                    <dd className="truncate text-[13px] font-medium text-[var(--ink)]">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <article className={isOverview ? "pt-10" : "pt-2"}>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
              {current.category.title}
            </p>
            <h2 className="mb-3 text-[clamp(1.5rem,2.5vw,2rem)] font-semibold tracking-tight text-[var(--ink)]">
              {current.page.title}
            </h2>

            {current.page.sections.map((section) => {
              const slug = slugify(section.title);
              return (
                <section
                  key={slug}
                  id={slug}
                  className="scroll-mt-6 border-b border-[var(--line-soft)] py-8 last:border-b-0"
                >
                  <h3 className="mb-4 text-[18px] font-semibold tracking-[-0.012em] text-[var(--ink)]">
                    {section.title}
                  </h3>
                  <div className="space-y-3 text-[15px] leading-[1.72] text-[var(--ink-soft)]">
                    {section.body.map((paragraph, i) => (
                      <p key={i} className="max-w-[72ch]">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  {section.points && (
                    <ul className="mt-5 max-w-[72ch] space-y-2">
                      {section.points.map((point, i) => (
                        <li
                          key={i}
                          className="relative pl-5 text-[14px] leading-[1.65] text-[var(--ink-soft)] before:absolute before:left-0 before:top-[0.65em] before:h-1.5 before:w-1.5 before:rounded-full before:border before:border-[var(--ink)]"
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
                </section>
              );
            })}

            {/* Prev / next */}
            <nav className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {prev ? (
                <a
                  href={`#${prev.category.slug}/${prev.page.slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigateTo(prev.category.slug, prev.page.slug);
                  }}
                  className="docs-page-nav-link group flex items-center gap-3 rounded-md border border-[var(--line)] p-4 transition-colors hover:border-[var(--ink-soft)]"
                >
                  <ChevronLeft className="h-4 w-4 shrink-0 text-[var(--muted)] transition-transform group-hover:-translate-x-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10.5px] font-medium uppercase tracking-wider text-[var(--muted)]">
                      Previous · {prev.category.title}
                    </p>
                    <p className="mt-0.5 truncate text-[13.5px] font-medium text-[var(--ink)]">
                      {prev.page.title}
                    </p>
                  </div>
                </a>
              ) : (
                <span />
              )}
              {next ? (
                <a
                  href={`#${next.category.slug}/${next.page.slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigateTo(next.category.slug, next.page.slug);
                  }}
                  className="docs-page-nav-link group flex items-center gap-3 rounded-md border border-[var(--line)] p-4 text-right transition-colors hover:border-[var(--ink-soft)] sm:justify-end"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[10.5px] font-medium uppercase tracking-wider text-[var(--muted)]">
                      Next · {next.category.title}
                    </p>
                    <p className="mt-0.5 truncate text-[13.5px] font-medium text-[var(--ink)]">
                      {next.page.title}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5" />
                </a>
              ) : (
                <span />
              )}
            </nav>
          </article>
        </main>

        {/* On this page */}
        {sectionAnchors.length > 1 && (
          <aside className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
            <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {t("onThisPage")}
            </p>
            <nav className="flex flex-col gap-1">
              {sectionAnchors.map((a) => {
                const active = a.slug === activeSection;
                return (
                  <a
                    key={a.slug}
                    href={`#${a.slug}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToAnchor(a.slug);
                    }}
                    className={cx(
                      "relative py-1 pl-3 text-[12.5px] leading-[1.45] transition-colors",
                      active ? "font-medium text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cx(
                        "absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-r-full transition-colors",
                        active ? "bg-[var(--ink)]" : "bg-transparent",
                      )}
                    />
                    {a.title}
                  </a>
                );
              })}
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}
