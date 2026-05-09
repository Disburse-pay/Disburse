import fs from "fs";

const file = "d:/Stressed/src/App.tsx";
let content = fs.readFileSync(file, "utf8");

// --- Replace TopNav ---
const topNavStart = content.indexOf("function TopNav({");
const docsPageStart = content.indexOf("function DocsPage()");
if (topNavStart === -1 || docsPageStart === -1) {
  console.error("Could not find TopNav bounds");
  process.exit(1);
}

const newTopNav = `function TopNav({
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  page,
  theme,
  account,
  chainId,
  expectedChainId,
  expectedChainLabel,
  isConnecting,
  onConnect,
  onSwitch,
  onNavigate,
  onToggleTheme
}: {
  page: Page;
  theme: Theme;
  account?: string;
  chainId?: number;
  expectedChainId: number;
  expectedChainLabel: string;
  isConnecting: boolean;
  onConnect: () => void;
  onSwitch: () => void;
  onNavigate: NavigateHandler;
  onToggleTheme: () => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (v: boolean) => void;
}) {
  const dashHref = getAppHref("/");
  const paymentsHref = getAppHref("/payments");
  const qrPaymentsHref = getAppHref("/qr-payments");
  const ieHref = getAppHref("/import-export");
  const docsHref = getDocsHref();

  return (
    <nav className={\`w-[240px] flex-shrink-0 h-[100dvh] bg-[#0A0A0A] border-r border-[#1a1a1a] flex flex-col pt-6 pb-6 \${isSidebarCollapsed ? "hidden" : ""}\`} aria-label="Primary">
      <a className="flex items-center gap-3 px-6 mb-8 text-[#eaeaea] hover:opacity-80 transition-opacity" href={dashHref} onClick={(e) => onNavigate(e, dashHref)}>
        <img src="/favicon.png" alt="" className="w-5 h-5" aria-hidden="true" />
        <strong className="text-sm tracking-widest uppercase font-medium">Disburse</strong>
      </a>
      
      <div className="flex flex-col gap-1 px-4">
        <a
          className={\`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors \${page === "dashboard" ? "bg-[#1f1f1f] text-[#eaeaea]" : "text-[#888] hover:text-[#eaeaea] hover:bg-[#1a1a1a]"}\`}
          href={dashHref} onClick={(e) => onNavigate(e, dashHref)}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Overview
        </a>
        <a
          className={\`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors \${page === "payments" ? "bg-[#1f1f1f] text-[#eaeaea]" : "text-[#888] hover:text-[#eaeaea] hover:bg-[#1a1a1a]"}\`}
          href={paymentsHref} onClick={(e) => onNavigate(e, paymentsHref)}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Direct Send
        </a>
        <a
          className={\`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors \${page === "qr-payments" || page === "pay" ? "bg-[#1f1f1f] text-[#eaeaea]" : "text-[#888] hover:text-[#eaeaea] hover:bg-[#1a1a1a]"}\`}
          href={qrPaymentsHref} onClick={(e) => onNavigate(e, qrPaymentsHref)}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
          QR Requests
        </a>
      </div>

      <div className="mt-8 px-7 mb-2 text-xs font-mono tracking-widest text-[#555] uppercase">More</div>
      <div className="flex flex-col gap-1 px-4">
        <a
          className={\`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors \${page === "import-export" ? "bg-[#1f1f1f] text-[#eaeaea]" : "text-[#888] hover:text-[#eaeaea] hover:bg-[#1a1a1a]"}\`}
          href={ieHref} onClick={(e) => onNavigate(e, ieHref)}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          Backup
        </a>
        <a
          className={\`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors \${page === "docs" ? "bg-[#1f1f1f] text-[#eaeaea]" : "text-[#888] hover:text-[#eaeaea] hover:bg-[#1a1a1a]"}\`}
          href={docsHref} onClick={(e) => onNavigate(e, docsHref)}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Documentation
        </a>
        <a className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-[#888] hover:text-[#eaeaea] hover:bg-[#1a1a1a] transition-colors" href={ARC_FAUCET_URL} target="_blank" rel="noreferrer">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
          Faucet
        </a>
      </div>

      <div className="mt-auto px-4 flex flex-col gap-3">
        <div className="px-3">
          <button
            className="flex items-center gap-3 text-[#888] hover:text-[#eaeaea] transition-colors text-sm font-medium w-full text-left"
            onClick={onToggleTheme}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            Theme
          </button>
        </div>
        <div className="px-3">
          <WalletPill
            account={account}
            chainId={chainId}
            expectedChainId={expectedChainId}
            expectedChainLabel={expectedChainLabel}
            isConnecting={isConnecting}
            onConnect={onConnect}
            onSwitch={onSwitch}
          />
        </div>
      </div>
    </nav>
  );
}

`;

content = content.substring(0, topNavStart) + newTopNav + content.substring(docsPageStart);

// --- Replace DashboardPage ---
const dashStart = content.indexOf("function DashboardPage({");
const ieStart = content.indexOf("function ImportExportPage({");
if (dashStart === -1 || ieStart === -1) {
  console.error("Could not find DashboardPage bounds");
  process.exit(1);
}

const newDashboardPage = `function DashboardPage({
  requests, receipts, account, rpcHealth, rpcStatusLabel, rpcBlockLabel, now, onNavigate, onExport
}: {
  requests: PaymentRequest[];
  receipts: Receipt[];
  account?: \`0x\${string}\`;
  rpcHealth?: RpcHealth;
  rpcStatusLabel: string;
  rpcBlockLabel: string;
  now: Date;
  onNavigate: (target: string) => void;
  onExport: () => void;
}) {
  const totalVolume = requests.reduce((s, r) => { try { return s + Number(r.amount); } catch { return s; } }, 0);
  const verifiedVolume = requests.filter(r => r.status === "paid").reduce((s, r) => { try { return s + Number(r.amount); } catch { return s; } }, 0);
  const pendingVolume = requests.filter(r => r.status === "open").reduce((s, r) => { try { return s + Number(r.amount); } catch { return s; } }, 0);
  const recent = [...requests].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);

  return (
    <div className="flex-1 bg-[#050505] text-[#eaeaea] p-8 overflow-y-auto font-sans">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Disburse overview</h1>
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] rounded text-sm text-[#888] border border-[#222]">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            Search or command <span className="ml-2 px-1.5 py-0.5 bg-[#222] rounded text-[10px]">⌘ K</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left Column */}
        <div className="flex flex-col gap-6">
          {/* Main Balance Card */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#121A2F] to-[#1F2942] border border-[#2D3B5E]/50 p-8 min-h-[220px] flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 blur-[100px] rounded-full pointer-events-none -translate-y-1/2 translate-x-1/3"></div>
            <div>
              <p className="text-blue-200/60 text-sm mb-2 font-medium">Total requested volume</p>
              <h2 className="text-5xl font-semibold tracking-tight text-white">{totalVolume.toFixed(2)} <span className="text-2xl text-blue-200/50">USDC</span></h2>
            </div>
            <div className="flex items-center gap-3 mt-8">
              <button className="px-5 py-2 bg-white text-black font-medium rounded-lg text-sm hover:bg-gray-100 transition-colors" onClick={() => onNavigate("/qr-payments")}>
                Create request
              </button>
              <button className="px-5 py-2 border border-white/20 text-white font-medium rounded-lg text-sm hover:bg-white/10 transition-colors" onClick={() => onNavigate("/payments")}>
                Direct send
              </button>
            </div>
          </div>

          {/* Transactions Card */}
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6 min-h-[400px]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <svg className="w-4 h-4 text-[#888]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
                Requests
              </h3>
              <select className="bg-transparent border border-[#222] text-sm text-[#888] rounded px-2 py-1 outline-none">
                <option>All time</option>
              </select>
            </div>

            {recent.length > 0 ? (
              <table className="w-full text-sm text-left">
                <thead className="text-[#666] border-b border-[#1a1a1a]">
                  <tr>
                    <th className="pb-3 font-medium">Reference</th>
                    <th className="pb-3 font-medium">To/From</th>
                    <th className="pb-3 font-medium text-right">Amount</th>
                    <th className="pb-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a]">
                  {recent.map(r => {
                    const d = refreshDerivedStatus(r, now);
                    return (
                      <tr key={r.id} className="hover:bg-[#151515] transition-colors group cursor-pointer" onClick={() => onNavigate(\`/pay?r=\${encodeRequestPayload(r)}\`)}>
                        <td className="py-4 text-[#eaeaea]">{r.label}</td>
                        <td className="py-4 text-[#888] font-mono">{shortAddress(r.recipient)}</td>
                        <td className="py-4 text-right text-[#eaeaea]">{r.amount} {r.token}</td>
                        <td className="py-4 text-right">
                          <StatusBadge status={d.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="flex flex-col items-center justify-center h-[250px] text-[#666]">
                <svg className="w-8 h-8 mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>
                <p className="font-medium text-[#eaeaea] mb-1">No requests yet</p>
                <p className="text-sm">Make your first request by clicking create</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-6">
          {/* Stats Widget */}
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-[#888] flex items-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                Verified NET
              </h3>
            </div>
            <div className="mb-6">
              <span className="text-3xl font-semibold text-[#10b981]">+{verifiedVolume.toFixed(2)}</span>
            </div>
            <div className="flex border-t border-[#1a1a1a] pt-4 gap-6">
              <div>
                <div className="text-white font-medium mb-1">{verifiedVolume.toFixed(2)}</div>
                <div className="text-xs text-[#888]">Verified</div>
              </div>
              <div className="border-l border-[#1a1a1a] pl-6">
                <div className="text-white font-medium mb-1">{pendingVolume.toFixed(2)}</div>
                <div className="text-xs text-[#888]">Pending</div>
              </div>
            </div>
          </div>

          {/* Verification Health Widget */}
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-[40px] rounded-full"></div>
            <h3 className="text-sm font-medium text-[#eaeaea] mb-4">System Status</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-[#888]">Network</span>
                <span className="font-mono text-xs bg-[#1a1a1a] px-2 py-1 rounded">Arc Testnet ({ARC_CHAIN_ID})</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-[#888]">RPC Health</span>
                <span className="text-[#eaeaea]">{rpcStatusLabel}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-[#888]">Latest Block</span>
                <span className="font-mono text-xs">{rpcBlockLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
`;

content = content.substring(0, dashStart) + newDashboardPage + content.substring(ieStart);

// Remove the context-header from site-shell since the new DashboardPage provides its own
// Actually, other pages (Payments, QR, Import) still need a header or maybe they have their own now?
// Let's modify the app-main wrapper in App function to not have the global header if page === "dashboard"
const appMainStart = content.indexOf('<div className="app-main">');
const newAppMain = `<div className="app-main">
        {page !== "dashboard" && (
          <header className="context-header">
            <div className="context-header-left">
              {isSidebarCollapsed && (
                <button className="sidebar-toggle-btn" onClick={() => setIsSidebarCollapsed(false)} aria-label="Open Sidebar">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                </button>
              )}
              <span className="context-title">{page.charAt(0).toUpperCase() + page.slice(1).replace("-", " ")}</span>
            </div>
            <div className="context-header-right">
              <WalletPill account={account} chainId={chainId} expectedChainId={commonShellProps.expectedChainId} expectedChainLabel={commonShellProps.expectedChainLabel} isConnecting={isConnecting} onConnect={handleConnectWallet} onSwitch={commonShellProps.onSwitch} />
            </div>
          </header>
        )}`;
content = content.replace(/<div className="app-main">[\s\S]*?<\/header>/, newAppMain);

fs.writeFileSync(file, content);
console.log("Patched successfully");
