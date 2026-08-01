import type { MouseEvent } from "react";

export type Page =
  | "landing"
  | "dashboard"
  | "payments"
  | "qr-payments"
  | "pay"
  | "import-export"
  | "statements"
  | "docs";

export type NavigateHandler = (event: MouseEvent<HTMLAnchorElement>, target: string) => void;

export const APP_PAGE_PATHS = {
  "/": "dashboard",
  "/dashboard": "dashboard",
  "/payments": "payments",
  "/qr-payments": "qr-payments",
  "/pay": "pay",
  "/import-export": "import-export",
  "/statements": "statements",
  "/settings": "dashboard"
} as const satisfies Record<string, Exclude<Page, "landing" | "docs">>;

export const LEGACY_DOCS_PATH = "/docs";
export const PRODUCTION_DOCS_HOSTNAME = "docs.disburse.online";
export const PRODUCTION_APP_HOSTNAME = "app.disburse.online";
export const PRODUCTION_PAY_HOSTNAME = "pay.disburse.online";
export const PRODUCTION_BRIDGE_HOSTNAME = "bridge.disburse.online";

export function getInitialPage(): Page {
  const hostname = window.location.hostname;
  const p = window.location.pathname;

  // Dedicated docs subdomain: render the standalone docs layout.
  if (isDocsHostname(hostname)) {
    return "docs";
  }

  // Dedicated pay subdomain (or local ?pay=1 preview): the hosted, mobile-first
  // QR-payment page. Its homepage IS the pay page — the request payload is read
  // from the ?r= query param, so any path maps to "pay".
  if (isPaySurface(hostname)) {
    return "pay";
  }

  // /docs is not a route on any of the surfaces below. Documentation has one
  // home — the docs host — and main.tsx sends /docs there before the app ever
  // mounts. Nothing here needs to know about it.
  const isApp = hostname.startsWith("app.") || isLocalAppPreview(hostname, p);

  if (isApp) {
    const matchedPage = APP_PAGE_PATHS[p as keyof typeof APP_PAGE_PATHS];
    if (matchedPage) return matchedPage;
    // /settings was a dedicated page; it is now a dialog that opens from the header.
    // Keep the URL working by falling through to the dashboard. The dialog
    // auto-opens via an effect in the App component.
    return "dashboard";
  }

  return "landing";
}

export function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

export function isLocalAppPreview(hostname: string, pathname: string): boolean {
  if (!isLocalHostname(hostname)) {
    return false;
  }

  const appPreview = new URLSearchParams(window.location.search).get("app") === "1";
  // "/docs" is deliberately absent: it is not an app route on any host — the
  // docs host is documentation's only home.
  return appPreview || (pathname !== "/" && pathname in APP_PAGE_PATHS);
}

export function isDocsHostname(hostname = window.location.hostname): boolean {
  return hostname === "docs.localhost" || hostname === PRODUCTION_DOCS_HOSTNAME;
}

export function isPayHostname(hostname = window.location.hostname): boolean {
  return hostname === "pay.localhost" || hostname === PRODUCTION_PAY_HOSTNAME;
}

export function isBridgeHostname(hostname = window.location.hostname): boolean {
  return hostname === "bridge.localhost" || hostname === PRODUCTION_BRIDGE_HOSTNAME;
}

// Naked-localhost preview of the hosted pay page via ?pay=1. This does NOT
// also trigger on the /pay path: a plain /pay on localhost stays the in-shell
// desktop preview, so devs can still see both.
export function isLocalPayPreview(hostname = window.location.hostname): boolean {
  if (!isLocalHostname(hostname)) {
    return false;
  }
  return new URLSearchParams(window.location.search).get("pay") === "1";
}

export function isLocalBridgePreview(hostname = window.location.hostname): boolean {
  if (!isLocalHostname(hostname)) {
    return false;
  }
  return (
    window.location.pathname === "/bridge" ||
    new URLSearchParams(window.location.search).get("bridge") === "1"
  );
}

// True when the current surface should render the dedicated mobile-first pay
// page instead of the full app shell.
export function isPaySurface(hostname = window.location.hostname): boolean {
  return isPayHostname(hostname) || isLocalPayPreview(hostname);
}

export function isBridgeSurface(hostname = window.location.hostname): boolean {
  return isBridgeHostname(hostname) || isLocalBridgePreview(hostname);
}

export function stripPublicSubdomain(hostname: string): string {
  if (hostname.startsWith("docs.")) {
    return hostname.slice("docs.".length);
  }
  if (hostname.startsWith("pay.")) {
    return hostname.slice("pay.".length);
  }
  if (hostname.startsWith("bridge.")) {
    return hostname.slice("bridge.".length);
  }
  if (hostname.startsWith("www.")) {
    return hostname.slice("www.".length);
  }
  return hostname;
}

export function getDocsHostname(hostname: string): string {
  if (isDocsHostname(hostname)) {
    return hostname;
  }
  if (isLocalHostname(hostname) || hostname.endsWith(".localhost")) {
    return "docs.localhost";
  }
  return PRODUCTION_DOCS_HOSTNAME;
}

export function getAppHostname(hostname: string): string {
  if (hostname.startsWith("app.")) {
    return hostname;
  }
  if (isLocalHostname(hostname) || hostname.endsWith(".localhost")) {
    return "app.localhost";
  }
  return PRODUCTION_APP_HOSTNAME;
}

export function getPayHostname(hostname: string): string {
  if (hostname.startsWith("pay.")) {
    return hostname;
  }
  if (isLocalHostname(hostname) || hostname.endsWith(".localhost")) {
    return "pay.localhost";
  }
  return PRODUCTION_PAY_HOSTNAME;
}

export function getBridgeHostname(hostname: string): string {
  if (hostname.startsWith("bridge.")) {
    return hostname;
  }
  if (isLocalHostname(hostname) || hostname.endsWith(".localhost")) {
    return "bridge.localhost";
  }
  return PRODUCTION_BRIDGE_HOSTNAME;
}

// Origin a freshly generated QR / share link should point at, so a scanned
// code opens the hosted mobile pay page. Naked localhost has no product
// subdomain in its origin, so we keep the current origin there and let the
// in-shell /pay route serve the link locally.
export function getPayShareOrigin(hostname = window.location.hostname): string {
  if (isLocalHostname(hostname)) {
    return window.location.origin;
  }
  return getOriginForHostname(getPayHostname(hostname));
}

export function getOriginForHostname(hostname: string): string {
  const port = window.location.port ? `:${window.location.port}` : "";
  return `${window.location.protocol}//${hostname}${port}`;
}

// The one way to link to documentation. Always resolves to the dedicated docs
// host — docs.localhost in dev, docs.disburse.online in production — and never
// to an in-console /docs route. There is no exception, including naked
// localhost: an exception here is what put docs inside the app shell on the one
// URL anybody actually opens in dev.
export function getDocsHref(): string {
  const hostname = window.location.hostname;
  if (isDocsHostname(hostname)) {
    return "/";
  }
  return `${getOriginForHostname(getDocsHostname(hostname))}/`;
}

export function getBridgeHref(): string {
  const hostname = window.location.hostname;
  if (isBridgeHostname(hostname)) {
    return "/";
  }
  if (isLocalHostname(hostname) && !hostname.startsWith("bridge.")) {
    return "/bridge";
  }
  return `${getOriginForHostname(getBridgeHostname(hostname))}/`;
}

export function getAppHref(path: string): string {
  const hostname = window.location.hostname;

  // If we are already on an app subdomain, we can use relative paths
  if (hostname.startsWith("app.")) {
    return path;
  }

  // If we are on localhost but not the app version, use the query param hack
  if (isLocalHostname(hostname) && !hostname.startsWith("app.")) {
    if (path === "/") return "/?app=1";
    return `${path}${path.includes("?") ? "&" : "?"}app=1`;
  }

  // Otherwise, use the full origin for the app subdomain
  return `${getOriginForHostname(getAppHostname(hostname))}${path}`;
}

export function getInternalTargetPath(target: string): string | undefined {
  const url = new URL(target, window.location.href);
  if (url.origin !== window.location.origin) {
    return undefined;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

// /docs is a legacy path. Docs are canonically served from the docs host, so
// every other surface that still gets a /docs hit sends the user there —
// localhost included, since docs.localhost resolves to loopback and the dev
// server answers on it.
export function shouldRedirectLegacyDocsRoute(): boolean {
  if (isDocsHostname()) {
    return false;
  }
  return window.location.pathname === LEGACY_DOCS_PATH;
}

export function getCurrentRouteKey(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
