import { cn } from "../../lib/utils";
import type { Outcome } from "../../lib/markets/types";

type Props = {
  outcome: Outcome;
  className?: string;
  size?: "sm" | "md";
};

export default function OutcomeBadge({ outcome, className, size = "sm" }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border font-medium",
        size === "sm" ? "px-1.5 py-[2px] text-[10px]" : "px-2 py-[3px] text-[11px]",
        outcome === "YES"
          ? "border-[var(--green-text)]/40 bg-[var(--green-text)]/10 text-[var(--green-text)]"
          : "border-[var(--red-text)]/40 bg-[var(--red-text)]/10 text-[var(--red-text)]",
        className
      )}
    >
      {outcome}
    </span>
  );
}
