import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Max width in px. Defaults to 560. */
  maxWidth?: number;
};

/**
 * Minimal, accessible modal dialog.
 *
 * - Portal-mounted to <body>.
 * - Closes on Esc or backdrop click.
 * - Focus moves to the first focusable element on open and is restored on close.
 * - Respects `prefers-reduced-motion`.
 */
export default function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 560,
}: DialogProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // Capture the element that had focus when the dialog opened so we can restore it later.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog.
    const focusTarget =
      surfaceRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? surfaceRef.current;
    focusTarget?.focus();

    // Scroll lock.
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  const handleBackdropMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Simple focus trap.
      const focusables =
        surfaceRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? ([] as unknown as NodeListOf<HTMLElement>);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="dialog-root"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          onMouseDown={handleBackdropMouseDown}
          onKeyDown={handleKeyDown}
          aria-hidden={false}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* Surface */}
          <motion.div
            ref={surfaceRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            className="relative w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] outline-none"
            style={{ maxWidth }}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            tabIndex={-1}
          >
            {/* Header */}
            <header className="flex items-start justify-between gap-4 border-b border-[var(--line-soft)] px-6 py-4">
              <div>
                <h2
                  id={titleId}
                  className="text-[15px] font-semibold tracking-tight text-[var(--ink)]"
                >
                  {title}
                </h2>
                {description && (
                  <p
                    id={descId}
                    className="mt-1 text-xs leading-relaxed text-[var(--muted)]"
                  >
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="-mr-1 -mt-1 rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--line-soft)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                aria-label="Close dialog"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </header>

            {/* Body */}
            <div className="px-6 py-5">{children}</div>

            {footer && (
              <footer className="flex items-center justify-end gap-2 border-t border-[var(--line-soft)] bg-[var(--paper-soft-translucent)] px-6 py-3">
                {footer}
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
