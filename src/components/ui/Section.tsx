import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type SectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Render the heading row only — no body/children wrapper. */
  headerOnly?: boolean;
};

/**
 * Internal section header used inside <Card> surfaces.
 * Provides consistent title + description + actions layout
 * across receipt, settings, and pay screens.
 */
export default function Section({
  title,
  description,
  actions,
  children,
  className,
  headerOnly = false,
}: SectionProps) {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {title && (
              <h3 className="text-[13px] font-semibold tracking-tight text-[var(--ink)]">
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {!headerOnly && children}
    </div>
  );
}
