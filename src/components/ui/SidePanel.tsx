import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export type SidePanelProps = {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  /** Width in px on desktop. Full width on small viewports. */
  width?: number;
  /** Render a dimmed backdrop. Defaults to true. */
  scrim?: boolean;
  ariaLabel: string;
  title?: ReactNode;
  description?: ReactNode;
  /** Hide the built-in close (X) button. */
  hideClose?: boolean;
  children: ReactNode;
};

/**
 * Off-canvas side panel. Used by the mobile nav drawer (scrim=true, side=left)
 * and the settings panel (scrim=false, side=right).
 *
 * - Portal-mounted to <body>.
 * - Closes on Esc and (when scrim) backdrop click.
 * - When scrim=false, an invisible click-catcher behind the panel still closes
 *   on outside click so we don't need a global document listener.
 * - Focus moves into the panel on open and is restored on close.
 * - Respects `prefers-reduced-motion`.
 */
export default function SidePanel({
  open,
  onClose,
  side = "right",
  width = 360,
  scrim = true,
  ariaLabel,
  title,
  description,
  hideClose = false,
  children,
}: SidePanelProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const focusTarget =
      surfaceRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? surfaceRef.current;
    focusTarget?.focus();

    // Scroll-lock only when we own the full viewport (scrim).
    let prevOverflow: string | undefined;
    if (scrim) {
      prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
    }

    return () => {
      if (prevOverflow !== undefined) {
        document.documentElement.style.overflow = prevOverflow;
      }
      restoreFocusRef.current?.focus?.();
    };
  }, [open, scrim]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

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

  const hidden = side === "left" ? "-100%" : "100%";
  const transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="sidepanel-root"
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.18 }}
          onKeyDown={handleKeyDown}
        >
          {/* Backdrop (scrim) OR transparent click-catcher */}
          <div
            className={cn(
              "absolute inset-0",
              scrim ? "bg-black/55 backdrop-blur-[2px]" : "bg-transparent",
            )}
            onMouseDown={onClose}
            aria-hidden="true"
          />

          {/* Surface */}
          <motion.div
            ref={surfaceRef}
            role="dialog"
            aria-modal={scrim ? "true" : "false"}
            aria-label={!title ? ariaLabel : undefined}
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            className={cn(
              "absolute top-0 bottom-0 flex flex-col bg-[var(--paper)] outline-none",
              "border-[var(--line)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]",
              "w-full max-w-full",
              side === "left" ? "left-0 border-r" : "right-0 border-l",
            )}
            style={{ width: `min(100vw, ${width}px)` }}
            initial={{ x: hidden }}
            animate={{ x: 0 }}
            exit={{ x: hidden }}
            transition={transition}
          >
            {(title || !hideClose) && (
              <header className="flex items-start justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  {title && (
                    <h2
                      id={titleId}
                      className="text-[14px] font-semibold tracking-tight text-[var(--ink)]"
                    >
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p
                      id={descId}
                      className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--muted)]"
                    >
                      {description}
                    </p>
                  )}
                </div>
                {!hideClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="-mr-1 -mt-0.5 rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--line-soft)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                    aria-label="Close"
                  >
                    <X size={15} strokeWidth={1.75} />
                  </button>
                )}
              </header>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
