import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cx } from "../lib/cx";
import type { DocsCategory } from "../content/docs";

type Entry = {
  categorySlug: string;
  categoryTitle: string;
  pageSlug: string;
  pageTitle: string;
  haystack: string;
  text: string;
};

function buildIndex(categories: DocsCategory[]): Entry[] {
  const out: Entry[] = [];
  for (const cat of categories) {
    for (const page of cat.pages) {
      const parts: string[] = [page.title];
      for (const s of page.sections) {
        parts.push(s.title, ...s.body);
        if (s.points) parts.push(...s.points);
      }
      const text = parts.join(" ");
      out.push({
        categorySlug: cat.slug,
        categoryTitle: cat.title,
        pageSlug: page.slug,
        pageTitle: page.title,
        haystack: text.toLowerCase(),
        text
      });
    }
  }
  return out;
}

function snippet(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 90);
  const start = Math.max(0, i - 35);
  const end = Math.min(text.length, i + q.length + 55);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

/**
 * Client-side docs search (⌘K). Indexes page titles + section bodies from the
 * in-memory docs content — no backend. Navigates through the docs path router.
 */
export default function DocsSearch({
  categories,
  onNavigate
}: {
  categories: DocsCategory[];
  onNavigate: (categorySlug: string, pageSlug: string) => void;
}) {
  const index = useMemo(() => buildIndex(categories), [categories]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Entry[];
    const scored = index
      .map((e) => {
        const titleHit = e.pageTitle.toLowerCase().includes(q);
        const bodyHit = e.haystack.includes(q);
        if (!titleHit && !bodyHit) return null;
        return { e, score: titleHit ? 0 : 1 };
      })
      .filter((x): x is { e: Entry; score: number } => x !== null);
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 8).map((s) => s.e);
  }, [index, query]);

  useEffect(() => {
    setSel(0);
  }, [results]);

  // ⌘K / Ctrl+K to focus the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the results.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const choose = useCallback(
    (e: Entry) => {
      onNavigate(e.categorySlug, e.pageSlug);
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    },
    [onNavigate]
  );

  function onKeyDown(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (ev.key === "Enter" && results[sel]) {
      ev.preventDefault();
      choose(results[sel]);
    }
  }

  return (
    <div ref={wrapRef} className="docs-search">
      <div className="docs-search-control">
        <Search size={15} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search documentation"
          aria-label="Search documentation"
        />
        <kbd>Ctrl K</kbd>
      </div>
      {open && query.trim() && (
        <div className="docs-search-results">
          {results.length === 0 ? (
            <p className="docs-search-empty">No results for “{query.trim()}”.</p>
          ) : (
            results.map((e, i) => (
              <button
                key={`${e.categorySlug}/${e.pageSlug}`}
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(e)}
                className={cx("docs-search-result", i === sel && "is-selected")}
              >
                <span>{e.categoryTitle}</span>
                <strong>{e.pageTitle}</strong>
                <small>{snippet(e.text, query.trim())}</small>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
