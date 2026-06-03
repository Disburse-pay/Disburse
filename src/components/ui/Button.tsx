import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
};

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--btn-radius)] font-medium transition-colors select-none whitespace-nowrap " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[11.5px]",
  md: "h-8 px-3.5 text-[12.5px]",
  lg: "h-10 px-4 text-[13.5px]",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--primary-bg)] text-[color:var(--primary-text)] font-medium shadow-sm hover:bg-[var(--primary-bg-hover)]",
  secondary:
    "border border-[var(--line-strong)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--ink-soft)] hover:bg-[var(--paper-2)]",
  ghost:
    "text-[var(--muted)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]",
  danger:
    "bg-[var(--danger-bg)] text-[var(--danger-text-contrast)] font-medium shadow-sm hover:opacity-90",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    iconLeft,
    iconRight,
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        base,
        sizes[size],
        variants[variant],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
      ) : (
        iconLeft
      )}
      {children}
      {!loading && iconRight}
    </button>
  );
});

export default Button;
