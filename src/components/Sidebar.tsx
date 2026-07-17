import {
  BookOpen,
  ChevronsLeft,
  Database,
  ExternalLink,
  FileText,
  LayoutGrid,
  type LucideIcon,
  QrCode,
  Send,
} from "lucide-react";
import { useI18n } from "../lib/i18n";
import { getDocsHref, type Page } from "../lib/routing";
import { cn } from "../lib/utils";

export type { Page };

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
  { page: "statements",    labelKey: "statements",    href: "/statements",     icon: FileText,   group: "manage"  },
  { page: "import-export", labelKey: "backup",        href: "/import-export",  icon: Database,   group: "manage"  },
  { page: "docs",          labelKey: "documentation", href: "/docs",           icon: BookOpen,   group: "reference" },
];

/**
 * Primary navigation rail. Quiet, plain-language group headings, calm
 * active state, no mono-uppercase chrome.
 */
export default function Sidebar({ isCollapsed: rawCollapsed, setIsCollapsed, page, onNavigate, inDrawer = false }: Props) {
  const { t } = useI18n();
  const groups: NavItem["group"][] = ["operate", "manage", "reference"];
  const isCollapsed = inDrawer ? false : rawCollapsed;
  // Labels stay mounted and clip/fade during the width transition so the
  // rail and its contents animate as one piece instead of popping.
  const labelCls = cn(
    "whitespace-nowrap transition-opacity duration-200",
    isCollapsed ? "opacity-0" : "opacity-100",
  );

  return (
    <nav
      className={cn(
        "flex flex-col",
        inDrawer
          ? "h-full w-full bg-[var(--paper)]"
          : cn(
              // Desktop rail sits directly on the shell frame — no background
              // of its own, no border; the content sheet's edge separates.
              "fixed left-0 top-0 z-30 h-[100dvh] bg-[var(--shell-frame)] transition-[width] duration-300",
              isCollapsed ? "w-[56px]" : "w-[240px]",
            ),
      )}
      aria-label="Primary"
    >
      {/* Brand — constant padding keeps the logo at the same x in both
          states, so only the label clips away. */}
      <div className="flex h-[64px] items-center px-[18px]">
        <a
          href="/"
          onClick={(e) => onNavigate(e, "/")}
          className="flex items-center gap-2.5 overflow-hidden transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          aria-label="Disburse home"
        >
          <img src="/favicon.png" alt="" className="h-[20px] w-[20px] flex-shrink-0" aria-hidden="true" />
          <span className={cn("text-lg font-semibold leading-none tracking-[-0.012em] text-[var(--ink)]", labelCls)}>
            Disburse
          </span>
        </a>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4">
        {groups.map((group, gi) => {
          const items = navItems.filter((i) => i.group === group);
          return (
            <div key={group} className={cn("py-1.5", gi > 0 && "mt-4")}>
              <p className={cn("mb-2 overflow-hidden px-5 text-xs font-medium text-[var(--muted)]", labelCls)}>
                {t(group)}
              </p>
              {items.map((item) => {
                const Icon = item.icon;
                // Documentation lives on the dedicated docs subdomain; link
                // there (cross-origin) rather than the in-app /docs route.
                const isDocs = item.page === "docs";
                const href = isDocs ? getDocsHref() : item.href;
                const isActive =
                  !isDocs &&
                  (page === item.page ||
                    (item.page === "qr-payments" && page === "pay"));
                const itemLabel = t(item.labelKey);

                return (
                  <a
                    key={item.page}
                    href={href}
                    onClick={(e) => onNavigate(e, href)}
                    title={isCollapsed ? itemLabel : undefined}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      // px stays constant: the 16px icon sits centered in the
                      // 40px collapsed item, so it never shifts horizontally.
                      "relative mx-2 flex items-center gap-3 overflow-hidden rounded-md px-3 py-[7px] text-base transition-colors",
                      isActive
                        ? "bg-[var(--shell-active)] text-[var(--ink)] font-medium shadow-[0_0_0_1px_var(--line)]"
                        : "text-[var(--muted)] hover:bg-[var(--shell-active)] hover:text-[var(--ink)]",
                    )}
                  >
                    <Icon
                      size={16}
                      strokeWidth={1.75}
                      className={cn(
                        "flex-shrink-0 transition-colors",
                        isActive ? "text-[var(--ink)]" : "text-[var(--muted)]",
                      )}
                    />
                    <span className={labelCls}>{itemLabel}</span>
                    {isDocs && (
                      <ExternalLink
                        size={12}
                        strokeWidth={1.75}
                        className={cn("ml-auto flex-shrink-0 text-[var(--muted-soft)]", labelCls)}
                        aria-hidden="true"
                      />
                    )}
                  </a>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer: collapse toggle. (The network/wallet card lived here too,
          but it duplicated the Header status and Settings → Network.) */}
      <div className="p-3">
        {!inDrawer && (
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex w-full items-center justify-center gap-2 overflow-hidden rounded-md py-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--shell-active)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            aria-label={isCollapsed ? t("expandSidebar") : t("collapseSidebar")}
          >
            <ChevronsLeft
              size={14}
              strokeWidth={1.75}
              className={cn("flex-shrink-0 transition-transform duration-300", isCollapsed && "rotate-180")}
            />
            {!isCollapsed && <span className="whitespace-nowrap text-sm font-medium">{t("collapse")}</span>}
          </button>
        )}
      </div>
    </nav>
  );
}
