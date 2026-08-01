import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Copy } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { cx, slugify } from "../lib/cx";
import { getDocsCategories, getDocsSummaryItems } from "../content/docs";
import type { DocsCategory, DocsPage } from "../content/docs";
import DocsSearch from "../components/DocsSearch";

type DocsLocation = { categorySlug: string; pageSlug: string };

function flattenPages(categories: DocsCategory[]): Array<{ category: DocsCategory; page: DocsPage }> {
  return categories.flatMap((category) => category.pages.map((page) => ({ category, page })));
}

function firstLocation(categories: DocsCategory[]): DocsLocation {
  return {
    categorySlug: categories[0]?.slug ?? "",
    pageSlug: categories[0]?.pages[0]?.slug ?? ""
  };
}

function parseLocation(pathname: string, hash: string, categories: DocsCategory[]): DocsLocation {
  const flat = flattenPages(categories);
  const legacy = hash.replace(/^#/, "").split("/");
  if (legacy.length === 2 && legacy[1]) {
    const legacyPage = flat.find(({ page }) => page.slug === legacy[1]);
    if (legacyPage) {
      return { categorySlug: legacyPage.category.slug, pageSlug: legacyPage.page.slug };
    }
  }

  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  if (segments.length === 0) return firstLocation(categories);
  const category = categories.find((entry) => entry.slug === segments[0]);
  if (category) {
    const page = category.pages.find((entry) => entry.slug === segments[1]) ?? category.pages[0];
    if (page) return { categorySlug: category.slug, pageSlug: page.slug };
  }

  const pageMatch = flat.find(({ page }) => page.slug === segments.at(-1));
  return pageMatch
    ? { categorySlug: pageMatch.category.slug, pageSlug: pageMatch.page.slug }
    : firstLocation(categories);
}

function pagePath(categorySlug: string, pageSlug: string, categories: DocsCategory[]): string {
  const first = firstLocation(categories);
  if (categorySlug === first.categorySlug && pageSlug === first.pageSlug) return "/";
  return `/${encodeURIComponent(categorySlug)}/${encodeURIComponent(pageSlug)}`;
}

export default function DocsPage() {
  const { lang } = useI18n();
  const categories = useMemo(() => getDocsCategories(lang), [lang]);
  const summaryItems = useMemo(() => getDocsSummaryItems(lang), [lang]);
  const flat = useMemo(() => flattenPages(categories), [categories]);
  const [location, setLocation] = useState<DocsLocation>(() =>
    parseLocation(window.location.pathname, window.location.hash, categories)
  );

  useEffect(() => {
    const onPopState = () => {
      setLocation(parseLocation(window.location.pathname, window.location.hash, categories));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [categories]);

  const currentIndex = flat.findIndex(
    ({ category, page }) => category.slug === location.categorySlug && page.slug === location.pageSlug
  );
  const current = flat[currentIndex] ?? flat[0];
  const previous = currentIndex > 0 ? flat[currentIndex - 1] : undefined;
  const next = currentIndex >= 0 && currentIndex < flat.length - 1 ? flat[currentIndex + 1] : undefined;
  const isOverview = currentIndex === 0;

  useEffect(() => {
    if (current) document.title = `${current.page.title} · Disburse Docs`;
  }, [current]);

  const navigateTo = useCallback(
    (categorySlug: string, pageSlug: string) => {
      const target = pagePath(categorySlug, pageSlug, categories);
      if (`${window.location.pathname}${window.location.search}` !== target) {
        window.history.pushState(null, "", target);
      }
      setLocation({ categorySlug, pageSlug });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [categories]
  );

  const sectionAnchors = useMemo(
    () =>
      current?.page.sections.map((section) => ({
        slug: slugify(section.title),
        title: section.title
      })) ?? [],
    [current]
  );
  const [activeSection, setActiveSection] = useState(sectionAnchors[0]?.slug ?? "");

  useEffect(() => {
    setActiveSection(sectionAnchors[0]?.slug ?? "");
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: "-18% 0px -68% 0px" }
    );
    sectionAnchors.forEach(({ slug }) => {
      const element = document.getElementById(slug);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [sectionAnchors, location]);

  if (!current) return <main className="docs-empty">Documentation is unavailable.</main>;

  const featured = categories.slice(1, 4).flatMap((category) => {
    const page = category.pages[0];
    return page ? [{ category, page }] : [];
  });

  return (
    <div className="docs-layout">
      <aside className="docs-rail">
        <DocsSearch categories={categories} onNavigate={navigateTo} />
        <nav className="docs-navigation" aria-label="Documentation pages">
          {categories.map((category) => (
            <section key={category.slug} className="docs-nav-group">
              <h2>{category.title}</h2>
              {category.pages.map((page) => {
                const active = category.slug === current.category.slug && page.slug === current.page.slug;
                return (
                  <a
                    key={page.slug}
                    href={pagePath(category.slug, page.slug, categories)}
                    aria-current={active ? "page" : undefined}
                    className={cx("docs-nav-link", active && "is-active")}
                    onClick={(event) => {
                      event.preventDefault();
                      navigateTo(category.slug, page.slug);
                    }}
                  >
                    {page.title}
                  </a>
                );
              })}
            </section>
          ))}
        </nav>
        <div className="docs-rail-note">
          <span>Environment</span>
          <strong>Arc Testnet</strong>
          <small>Chain 5042002</small>
        </div>
      </aside>

      <div className="docs-stage">
        <main className="docs-article">
          {isOverview && (
            <section className="docs-hero">
              <p className="docs-kicker">PAYMENT GATEWAY / ARC TESTNET</p>
              <h1>Build payments that settle into records.</h1>
              <p className="docs-hero-copy">
                Create wallet-authorized requests, verify Arc settlement, and hand accounting systems a
                portable receipt. Disburse stays non-custodial from request to record.
              </p>

              <dl className="docs-facts">
                {summaryItems.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="docs-featured">
                {featured.map(({ category, page }, index) => (
                  <a
                    key={category.slug}
                    href={pagePath(category.slug, page.slug, categories)}
                    onClick={(event) => {
                      event.preventDefault();
                      navigateTo(category.slug, page.slug);
                    }}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <small>{category.title}</small>
                    <strong>{page.title}</strong>
                    <ArrowRight size={16} aria-hidden="true" />
                  </a>
                ))}
              </div>
            </section>
          )}

          <article className={cx("docs-document", isOverview && "docs-document-overview")}>
            <header className="docs-document-header">
              <p>{current.category.title}</p>
              <h1>{current.page.title}</h1>
            </header>

            {current.page.sections.map((section) => {
              const sectionSlug = slugify(section.title);
              return (
                <section key={sectionSlug} id={sectionSlug} className="docs-section">
                  <div className="docs-prose">
                    {section.body.map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                  </div>
                  {section.points && (
                    <ol className="docs-points">
                      {section.points.map((point, index) => (
                        <li key={index}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <p>{point}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                  {section.code && <CodeBlock code={section.code} />}
                </section>
              );
            })}

            <nav className="docs-page-nav" aria-label="Adjacent documentation pages">
              {previous ? (
                <a
                  href={pagePath(previous.category.slug, previous.page.slug, categories)}
                  onClick={(event) => {
                    event.preventDefault();
                    navigateTo(previous.category.slug, previous.page.slug);
                  }}
                >
                  <ArrowLeft size={15} aria-hidden="true" />
                  <span>
                    <small>Previous</small>
                    <strong>{previous.page.title}</strong>
                  </span>
                </a>
              ) : (
                <span />
              )}
              {next && (
                <a
                  href={pagePath(next.category.slug, next.page.slug, categories)}
                  onClick={(event) => {
                    event.preventDefault();
                    navigateTo(next.category.slug, next.page.slug);
                  }}
                >
                  <span>
                    <small>Next</small>
                    <strong>{next.page.title}</strong>
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                </a>
              )}
            </nav>
          </article>
        </main>

        {sectionAnchors.length > 1 && (
          <aside className="docs-toc">
            <span>On this page</span>
            {sectionAnchors.map((anchor) => (
              <a
                key={anchor.slug}
                href={`#${anchor.slug}`}
                className={anchor.slug === activeSection ? "is-active" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(anchor.slug)?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                {anchor.title}
              </a>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-code">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(code);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copy code"
      >
        <Copy size={13} aria-hidden="true" /> {copied ? "Copied" : "Copy"}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
