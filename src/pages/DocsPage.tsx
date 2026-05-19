import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../lib/i18n";
import { cx, slugify } from "../lib/cx";
import { getDocsSections, getDocsSummaryItems } from "../content/docs";

export default function DocsPage() {
  const { lang, t } = useI18n();
  const sections = useMemo(() => getDocsSections(lang), [lang]);
  const summaryItems = useMemo(() => getDocsSummaryItems(lang), [lang]);
  const initialDocSlug = slugify(sections[0]?.title ?? "");
  const [activeSlug, setActiveSlug] = useState<string>(initialDocSlug);

  useEffect(() => {
    setActiveSlug(initialDocSlug);
  }, [initialDocSlug]);

  // Scrollspy. highlights the TOC entry for the section nearest the top.
  useEffect(() => {
    const slugs = sections.map((s) => slugify(s.title));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) {
          setActiveSlug(visible.target.id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: [0, 1] },
    );
    for (const slug of slugs) {
      const el = document.getElementById(slug);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  function scrollToSlug(slug: string) {
    const el = document.getElementById(slug);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSlug(slug);
    }
  }

  return (
    <div className="mx-auto max-w-[1180px] pb-16">
      {/* Hero */}
      <section className="border-b border-[var(--line)] pb-10">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
          {t("documentation")}
        </p>
        <h1 className="max-w-[24ch] text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-[var(--ink)]">
          {t("docsHeroTitle")}
        </h1>
        <p className="mt-5 max-w-[66ch] text-[15px] leading-relaxed text-[var(--muted)]">
          {t("docsHeroText")}
        </p>

        <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--line-soft)] pt-6 sm:grid-cols-4">
          {summaryItems.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                {item.label}
              </dt>
              <dd className="truncate text-[13px] font-medium text-[var(--ink)]">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Manual */}
      <section className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        {/* TOC */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            {t("onThisPage")}
          </p>
          <nav className="flex flex-col gap-0.5">
            {sections.map((section) => {
              const slug = slugify(section.title);
              const active = slug === activeSlug;
              return (
                <a
                  key={slug}
                  href={`#${slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSlug(slug);
                    window.history.replaceState(null, "", `#${slug}`);
                  }}
                  className={cx(
                    "relative rounded-md py-1.5 pl-3 pr-2 text-[13px] transition-colors",
                    active
                      ? "text-[var(--ink)]"
                      : "text-[var(--muted)] hover:text-[var(--ink)]",
                  )}
                >
                  <span
                    className={cx(
                      "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full transition-all",
                      active ? "bg-[var(--primary-bg)]" : "bg-transparent",
                    )}
                    aria-hidden="true"
                  />
                  {section.title}
                </a>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="min-w-0">
          {sections.map((section, index) => (
            <article
              key={section.title}
              id={slugify(section.title)}
              className="scroll-mt-20 border-b border-[var(--line-soft)] py-10 first:pt-0 last:border-b-0"
            >
              <p className="mb-3 font-mono text-[11px] text-[var(--muted)]">
                § {String(index + 1).padStart(2, "0")}
              </p>
              <h2 className="mb-4 text-[22px] font-semibold tracking-tight text-[var(--ink)]">
                {section.title}
              </h2>
              <div className="space-y-3 text-[15px] leading-[1.7] text-[var(--muted)]">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="max-w-[72ch]">
                    {paragraph}
                  </p>
                ))}
              </div>
              {section.points && (
                <ul className="mt-5 max-w-[72ch] space-y-2">
                  {section.points.map((point) => (
                    <li
                      key={point}
                      className="relative pl-5 text-[14px] leading-[1.65] text-[var(--muted)] before:absolute before:left-0 before:top-[0.65em] before:h-1.5 before:w-1.5 before:rounded-full before:border before:border-[var(--primary-bg)]/60"
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
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
