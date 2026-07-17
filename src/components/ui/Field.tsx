import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
};

function Field({ label, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-sm font-medium text-[var(--ink)]">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-[var(--red-text)]">{error}</p>
      ) : hint ? (
        <p className="text-xs text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export type FieldRowProps = {
  label: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Read-only `<dt>/<dd>` style row for receipts and detail views.
 * Replaces the .psp-proof-row pattern.
 */
function FieldRow({ label, children, className }: FieldRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-t border-[var(--line-soft)] py-2 first:border-t-0",
        className,
      )}
    >
      <dt className="text-xs font-medium text-[var(--muted)]">
        {label}
      </dt>
      <dd className="min-w-0 truncate font-mono text-sm text-[var(--ink)]">
        {children}
      </dd>
    </div>
  );
}

Field.Row = FieldRow;

export default Field;
