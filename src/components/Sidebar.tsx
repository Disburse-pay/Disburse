import { cn } from "../lib/utils";

export type Page =
  | "landing"
  | "dashboard"
  | "payments"
  | "qr-payments"
  | "pay"
  | "import-export"
  | "docs"
  | "settings";

type NavItem = {
  page: Page;
  label: string;
  href: string;
  icon: React.ReactNode;
  section?: string;
};

type Props = {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  page: Page;
  onNavigate: (e: React.MouseEvent<HTMLAnchorElement>, target: string) => void;
};

const NAV_ICON_CLASS = "w-4 h-4 flex-shrink-0";

const navItems: NavItem[] = [
  {
    page: "dashboard",
    label: "Overview",
    href: "/",
    icon: (
      <svg className={NAV_ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    page: "payments",
    label: "Direct Send",
    href: "/payments",
    icon: (
      <svg className={NAV_ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" x2="11" y1="2" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
    ),
  },
  {
    page: "qr-payments",
    label: "QR Requests",
    href: "/qr-payments",
    icon: (
      <svg className={NAV_ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect width="5" height="5" x="3" y="3" rx="1" /><rect width="5" height="5" x="16" y="3" rx="1" /><rect width="5" height="5" x="3" y="16" rx="1" />
        <path d="M21 16h-3a2 2 0 0 0-2 2v3" /><path d="M21 21v.01" /><path d="M12 7v3a2 2 0 0 1-2 2H7" />
      </svg>
    ),
  },
  {
    page: "import-export",
    label: "Backup",
    href: "/import-export",
    section: "System",
    icon: (
      <svg className={NAV_ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />
      </svg>
    ),
  },
  {
    page: "docs",
    label: "Documentation",
    href: "/docs",
    icon: (
      <svg className={NAV_ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" />
      </svg>
    ),
  },
  {
    page: "settings",
    label: "Settings",
    href: "/settings",
    icon: (
      <svg className={NAV_ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
];

export default function Sidebar({ isCollapsed, setIsCollapsed, page, onNavigate }: Props) {
  let lastSection: string | undefined;

  return (
    <nav
      className={cn(
        "fixed left-0 top-0 h-[100dvh] bg-[#070707] border-r border-brand-border flex flex-col z-30 transition-all duration-300",
        isCollapsed ? "w-20" : "w-64"
      )}
      aria-label="Primary"
    >
      {/* Brand */}
      <div className={cn(
        "flex items-center border-b border-brand-border h-14 px-5",
        isCollapsed && "justify-center px-0"
      )}>
        <a href="/" onClick={(e) => onNavigate(e, "/")} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <img src="/favicon.png" alt="" className="w-5 h-5" aria-hidden="true" />
          {!isCollapsed && (
            <span className="text-[11px] tracking-[0.2em] uppercase font-semibold text-white">
              Disburse
            </span>
          )}
        </a>
      </div>

      {/* Navigation items */}
      <div className="flex-1 py-4 overflow-y-auto">
        {navItems.map((item) => {
          const showSection = !isCollapsed && item.section && item.section !== lastSection;
          if (item.section) lastSection = item.section;

          const isActive = page === item.page || (item.page === "qr-payments" && page === "pay");

          return (
            <div key={item.page}>
              {showSection && (
                <p className="px-5 mt-6 mb-2 text-[9px] font-mono uppercase tracking-[0.2em] text-[#444]">
                  {item.section}
                </p>
              )}
              <a
                href={item.href}
                onClick={(e) => onNavigate(e, item.href)}
                className={cn(
                  "flex items-center gap-3 mx-2 px-3 py-2 text-sm transition-all duration-150",
                  isCollapsed && "justify-center px-0 mx-1",
                  isActive
                    ? "bg-white/[0.06] text-white border-l-2 border-white/40"
                    : "text-[#666] hover:text-[#aaa] hover:bg-white/[0.02] border-l-2 border-transparent"
                )}
                title={isCollapsed ? item.label : undefined}
              >
                {item.icon}
                {!isCollapsed && (
                  <span className="text-[13px] font-medium">{item.label}</span>
                )}
              </a>
            </div>
          );
        })}
      </div>

      {/* Collapse toggle */}
      <div className="border-t border-brand-border p-3">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full flex items-center justify-center gap-2 py-2 text-[#555] hover:text-white transition-colors"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            className={cn("w-4 h-4 transition-transform duration-300", isCollapsed && "rotate-180")}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M11 17l-5-5 5-5" /><path d="M18 17l-5-5 5-5" />
          </svg>
          {!isCollapsed && (
            <span className="text-[10px] font-mono uppercase tracking-widest">Collapse</span>
          )}
        </button>
      </div>

      {/* Version badge */}
      {!isCollapsed && (
        <div className="px-5 pb-4">
          <div className="flex items-center gap-2 text-[9px] font-mono text-[#333]">
            <span className="w-1 h-1 rounded-full bg-emerald-500/60" />
            <span>v1.3.0 — Arc Testnet</span>
          </div>
        </div>
      )}
    </nav>
  );
}
