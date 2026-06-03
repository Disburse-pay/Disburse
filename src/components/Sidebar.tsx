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
  account?: string;
  inDrawer?: boolean;
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
  operate: "Operate",
  manage: "Manage",
  reference: "Reference",
};

/**
 * Primary navigation rail. Quiet, plain-language group headings, calm
 * active state, no mono-uppercase chrome.
 */
export default function Sidebar({ isCollapsed: rawCollapsed, setIsCollapsed, page, onNavigate, account, inDrawer = false }: Props) {
  const { t } = useI18n();
  const groups: NavItem["group"][] = ["operate", "manage", "reference"];
  const shortAddr = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : null;
  const isCollapsed = inDrawer ? false : rawCollapsed;

  return (
    <nav
      className={cn(
        "flex flex-col bg-[var(--paper)]",
        inDrawer
          ? "h-full w-full"
          : cn(
              "fixed left-0 top-0 z-30 h-[100dvh] border-r border-[var(--line)] transition-[width] duration-300",
              isCollapsed ? "w-[56px]" : "w-[240px]",
            ),
      )}
      aria-label="Primary"
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-[64px] items-center border-b border-[var(--line)]",
          isCollapsed ? "justify-center" : "px-5",
        )}
      >
        <a
          href="/"
          onClick={(e) => onNavigate(e, "/")}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          aria-label="Disburse home"
        >
          <img src="/favicon.png" alt="" className="h-[20px] w-[20px]" aria-hidden="true" />
          {!isCollapsed && (
            <span className="text-[15px] font-semibold leading-none tracking-[-0.012em] text-[var(--ink)]">
              Disburse
            </span>
          )}
        </a>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4">
        {(() => {
          const betHref = getBetHref("/");
          const betLabel = "Markets";
          return (
            <div className="mb-2 border-b border-[var(--line-soft)] pb-3">
              {!isCollapsed && (
                <p className="mb-2 px-5 text-[11.5px] font-medium text-[var(--muted)]">
                  Products
                </p>
              )}
              <a
                href={betHref}
                onClick={(e) => onNavigate(e, betHref)}
                title={isCollapsed ? betLabel : undefined}
                className={cn(
                  "mx-2 flex items-center gap-3 rounded-md px-3 py-[7px] text-[13.5px] text-[var(--muted)] transition-colors hover:bg-[var(--paper-2)] hover:text-[var(--ink)]",
                  isCollapsed && "mx-2 justify-center px-0",
                )}
              >
                <BarChart3 size={16} strokeWidth={1.75} className="flex-shrink-0" />
                {!isCollapsed && (
                  <>
                    <span className="font-medium">{betLabel}</span>
                    <ExternalLink size={12} strokeWidth={1.75} className="ml-auto text-[var(--muted-soft)]" aria-hidden="true" />
                  </>
                )}
              </a>
            </div>
          );
        })()}
        {groups.map((group, gi) => {
          const items = navItems.filter((i) => i.group === group);
          return (
            <div key={group} className={cn("py-1.5", gi > 0 && "mt-2 border-t border-[var(--line-soft)] pt-3")}>
              {!isCollapsed && (
                <p className="mb-2 px-5 text-[11.5px] font-medium text-[var(--muted)]">
                  {GROUP_LABEL[group]}
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
                      "relative mx-2 flex items-center gap-3 rounded-md px-3 py-[7px] text-[13.5px] transition-colors",
                      isCollapsed && "mx-2 justify-center px-0",
                      isActive
                        ? "bg-[var(--paper-2)] text-[var(--ink)] font-medium"
                        : "text-[var(--muted)] hover:bg-[var(--paper-2)] hover:text-[var(--ink)]",
                    )}
                  >
                    {/* Subtle indigo bar for active. */}
                    {isActive && !isCollapsed && (
                      <span
                        className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-[var(--primary-bg)]"
                        aria-hidden="true"
                      />
                    )}
                    <Icon
                      size={16}
                      strokeWidth={1.75}
                      className={cn(
                        "flex-shrink-0 transition-colors",
                        isActive ? "text-[var(--ink)]" : "text-[var(--muted)]",
                      )}
                    />
                    {!isCollapsed && <span>{itemLabel}</span>}
                  </a>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer: wallet status + collapse toggle */}
      <div className="border-t border-[var(--line)] p-3">
        {!isCollapsed && (
          <div className="mb-2 rounded-md border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-medium text-[var(--muted)]">Network</p>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--muted)]">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    account ? "bg-[var(--ink)]" : "bg-[var(--muted-soft)]",
                  )}
                  aria-hidden="true"
                />
                {account ? "Live" : "Idle"}
              </span>
            </div>
            <p className="mt-1.5 text-[12.5px] text-[var(--ink)]">Arc Testnet</p>
            {shortAddr && (
              <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--muted)]">{shortAddr}</p>
            )}
          </div>
        )}
        {!inDrawer && (
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--paper-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            aria-label={isCollapsed ? t("expandSidebar") : t("collapseSidebar")}
          >
            <ChevronsLeft
              size={14}
              strokeWidth={1.75}
              className={cn("transition-transform duration-300", isCollapsed && "rotate-180")}
            />
            {!isCollapsed && <span className="text-[12px] font-medium">{t("collapse")}</span>}
          </button>
        )}
      </div>
    </nav>
  );
}
