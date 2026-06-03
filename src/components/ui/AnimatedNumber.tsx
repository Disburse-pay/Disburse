import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  /** Format the (animating) numeric value into display text. */
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
};

/**
 * Counts up to `value` on mount and whenever it changes (eased), giving
 * headline metrics a premium "alive" feel. Honors prefers-reduced-motion by
 * snapping straight to the final value — no animation, no layout surprise.
 */
export default function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  durationMs = 900,
  className
}: Props) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced || durationMs <= 0) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(from + (value - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return <span className={className}>{format(display)}</span>;
}
