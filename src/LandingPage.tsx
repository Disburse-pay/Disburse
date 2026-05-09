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
      `}} />

      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 flex items-center justify-between px-8 py-5 border-b border-[#1a1a1a] bg-[#050505]">
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
        Disburse Console
      </div>
      <h1 className="text-5xl md:text-8xl font-medium tracking-tighter leading-[1.05] mb-12 text-[#eaeaea]">
        Cryptographic payments,<br />
        engineered for precision.
      </h1>
      <p className="text-base md:text-lg text-[#888] mb-14 max-w-2xl leading-relaxed tracking-wide font-light">
        A clinical, non-custodial payment console. Generate requests, scan, and settle directly onchain. No middlemen.
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
