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
        text,
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
 * in-memory docs content — no backend. Navigates via the same hash router the
 * sidebar uses.
 */
export default function DocsSearch({
  categories,
  onNavigate,
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
    [onNavigate],
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
    <div ref={wrapRef} className="relative mb-5">
      <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--paper-2)] px-2 focus-within:border-[var(--ink-soft)]">
        <Search size={14} strokeWidth={1.75} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search docs…"
          className="w-full min-w-0 bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--muted-soft)] focus:outline-none"
          aria-label="Search documentation"
        />
        <kbd className="hidden shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 text-2xs font-medium text-[var(--muted)] sm:inline">
          ⌘K
        </kbd>
      </div>
      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-[60vh] overflow-y-auto rounded-md border border-[var(--line)] bg-[var(--paper)] py-1 shadow-md">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--muted)]">No results for “{query.trim()}”.</p>
          ) : (
            results.map((e, i) => (
              <button
                key={`${e.categorySlug}/${e.pageSlug}`}
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(e)}
                className={cx(
                  "block w-full px-3 py-2 text-left transition-colors",
                  i === sel ? "bg-[var(--paper-2)]" : "hover:bg-[var(--paper-2)]",
                )}
              >
                <p className="text-2xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {e.categoryTitle}
                </p>
                <p className="text-sm font-medium text-[var(--ink)]">{e.pageTitle}</p>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{snippet(e.text, query.trim())}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
