import { lazy, Suspense, type ComponentType } from "react";

/**
 * Wrap a chart component in React.lazy + Suspense so recharts (heavy) and its
 * shared `charts` vendor chunk load on demand instead of in the entry bundle /
 * the mobile pay page. Usage:
 *
 *   const PriceChart = lazyChart(() => import("./PriceChart"));
 */
export function lazyChart<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>
): ComponentType<P> {
  const Inner = lazy(loader);
  return function LazyChart(props: P) {
    return (
      <Suspense fallback={<div aria-hidden className="min-h-[1px]" />}>
        <Inner {...props} />
      </Suspense>
    );
  };
}
