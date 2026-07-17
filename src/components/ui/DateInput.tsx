import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

type Props = {
  /** ISO date string (yyyy-mm-dd) or "" for unset. */
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  id?: string;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function fromIso(iso: string): Date | null {
  if (!ISO_RE.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 ? date : null;
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplay(iso: string): string {
  const date = fromIso(iso);
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * Smart date input: type a date in natural language ("tomorrow",
 * "next friday", "16 jul") or pick one from the calendar popover.
 * Value in/out is always an ISO yyyy-mm-dd string, same as the old
 * <input type="date"> it replaces.
 */
export default function DateInput({ value, onChange, placeholder, id }: Props) {
  const [text, setText] = useState(() => formatDisplay(value));
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => fromIso(value) ?? new Date());
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Reflect external value changes (form reset, request selection).
  useEffect(() => {
    setText(formatDisplay(value));
    const d = fromIso(value);
    if (d) setViewMonth(d);
  }, [value]);

  function commit(date: Date | null) {
    if (!date || Number.isNaN(date.getTime())) {
      setText(formatDisplay(value));
      return;
    }
    const iso = toIso(date);
    onChange(iso);
    setText(formatDisplay(iso));
    setViewMonth(date);
  }

  async function parseText() {
    const raw = text.trim();
    if (!raw) {
      onChange("");
      setText("");
      return;
    }
    if (ISO_RE.test(raw)) {
      commit(fromIso(raw));
      return;
    }
    // chrono-node is loaded on demand so it stays out of the main bundle.
    const chrono = await import("chrono-node");
    commit(chrono.parseDate(raw, new Date()));
  }

  const selected = fromIso(value);
  const today = new Date();
  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const leadingBlanks = (monthStart.getDay() + 6) % 7; // Monday-first grid
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(viewMonth);

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node)) {
          setOpen(false);
          void parseText();
        }
      }}
    >
      <input
        id={id}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void parseText();
            setOpen(false);
          }
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        placeholder={placeholder ?? 'Try "tomorrow" or 16 Jul'}
        autoComplete="off"
        spellCheck={false}
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Open calendar"
        aria-expanded={open}
        className={cn(
          "absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
          open
            ? "bg-[var(--paper-2)] text-[var(--ink)]"
            : "text-[var(--muted)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]",
        )}
      >
        <CalendarDays size={14} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[248px] rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)] p-2 shadow-[0_18px_42px_-26px_rgba(0,0,0,0.55)]">
          {/* Month header */}
          <div className="flex items-center justify-between px-1 pb-1">
            <button
              type="button"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
              aria-label="Previous month"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
            >
              <ChevronLeft size={14} strokeWidth={1.75} />
            </button>
            <span className="text-sm font-medium text-[var(--ink)]">{monthLabel}</span>
            <button
              type="button"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
              aria-label="Next month"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
            >
              <ChevronRight size={14} strokeWidth={1.75} />
            </button>
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5 text-center">
            {WEEKDAYS.map((day) => (
              <span key={day} className="py-1 text-xs font-medium text-[var(--muted-soft)]">
                {day}
              </span>
            ))}
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const date = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1);
              const isSelected = selected !== null && toIso(date) === toIso(selected);
              const isToday = toIso(date) === toIso(today);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    commit(date);
                    setOpen(false);
                  }}
                  className={cn(
                    "mx-auto flex h-7 w-7 items-center justify-center rounded-md text-base transition-colors",
                    isSelected
                      ? "bg-[var(--primary-bg)] font-medium text-[color:var(--primary-text)]"
                      : "text-[var(--ink)] hover:bg-[var(--paper-2)]",
                    !isSelected && isToday && "shadow-[0_0_0_1px_var(--line-strong)]",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>

          {/* Shortcut */}
          <div className="mt-1 border-t border-[var(--line-soft)] pt-1">
            <button
              type="button"
              onClick={() => {
                commit(new Date());
                setOpen(false);
              }}
              className="w-full rounded-md py-1.5 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
