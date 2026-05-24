import {
  BarChart3,
  BookOpen,
  ChevronsLeft,
  Database,
  ExternalLink,
  FileText,
  LayoutGrid,
  type LucideIcon,
  Milestone,
  QrCode,
  Send,
} from "lucide-react";
import { useI18n } from "../lib/i18n";
import { getBetHref } from "../lib/routing";
import { cn } from "../lib/utils";

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

type NavItem = {
  page: Page;
  labelKey: string;
  href: string;
  icon: LucideIcon;
  group: "operate" | "manage" | "reference";
};

type Props = {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  page: Page;
  onNavigate: (e: React.MouseEvent<HTMLAnchorElement>, target: string) => void;
  /** Optional connected wallet address; enables the footer status row. */
  account?: string;
};

const navItems: NavItem[] = [
  { page: "dashboard",     labelKey: "overview",      href: "/",               icon: LayoutGrid, group: "operate" },
  { page: "qr-payments",   labelKey: "qrPayments",    href: "/qr-payments",    icon: QrCode,     group: "operate" },
  { page: "payments",      labelKey: "directSend",    href: "/payments",       icon: Send,       group: "operate" },
  { page: "milestones",    labelKey: "milestones",    href: "/milestones",     icon: Milestone,  group: "operate" },
  { page: "statements",    labelKey: "statements",    href: "/statements",     icon: FileText,   group: "manage"  },
  { page: "import-export", labelKey: "backup",        href: "/import-export",  icon: Database,   group: "manage"  },
  { page: "docs",          labelKey: "documentation", href: "/docs",           icon: BookOpen,   group: "reference" },
];

const GROUP_LABEL: Record<NavItem["group"], string> = {
  operate: "operate",
  manage: "manage",
  reference: "referenceSection",
};

/**
 * Primary navigation rail. Fixed width, never collapses by accident.
 * Grouped into three simple categories so the nav feels curated, not
 * arbitrary. A small wallet status row lives in the footer when a
 * wallet address is provided.
 */
export default function Sidebar({ isCollapsed, setIsCollapsed, page, onNavigate, account }: Props) {
  const { t } = useI18n();
  const groups: NavItem["group"][] = ["operate", "manage", "reference"];
  const shortAddr = account ? `${account.slice(0, 6)}\u2009\u2009${account.slice(-4)}` : null;

  return (
    <nav
      className={cn(
        "fixed left-0 top-0 z-30 flex h-[100dvh] flex-col border-r border-[var(--line)] bg-[var(--paper)] transition-[width] duration-300",
        isCollapsed ? "w-[56px]" : "w-[236px]",
      )}
      aria-label="Primary"
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-[56px] items-center border-b border-[var(--line)]",
          isCollapsed ? "justify-center" : "px-5",
        )}
      >
        <a
          href="/"
          onClick={(e) => onNavigate(e, "/")}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          aria-label="Disburse home"
        >
          <img src="/favicon.png" alt="" className="h-[18px] w-[18px]" aria-hidden="true" />
          {!isCollapsed && (
            <span className="flex items-baseline gap-2">
              <span className="text-[13px] font-semibold leading-none tracking-[-0.01em] text-[var(--ink)]">
                Disburse
              </span>
              <span className="rounded-sm border border-[var(--line)] bg-[var(--input-bg)] px-1.5 py-[1px] font-mono text-[8.5px] uppercase leading-none tracking-[0.16em] text-[var(--muted)]">
                Testnet
              </span>
            </span>
          )}
        </a>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-3">
        {(() => {
          // Cross-subdomain link to the prediction-markets shell. Rendered as a
          // peer of the main nav groups but visually separated as a sibling
          // product surface, not an in-app route.
          const betHref = getBetHref("/");
          const betLabel = "Bet";
          return (
            <div className="border-b border-[var(--line-soft)] pb-3">
              {!isCollapsed && (
                <p className="mb-1.5 px-5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted-soft)]">
                  products
                </p>
              )}
              <a
                href={betHref}
                onClick={(e) => onNavigate(e, betHref)}
                title={isCollapsed ? betLabel : undefined}
                className={cn(
                  "relative mx-2 flex items-center gap-3 rounded-[var(--btn-radius)] px-3 py-[7px] text-[12.5px] text-[var(--muted)] transition-colors hover:bg-[var(--line-soft)]/70 hover:text-[var(--ink)]",
                  isCollapsed && "mx-2 justify-center px-0",
                )}
              >
                <BarChart3
                  size={15}
                  strokeWidth={1.6}
                  className="flex-shrink-0 text-[var(--muted)] transition-colors"
                />
                {!isCollapsed && (
                  <>
                    <span className="font-medium">{betLabel}</span>
                    <ExternalLink
                      size={11}
                      strokeWidth={1.6}
                      className="ml-auto text-[var(--muted-soft)]"
                      aria-hidden="true"
                    />
                  </>
                )}
              </a>
            </div>
          );
        })()}
        {groups.map((group) => {
          const items = navItems.filter((i) => i.group === group);
          return (
            <div key={group} className={cn("py-1.5", group !== "operate" && "border-t border-[var(--line-soft)] mt-1.5 pt-3")}>
              {!isCollapsed && (
                <p className="mb-1.5 px-5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted-soft)]">
                  {t(GROUP_LABEL[group])}
                </p>
              )}
              {items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  page === item.page ||
                  (item.page === "qr-payments" && page === "pay");
                const itemLabel = t(item.labelKey);

                return (
                  <a
                    key={item.page}
                    href={item.href}
                    onClick={(e) => onNavigate(e, item.href)}
                    title={isCollapsed ? itemLabel : undefined}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative mx-2 flex items-center gap-3 rounded-[var(--btn-radius)] px-3 py-[7px] text-[12.5px] transition-colors",
                      isCollapsed && "mx-2 justify-center px-0",
                      isActive
                        ? "bg-[var(--line-soft)] text-[var(--ink)]"
                        : "text-[var(--muted)] hover:bg-[var(--line-soft)]/70 hover:text-[var(--ink)]",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r transition-all",
                        isActive ? "bg-[var(--primary-bg)]" : "bg-transparent",
                      )}
                      aria-hidden="true"
                    />
                    <Icon
                      size={15}
                      strokeWidth={1.6}
                      className={cn(
                        "flex-shrink-0 transition-colors",
                        isActive ? "text-[var(--ink)]" : "text-[var(--muted)]",
                      )}
                    />
                    {!isCollapsed && <span className="font-medium">{itemLabel}</span>}
                  </a>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer: wallet status + network hint + collapse toggle */}
      <div className="border-t border-[var(--line)] p-2">
        {!isCollapsed && (
          <div className="mb-2 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
                {t("network")}
              </p>
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.16em]",
                  account ? "text-[var(--green-text)]" : "text-[var(--muted)]",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    account ? "bg-[var(--green-text)]" : "bg-[var(--muted-soft)]",
                  )}
                  aria-hidden="true"
                />
                {account ? "Live" : "Idle"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--ink)]">
              Arc Testnet
              <span className="mx-1.5 text-[var(--line-strong)]">&middot;</span>
              <span className="font-mono text-[var(--muted)]">5042002</span>
            </p>
            {shortAddr && (
              <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted)]">
                {shortAddr}
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex w-full items-center justify-center gap-2 rounded-[var(--btn-radius)] py-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--line-soft)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          aria-label={isCollapsed ? t("expandSidebar") : t("collapseSidebar")}
        >
          <ChevronsLeft
            size={13}
            strokeWidth={1.6}
            className={cn("transition-transform duration-300", isCollapsed && "rotate-180")}
          />
          {!isCollapsed && <span className="text-[10.5px] font-medium">{t("collapse")}</span>}
        </button>
      </div>
    </nav>
  );
}
