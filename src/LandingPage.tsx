import React, { useEffect, useRef } from "react";

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return ref;
}

const ArrowRightIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
);

const ShieldIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);

const FileIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/></svg>
);

const LayersIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
);

export default function LandingPage() {
  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const appUrl = isLocal ? "http://app.localhost:5173" : "https://app.disburse.online";

  return (
    <div className="min-h-screen bg-[#050505] text-[#eaeaea] font-sans overflow-x-hidden selection:bg-[#eaeaea] selection:text-[#050505]">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        :root {
          --matte-black: #050505;
          --old-white: #eaeaea;
          --border-color: #1a1a1a;
          --muted-text: #888888;
          --accent: #34d399;
        }
        body {
          background-color: var(--matte-black);
          color: var(--old-white);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
          letter-spacing: -0.01em;
        }
        .reveal-hidden { opacity: 0; transform: translateY(15px); transition: opacity 0.8s ease-out, transform 0.8s ease-out; }
        .reveal-visible { opacity: 1; transform: translateY(0); }
        .delay-1 { transition-delay: 0.1s; }
        .delay-2 { transition-delay: 0.2s; }
        .delay-3 { transition-delay: 0.3s; }
        .delay-4 { transition-delay: 0.4s; }
        .delay-5 { transition-delay: 0.5s; }
        
        .grid-bg {
          background-size: 40px 40px;
          background-image: linear-gradient(to right, #111 1px, transparent 1px),
                            linear-gradient(to bottom, #111 1px, transparent 1px);
          mask-image: radial-gradient(circle at center, black, transparent 80%);
        }
        .grain-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.03;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-repeat: repeat;
          background-size: 128px 128px;
        }
        .feature-watermark {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 16rem;
          font-weight: 500;
          color: #eaeaea;
          opacity: 0.02;
          pointer-events: none;
          line-height: 1;
          font-family: 'Inter', sans-serif;
          letter-spacing: -0.05em;
        }

        .pipeline-step {
          position: relative;
          padding-left: 28px;
        }
        .pipeline-step::before {
          content: '';
          position: absolute;
          left: 8px;
          top: 8px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 8px var(--accent);
        }
        .pipeline-step::after {
          content: '';
          position: absolute;
          left: 10px;
          top: 18px;
          width: 2px;
          height: calc(100% - 8px);
          background: linear-gradient(to bottom, rgba(52,211,153,0.3), transparent);
        }
        .pipeline-step:last-child::after {
          display: none;
        }
      `}} />

      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 flex items-center justify-between px-8 py-5 border-b border-[#1a1a1a] bg-[#050505]/95 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <img src="/favicon.png" alt="Disburse Logo" className="w-5 h-5 object-contain" />
          <span className="text-xs tracking-widest uppercase font-medium">Disburse</span>
        </div>
        <div className="flex items-center gap-8">
          <a href="https://x.com/Disburs3" target="_blank" rel="noreferrer" className="text-xs tracking-widest uppercase text-[#888] hover:text-[#eaeaea] transition-colors">
            X (Twitter)
          </a>
          <a
            href={appUrl}
            style={{ color: '#000' }}
            className="text-xs tracking-widest uppercase px-5 py-2.5 border border-gray-200 bg-gray-200 hover:bg-transparent hover:!text-gray-200 transition-all flex items-center gap-2 group"
          >
            Launch App
            <ArrowRightIcon className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-48 pb-32 px-8 md:px-16 min-h-[85vh] flex flex-col justify-center border-b border-[#1a1a1a]">
        <div className="absolute inset-0 grid-bg pointer-events-none opacity-40" />
        <div className="absolute inset-0 grain-overlay" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-[radial-gradient(ellipse_at_center,rgba(52,211,153,0.04),transparent_70%)] pointer-events-none" />

        <HeroContent appUrl={appUrl} />
      </section>

      {/* Features Grid */}
      <section className="border-b border-[#1a1a1a]">
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#1a1a1a]">
          <FeatureCard 
            number="01"
            title="Non-Custodial Architecture"
            description="Absolute control over assets. Disburse operates entirely at the edge, relying on direct wallet signatures for transaction execution without intermediation."
            delay="delay-1"
          />
          <FeatureCard 
            number="02"
            title="Cryptographic QR Protocol"
            description="Deterministic request payloads formatted as standardized QR codes, enabling immediate invoice sharing and peer-to-peer settlement."
            delay="delay-2"
          />
          <FeatureCard 
            number="03"
            title="Onchain Verification"
            description="Immutable receipt validation. Settlement status is derived directly from raw network logs rather than trusted centralized databases."
            delay="delay-3"
          />
        </div>
      </section>

      {/* Settlement Pipeline Section */}
      <section className="border-b border-[#1a1a1a]">
        <SettlementPipeline />
      </section>

      {/* Compliance Section */}
      <section className="border-b border-[#1a1a1a]">
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#1a1a1a]">
          <ComplianceCard
            icon={<ShieldIcon className="w-5 h-5" />}
            title="Verifiable Settlement Receipts"
            description="Every payment through Disburse produces a VSR — a structured, attestable proof that a specific invoice was paid, verified from raw chain data, with the full audit trail from request creation to settlement confirmation."
            badge="VSR"
            delay="delay-1"
          />
          <ComplianceCard
            icon={<FileIcon className="w-5 h-5" />}
            title="Compliance-Grade Exports"
            description="Settlement proofs in machine-readable JSON, UBL 2.1 XML invoices for EU e-invoicing compliance, and PDF receipts with cryptographic fingerprints. Bridges onchain data with real-world accounting standards."
            badge="UBL 2.1"
            delay="delay-2"
          />
        </div>
      </section>

      {/* Cross-Chain Section */}
      <section className="border-b border-[#1a1a1a]">
        <CrossChainSection />
      </section>

      {/* Footer */}
      <footer className="px-8 md:px-16 py-8 flex flex-col md:flex-row justify-between items-start md:items-center text-[#555] text-xs tracking-widest uppercase font-mono border-t border-[#1a1a1a]">
        <div className="flex items-center gap-3">
          <img src="/favicon.png" alt="Disburse Logo" className="w-4 h-4 grayscale opacity-30" />
          <span>Disburse Protocol // System Operational</span>
        </div>
        <div className="mt-4 md:mt-0 flex flex-col md:flex-row items-start md:items-center gap-6 md:gap-12">
          <a href="https://x.com/Disburs3" target="_blank" rel="noreferrer" className="hover:text-[#eaeaea] transition-colors">
            Follow @Disburs3
          </a>
          <span>&copy; 2026</span>
        </div>
      </footer>
    </div>
  );
}

function HeroContent({ appUrl }: { appUrl: string }) {
  const ref = useReveal();
  return (
    <div ref={ref} className="reveal-hidden relative z-10 max-w-5xl">
      <div className="text-xs tracking-widest uppercase text-[#888] mb-10 border-l border-[#888] pl-4 font-mono">
        Verifiable Settlement Protocol
      </div>
      <h1 className="text-5xl md:text-8xl font-medium tracking-tighter leading-[1.05] mb-12 text-[#eaeaea]">
        Settlement-grade payments,<br />
        cryptographically verified.
      </h1>
      <p className="text-base md:text-lg text-[#888] mb-14 max-w-2xl leading-relaxed tracking-wide font-light">
        The first non-custodial protocol that bridges real-world invoicing with onchain payment verification.
        Generate requests, settle across chains, and export compliance-grade receipts.
      </p>
      <div className="flex flex-col sm:flex-row items-start gap-6">
        <a
          href={appUrl}
          style={{ color: '#000' }}
          className="text-xs tracking-widest uppercase px-8 py-4 border border-gray-200 bg-gray-200 hover:bg-transparent hover:!text-gray-200 transition-all flex items-center gap-3 group font-medium"
        >
          Launch App
          <ArrowRightIcon className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </a>
        <div className="flex items-center gap-3 text-xs text-[#555] font-mono tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Arc Testnet · Live
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ number, title, description, delay }: { number: string, title: string, description: string, delay: string }) {
  const ref = useReveal();
  return (
    <div ref={ref} className={`reveal-hidden ${delay} relative p-12 md:p-16 hover:bg-[#0a0a0a] transition-all duration-500 flex flex-col justify-between min-h-[320px] overflow-hidden hover:-translate-y-1`}>
      <div className="feature-watermark">{number}</div>
      <div className="text-xs text-[#555] tracking-widest font-mono relative z-10">
        // {number}
      </div>
      <div className="mt-12 relative z-10">
        <h3 className="text-xl md:text-2xl font-medium tracking-tight mb-5">{title}</h3>
        <p className="text-[#888] text-sm leading-relaxed tracking-wide font-light max-w-sm">
          {description}
        </p>
      </div>
    </div>
  );
}

function SettlementPipeline() {
  const ref = useReveal();
  return (
    <div ref={ref} className="reveal-hidden p-12 md:p-16 max-w-4xl mx-auto">
      <div className="text-xs text-[#555] tracking-widest font-mono mb-4">// Settlement Pipeline</div>
      <h2 className="text-3xl md:text-4xl font-medium tracking-tight mb-4 text-[#eaeaea]">
        Invoice → Settlement → Attestation
      </h2>
      <p className="text-[#888] text-sm leading-relaxed mb-12 max-w-2xl">
        Unlike traditional payment tools that stop at "transaction sent," Disburse follows every payment
        through a complete verification pipeline — producing a Verifiable Settlement Receipt at the end.
      </p>

      <div className="space-y-6">
        {[
          { step: "01", label: "Request Created", detail: "Structured QR payload with recipient, amount, token, invoice metadata, and expiry" },
          { step: "02", label: "Payment Submitted", detail: "Wallet-signed ERC-20 transfer on Arc, Base Sepolia, or Monad Testnet" },
          { step: "03", label: "Onchain Confirmation", detail: "Block confirmation + Polymer proof generation for cross-chain settlements" },
          { step: "04", label: "Verification", detail: "Receipt extracted from raw chain Transfer logs — no trusted intermediary" },
          { step: "05", label: "Attestation (VSR)", detail: "SHA-256 fingerprinted settlement record, exportable as JSON proof or UBL XML" },
        ].map((item) => (
          <div key={item.step} className="pipeline-step pb-4">
            <div className="flex items-baseline gap-3 mb-1">
              <span className="text-[10px] font-mono text-emerald-400/60">{item.step}</span>
              <span className="text-sm font-medium text-[#eaeaea]">{item.label}</span>
            </div>
            <p className="text-xs text-[#666] leading-relaxed">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComplianceCard({ icon, title, description, badge, delay }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
  delay: string;
}) {
  const ref = useReveal();
  return (
    <div ref={ref} className={`reveal-hidden ${delay} p-12 md:p-16 hover:bg-[#0a0a0a] transition-all duration-500`}>
      <div className="flex items-center gap-3 mb-6">
        <span className="text-emerald-400/60">{icon}</span>
        <span className="text-[10px] font-mono tracking-widest uppercase px-2 py-0.5 border border-emerald-400/20 text-emerald-400/60">
          {badge}
        </span>
      </div>
      <h3 className="text-xl md:text-2xl font-medium tracking-tight mb-5 text-[#eaeaea]">{title}</h3>
      <p className="text-[#888] text-sm leading-relaxed tracking-wide font-light">
        {description}
      </p>
    </div>
  );
}

function CrossChainSection() {
  const ref = useReveal();
  return (
    <div ref={ref} className="reveal-hidden p-12 md:p-16">
      <div className="flex items-center gap-3 mb-6">
        <LayersIcon className="w-5 h-5 text-emerald-400/60" />
        <span className="text-[10px] font-mono tracking-widest uppercase text-[#555]">Multi-Chain Settlement</span>
      </div>
      <h2 className="text-3xl md:text-4xl font-medium tracking-tight mb-4 text-[#eaeaea]">
        Pay from any chain.<br />
        Settle on Arc.
      </h2>
      <p className="text-[#888] text-sm leading-relaxed mb-10 max-w-2xl">
        Payers choose their source chain — Arc Testnet for direct ERC-20 transfers, or Base Sepolia / Monad Testnet
        for cross-chain settlement via Polymer cryptographic proofs.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[#1a1a1a]">
        {[
          { chain: "Arc Testnet", speed: "~15s", type: "Direct", symbol: "USDC" },
          { chain: "Base Sepolia", speed: "~2-5 min", type: "Polymer Proof", symbol: "ETH" },
          { chain: "Monad Testnet", speed: "~2-5 min", type: "Polymer Proof", symbol: "MON" },
        ].map((route) => (
          <div key={route.chain} className="bg-[#050505] p-6 hover:bg-[#0a0a0a] transition-colors">
            <p className="text-xs font-mono text-emerald-400/60 mb-2">{route.type}</p>
            <h4 className="text-sm font-medium text-[#eaeaea] mb-3">{route.chain}</h4>
            <div className="flex items-center justify-between text-[10px] font-mono text-[#555]">
              <span>Settlement: {route.speed}</span>
              <span>Gas: {route.symbol}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
