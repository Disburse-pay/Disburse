import {
  BookOpen,
  ChevronsLeft,
  Database,
  LayoutGrid,
  type LucideIcon,
  QrCode,
  Send,
} from "lucide-react";
import { cn } from "../lib/utils";

export type Page =
  | "landing"
  | "dashboard"
  | "payments"
  | "qr-payments"
  | "pay"
  | "import-export"
  | "docs";

type NavItem = {
  page: Page;
  label: string;
  href: string;
  icon: LucideIcon;
};

type Props = {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  page: Page;
  onNavigate: (e: React.MouseEvent<HTMLAnchorElement>, target: string) => void;
};

const navItems: NavItem[] = [
  { page: "dashboard",     label: "Overview",      href: "/",               icon: LayoutGrid },
  { page: "payments",      label: "Direct send",   href: "/payments",       icon: Send },
  { page: "qr-payments",   label: "QR requests",   href: "/qr-payments",    icon: QrCode },
  { page: "import-export", label: "Import · Export", href: "/import-export", icon: Database },
  { page: "docs",          label: "Documentation", href: "/docs",           icon: BookOpen },
];

export default function Sidebar({ isCollapsed, setIsCollapsed, page, onNavigate }: Props) {
  return (
    <nav
      className={cn(
        "fixed left-0 top-0 z-30 flex h-[100dvh] flex-col border-r border-[var(--line)] bg-[var(--paper)] transition-[width] duration-300",
        isCollapsed ? "w-20" : "w-60",
      )}
      aria-label="Primary"
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-[var(--line)] px-5",
          isCollapsed && "justify-center px-0",
        )}
      >
        <a
          href="/"
          onClick={(e) => onNavigate(e, "/")}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <img src="/favicon.png" alt="" className="h-5 w-5" aria-hidden="true" />
          {!isCollapsed && (
            <span className="text-[13px] font-semibold tracking-tight text-[var(--ink)]">
              Disburse
            </span>
          )}
        </a>
      </div>

      {/* Navigation items */}
      <div className="flex-1 overflow-y-auto py-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            page === item.page ||
            (item.page === "qr-payments" && page === "pay");

          return (
            <a
              key={item.page}
              href={item.href}
              onClick={(e) => onNavigate(e, item.href)}
              title={isCollapsed ? item.label : undefined}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative mx-2 flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors",
                isCollapsed && "mx-2 justify-center px-0",
                isActive
                  ? "bg-[var(--panel-accent)] text-[var(--ink)]"
                  : "text-[var(--muted)] hover:bg-[var(--line-soft)] hover:text-[var(--ink)]",
              )}
            >
              {/* Active indicator rail */}
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-all",
                  isActive ? "bg-[var(--primary-bg)]" : "bg-transparent",
                )}
                aria-hidden="true"
              />
              <Icon size={16} strokeWidth={1.75} className="flex-shrink-0" />
              {!isCollapsed && <span className="font-medium">{item.label}</span>}
            </a>
          );
        })}
      </div>

      {/* Collapse toggle */}
      <div className="border-t border-[var(--line)] p-2">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex w-full items-center justify-center gap-2 rounded-md py-2 text-[var(--muted)] transition-colors hover:bg-[var(--line-soft)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronsLeft
            size={14}
            strokeWidth={1.75}
            className={cn("transition-transform duration-300", isCollapsed && "rotate-180")}
          />
          {!isCollapsed && (
            <span className="text-[11px] font-medium">Collapse</span>
          )}
        </button>
      </div>
    </nav>
  );
}
