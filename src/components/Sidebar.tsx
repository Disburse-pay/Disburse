import { 
  LayoutGrid, 
  ArrowRightLeft, 
  Network, 
  CreditCard, 
  Users, 
  ReceiptText, 
  Receipt, 
  WalletCards,
  LifeBuoy,
  Settings,
  LogOut,
  ChevronsLeftRight,
  QrCode,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
  BookOpen,
  ShieldCheck,
  Send,
  Home
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { LucideIcon } from "lucide-react";
import { ARC_FAUCET_URL } from "@/src/lib/arc";

type NavigateHandler = (event: React.MouseEvent<HTMLAnchorElement>, target: string) => void;

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (val: boolean) => void;
  page: string;
  onNavigate: NavigateHandler;
}

const navItems: Array<{ icon: LucideIcon; label: string; href: string }> = [
  { icon: LayoutGrid, label: "Overview", href: "/" },
  { icon: QrCode, label: "QR Payments", href: "/qr-payments" },
  { icon: ArrowRightLeft, label: "Payments", href: "/payments" },
];

const moreItems: Array<{ icon: LucideIcon; label: string; href: string }> = [
  { icon: Download, label: "Backup", href: "/import-export" },
  { icon: BookOpen, label: "Documentation", href: "/docs" },
  { icon: ShieldCheck, label: "Faucet", href: ARC_FAUCET_URL },
];

const bottomItems: Array<{ icon: LucideIcon; label: string; action: string }> = [
  { icon: LifeBuoy, label: "Feedback", action: "feedback" },
  { icon: Settings, label: "Settings", action: "settings" },
];

export default function Sidebar({ isCollapsed, setIsCollapsed, page, onNavigate }: SidebarProps) {
  const dashHref = "/";
  const qrPaymentsHref = "/qr-payments";
  const paymentsHref = "/payments";
  const ieHref = "/import-export";

  function getNavHref(item: typeof navItems[number]): string {
    if (item.label === "Overview") return dashHref;
    if (item.label === "QR Payments") return qrPaymentsHref;
    if (item.label === "Payments") return paymentsHref;
    return item.href;
  }

  function getMoreHref(item: typeof moreItems[number]): string {
    if (item.label === "Backup") return ieHref;
    return item.href;
  }

  function isActive(label: string): boolean {
    if (label === "Overview") return page === "dashboard";
    if (label === "QR Payments") return page === "qr-payments" || page === "pay";
    if (label === "Payments") return page === "payments";
    if (label === "Backup") return page === "import-export";
    if (label === "Documentation") return page === "docs";
    return false;
  }

  return (
    <div className={cn("h-screen border-r border-brand-border flex flex-col fixed left-0 top-0 bg-brand-dark z-50 transition-all duration-300", isCollapsed ? "w-20 py-6 items-center" : "w-64 p-4")}>
      <div className={cn("flex items-center mb-8", isCollapsed ? "flex-col gap-4 w-full" : "justify-between px-2 w-full")}>
        {isCollapsed ? (
          <button onClick={() => setIsCollapsed(false)} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-muted hover:text-white hover:bg-brand-surface">
            <PanelLeftOpen className="w-4 h-4" strokeWidth={1.5} />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center">
                <img src="/favicon.png" alt="Disburse" className="w-5 h-5 object-contain invert" />
              </div>
              <div>
                <h1 className="font-medium text-sm line-clamp-1 tracking-tight">Disburse</h1>
                <p className="text-[10px] text-muted uppercase tracking-widest font-mono">Arc Testnet</p>
              </div>
            </div>
            <button onClick={() => setIsCollapsed(true)} className="p-1 rounded-lg hover:bg-brand-surface text-muted hover:text-white transition-colors">
              <PanelLeftClose className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>

      <nav className={cn("flex-1 w-full flex flex-col space-y-2", isCollapsed ? "items-center px-3" : "px-2")}>
        {navItems.map((item) => (
          <NavItem 
            key={item.label} 
            icon={item.icon} 
            label={item.label} 
            active={isActive(item.label)} 
            isCollapsed={isCollapsed}
            href={getNavHref(item)}
            onNavigate={onNavigate}
          />
        ))}

        <div className={cn("transition-all", isCollapsed ? "w-8 h-px bg-brand-border my-4" : "pt-6 pb-2 px-2 text-[10px] font-medium text-muted uppercase tracking-widest font-mono")}>
          {!isCollapsed && "More"}
        </div>

        {moreItems.map((item) => (
          <NavItem 
            key={item.label} 
            icon={item.icon} 
            label={item.label} 
            active={isActive(item.label)} 
            isCollapsed={isCollapsed}
            href={getMoreHref(item)}
            onNavigate={onNavigate}
            external={item.label === "Faucet"}
          />
        ))}
      </nav>

      <div className={cn("w-full flex flex-col pt-4 border-t border-brand-border", isCollapsed ? "items-center space-y-3 px-3" : "space-y-1 px-2")}>
        {bottomItems.map((item) => (
          <NavItem 
            key={item.label} 
            icon={item.icon} 
            label={item.label} 
            active={item.action === "settings" && page === "settings"}
            isCollapsed={isCollapsed}
            onClick={item.action === "feedback" ? () => window.open("https://x.com/Disburs3", "_blank", "noreferrer") : item.action === "settings" ? () => onNavigate({ preventDefault: () => {} } as React.MouseEvent<HTMLAnchorElement>, "/settings") : undefined}
          />
        ))}
      </div>
    </div>
  );
}

interface NavItemProps {
  icon: any;
  label: string;
  active?: boolean;
  key?: string;
  isCollapsed?: boolean;
  href?: string;
  onNavigate?: NavigateHandler;
  external?: boolean;
  onClick?: () => void;
}

function NavItem({ icon: Icon, label, active, isCollapsed, href, onNavigate, external, onClick }: NavItemProps) {
  if (href && onNavigate) {
    return (
      <a
        href={href}
        title={isCollapsed ? label : undefined}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        onClick={external ? undefined : (event) => onNavigate(event, href!)}
        className={cn(
          "flex items-center transition-all duration-200 relative group no-underline",
          isCollapsed ? "w-10 h-10 justify-center rounded-lg" : "w-full gap-3 px-3 py-2 text-sm text-left rounded-md",
          active ? "bg-brand-surface text-white" : "text-muted hover:text-white hover:bg-brand-surface"
        )}
      >
          <Icon className="shrink-0 w-4 h-4" strokeWidth={1.5} />
        {!isCollapsed && <span className="truncate">{label}</span>}
        {active && (
          <div 
            className={cn("absolute bg-brand-blue", isCollapsed ? "left-0 w-0.5 h-5 rounded-r-full" : "ml-auto right-3 w-1 h-1 rounded-full")}
          />
        )}
      </a>
    );
  }

  return (
    <button 
      title={isCollapsed ? label : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center transition-all duration-200 relative group",
        isCollapsed ? "w-10 h-10 justify-center rounded-lg" : "w-full gap-3 px-3 py-2 text-sm text-left rounded-md",
        active ? "bg-brand-surface text-white" : "text-muted hover:text-white hover:bg-brand-surface"
      )}>
      <Icon className="shrink-0 w-4 h-4" strokeWidth={1.5} />
      {!isCollapsed && <span className="truncate">{label}</span>}
      {active && (
        <div 
          className={cn("absolute bg-brand-blue", isCollapsed ? "left-0 w-0.5 h-5 rounded-r-full" : "ml-auto right-3 w-1 h-1 rounded-full")}
        />
      )}
    </button>
  );
}
