import type { MouseEvent } from "react";

export type Page =
  | "landing"
  | "dashboard"
  | "payments"
  | "qr-payments"
  | "pay"
  | "import-export"
  | "milestones"
  | "statements"
  | "docs"
  | "markets"
  | "market-detail"
  | "market-positions"
  | "market-history"
  | "lending";

export type NavigateHandler = (event: MouseEvent<HTMLAnchorElement>, target: string) => void;

export const LEGACY_DOCS_PATH = "/docs";
export const PRODUCTION_DOCS_HOSTNAME = "docs.disburse.online";
export const PRODUCTION_APP_HOSTNAME = "app.disburse.online";
export const PRODUCTION_BET_HOSTNAME = "bet.disburse.online";

export const MARKET_DETAIL_PATH_PREFIX = "/markets/";
export const MARKETS_PATH = "/markets";
export const MARKET_POSITIONS_PATH = "/markets/positions";
export const MARKET_HISTORY_PATH = "/markets/history";
export const LENDING_PATH = "/lending";

export function getInitialPage(): Page {
  const hostname = window.location.hostname;
  const p = window.location.pathname;

  // Dedicated docs subdomain: render the standalone docs layout.
  if (isDocsHostname(hostname)) {
    return "docs";
  }

  // Dedicated bet subdomain (or local bet preview): render the markets shell.
  // Bet subdomain's homepage is the markets list, not a separate landing.
  if (isBetHostname(hostname) || isLocalBetPreview(hostname, p)) {
    return resolveBetPage(p);
  }

  const isApp = hostname.startsWith("app.") || isLocalAppPreview(hostname, p);

  if (isApp) {
    if (p === "/payments") return "payments";
    if (p === "/qr-payments") return "qr-payments";
    if (p === "/pay") return "pay";
    if (p === "/import-export") return "import-export";
    if (p === "/milestones") return "milestones";
    if (p === "/statements") return "statements";
    // /docs inside the app shell renders the docs page as a regular route
    // (sidebar navigation, header, the whole console chrome). The dedicated
    // docs subdomain is served by the branch above.
    if (p === LEGACY_DOCS_PATH) return "docs";
    // /settings was a dedicated page; it is now a dialog that opens from the header.
    // Keep the URL working by falling through to the dashboard. The dialog
    // auto-opens via an effect in the App component.
    return "dashboard";
  }

  // Naked localhost / other local preview: allow /docs to render docs in-shell.
  if (isLocalDocsPreview(hostname, p)) {
    return "docs";
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
  return (
    appPreview ||
    ["/payments", "/qr-payments", "/pay", "/import-export", "/settings", "/docs"].includes(pathname)
  );
}

export function isLocalDocsPreview(hostname: string, pathname: string): boolean {
  return (isLocalHostname(hostname) || hostname.endsWith(".localhost")) && pathname === LEGACY_DOCS_PATH;
}

export function isDocsHostname(hostname = window.location.hostname): boolean {
  return hostname === "docs.localhost" || hostname === PRODUCTION_DOCS_HOSTNAME;
}

export function isBetHostname(hostname = window.location.hostname): boolean {
  return hostname === "bet.localhost" || hostname === PRODUCTION_BET_HOSTNAME;
}

export function isLocalBetPreview(hostname: string, pathname: string): boolean {
  if (!isLocalHostname(hostname)) {
    return false;
  }
  const betPreview = new URLSearchParams(window.location.search).get("bet") === "1";
  return betPreview || isBetPath(pathname);
}

function isBetPath(pathname: string): boolean {
  return (
    pathname === MARKETS_PATH ||
    pathname === MARKET_POSITIONS_PATH ||
    pathname === MARKET_HISTORY_PATH ||
    pathname === LENDING_PATH ||
    pathname.startsWith(MARKET_DETAIL_PATH_PREFIX)
  );
}

// Resolve a path within the bet shell to its Page. The bet subdomain's
// homepage is the markets list, so "/" maps to "markets".
export function resolveBetPage(pathname: string): Page {
  if (pathname === MARKET_POSITIONS_PATH) return "market-positions";
  if (pathname === MARKET_HISTORY_PATH) return "market-history";
  if (pathname === LENDING_PATH) return "lending";
  if (pathname === MARKETS_PATH || pathname === "/") return "markets";
  if (pathname.startsWith(MARKET_DETAIL_PATH_PREFIX)) return "market-detail";
  // Unknown path on bet subdomain falls back to the markets list.
  return "markets";
}

// Extract the market id from a /markets/<id> path. Returns undefined for
// non-detail paths.
export function getMarketIdFromPath(pathname: string = window.location.pathname): string | undefined {
  if (!pathname.startsWith(MARKET_DETAIL_PATH_PREFIX)) return undefined;
  const rest = pathname.slice(MARKET_DETAIL_PATH_PREFIX.length);
  // Reject reserved sub-paths handled by resolveBetPage above.
  if (rest === "" || rest === "positions" || rest === "history") return undefined;
  // Strip any trailing slash/query/hash artifacts.
  const id = rest.split("/")[0].split("?")[0].split("#")[0];
  return id || undefined;
}

export function stripPublicSubdomain(hostname: string): string {
  if (hostname.startsWith("docs.")) {
    return hostname.slice("docs.".length);
  }
  if (hostname.startsWith("bet.")) {
    return hostname.slice("bet.".length);
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

export function getBetHostname(hostname: string): string {
  if (hostname.startsWith("bet.")) {
    return hostname;
  }
  if (isLocalHostname(hostname) || hostname.endsWith(".localhost")) {
    return "bet.localhost";
  }
  return PRODUCTION_BET_HOSTNAME;
}

export function getOriginForHostname(hostname: string): string {
  const port = window.location.port ? `:${window.location.port}` : "";
  return `${window.location.protocol}//${hostname}${port}`;
}

export function getDocsHref(): string {
  const hostname = window.location.hostname;
  if (isDocsHostname(hostname)) {
    return "/";
  }
  // Local dev and app subdomain both render the in-app docs at /docs.
  if (
    isLocalHostname(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("app.")
  ) {
    return LEGACY_DOCS_PATH;
  }
  return `${getOriginForHostname(getDocsHostname(hostname))}/`;
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

export function getBetHref(path: string = "/"): string {
  const hostname = window.location.hostname;

  // Already on the bet subdomain — relative paths are fine.
  if (isBetHostname(hostname)) {
    return path;
  }

  // Naked localhost uses a query-param preview because it has no product
  // subdomain in the origin.
  if (isLocalHostname(hostname)) {
    if (path === "/") return "/?bet=1";
    return `${path}${path.includes("?") ? "&" : "?"}bet=1`;
  }

  // Local app/docs subdomains need a real cross-origin hop; otherwise
  // app.localhost/?bet=1 remains pinned to the app shell.
  if (hostname.endsWith(".localhost")) {
    return `${getOriginForHostname(getBetHostname(hostname))}${path}`;
  }

  // Production cross-subdomain navigation.
  return `${getOriginForHostname(getBetHostname(hostname))}${path}`;
}

export function getInternalTargetPath(target: string): string | undefined {
  const url = new URL(target, window.location.href);
  if (url.origin !== window.location.origin) {
    return undefined;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function shouldRedirectLegacyDocsRoute(): boolean {
  const hostname = window.location.hostname;
  // Already on the docs subdomain, a local preview, or inside the app shell:
  // /docs is a valid route, do not redirect.
  if (
    isDocsHostname() ||
    isLocalHostname(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("app.")
  ) {
    return false;
  }
  return window.location.pathname === LEGACY_DOCS_PATH;
}

export function shouldRedirectLegacyBetRoute(): boolean {
  const hostname = window.location.hostname;
  if (
    isBetHostname(hostname) ||
    isLocalHostname(hostname) ||
    hostname.endsWith(".localhost")
  ) {
    return false;
  }
  return hostname === PRODUCTION_APP_HOSTNAME && isBetPath(window.location.pathname);
}

export function getCurrentRouteKey(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
