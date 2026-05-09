import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  FileText,
  Globe2,
  Layers,
  QrCode,
  ReceiptText,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";

/* --------------------------------------------------------------------
 * Disburse landing page.
 *
 * Design intent: editorial calm on the outside, precise product texture
 * on the inside. One accent (emerald), one grain layer, one subtle grid.
 * Every section earns its keep: it either answers "what is it", "why
 * trust it", or "how do I use it".
 * ------------------------------------------------------------------ */

type Urls = { appUrl: string; docsUrl: string };

function useUrls(): Urls {
  return useMemo(() => {
    const { hostname, protocol, port } = window.location;
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0";
    const isLocalhostSub = hostname.endsWith(".localhost");

    if (isLocal || isLocalhostSub) {
      const portSuffix = port ? `:${port}` : "";
      return {
        appUrl: `${protocol}//app.localhost${portSuffix}`,
        docsUrl: "/docs",
      };
    }

    return {
      appUrl: "https://app.disburse.online",
      docsUrl: "https://docs.disburse.online",
    };
  }, []);
}

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

export default function LandingPage() {
  const urls = useUrls();
  const reduceMotion = Boolean(useReducedMotion());

  return (
    <div className="landing-root min-h-screen bg-[#050505] font-sans text-[#eaeaea] antialiased selection:bg-emerald-400/30 selection:text-white">
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />

      <Nav urls={urls} />
      <Hero urls={urls} reduceMotion={reduceMotion} />
      <ConsolePreview />
      <Principles />
      <Pipeline />
      <Compliance />
      <CrossChain />
      <UseCases />
      <FAQ />
      <FinalCta urls={urls} />
      <Footer />
    </div>
  );
}

/* ============================================================
 * Nav
 * ========================================================== */

function Nav({ urls }: { urls: Urls }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={[
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled
          ? "border-b border-white/[0.08] bg-[#050505]/90 backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
      ].join(" ")}
    >
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-6 md:px-10">
        <a href="/" className="flex items-center gap-2.5" aria-label="Disburse home">
          <img src="/favicon.png" alt="" className="h-5 w-5" aria-hidden="true" />
          <span className="text-[13px] font-semibold tracking-tight">Disburse</span>
        </a>
        <div className="flex items-center gap-1">
          <a
            href={urls.docsUrl}
            className="hidden rounded-md px-3 py-1.5 text-xs text-white/60 transition-colors hover:text-white sm:inline-block"
          >
            Docs
          </a>
          <a
            href="https://x.com/Disburs3"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-md px-3 py-1.5 text-xs text-white/60 transition-colors hover:text-white sm:inline-block"
          >
            X / Twitter
          </a>
          <a
            href={urls.appUrl}
            className="group ml-1 inline-flex items-center gap-1.5 rounded-md bg-emerald-400 px-3.5 py-1.5 text-[12px] font-semibold tracking-tight text-[#04110b] shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_8px_18px_-12px_rgba(52,211,153,0.6)] transition-transform hover:-translate-y-px hover:bg-emerald-300"
          >
            Launch app
            <ArrowRight
              size={14}
              strokeWidth={2.25}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </a>
        </div>
      </div>
    </nav>
  );
}

/* ============================================================
 * Hero
 * ========================================================== */

function Hero({ urls, reduceMotion }: { urls: Urls; reduceMotion: boolean }) {
  return (
    <section className="relative overflow-hidden border-b border-white/[0.06] pt-32 pb-24 md:pt-40 md:pb-32">
      {/* Layered background: soft radial + grid + grain */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_-10%,rgba(52,211,153,0.08),transparent_70%)]"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid-bg" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grain" />

      <div className="relative mx-auto max-w-[1280px] px-6 md:px-10">
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8 inline-flex items-center gap-2 border-l border-white/25 pl-4 font-mono text-[11px] uppercase tracking-[0.22em] text-white/55"
        >
          Verifiable Settlement Protocol
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.65, ease: [0.16, 1, 0.3, 1], delay: 0.05 }
          }
          className="max-w-[16ch] text-[clamp(2.5rem,6.5vw,5.75rem)] font-semibold leading-[1.02] tracking-[-0.035em]"
        >
          Stablecoin invoices,
          <br />
          <span className="bg-gradient-to-r from-white via-white/80 to-white/40 bg-clip-text text-transparent">
            settled and receipted
          </span>
          <br />
          on chain.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.12 }
          }
          className="mt-8 max-w-xl text-[16px] leading-relaxed text-white/60"
        >
          Issue a QR request. The payer settles from any supported chain. Disburse
          writes a verifiable receipt, signed from raw chain data, that you can
          hand to your accountant or auditor.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.2 }
          }
          className="mt-10 flex flex-wrap items-center gap-3"
        >
          <a
            href={urls.appUrl}
            className="group inline-flex items-center gap-1.5 rounded-md bg-emerald-400 px-5 py-3 text-[13px] font-semibold tracking-tight text-[#04110b] shadow-[0_1px_0_rgba(255,255,255,0.14)_inset,0_10px_28px_-14px_rgba(52,211,153,0.8)] transition-transform hover:-translate-y-px hover:bg-emerald-300"
          >
            Launch the console
            <ArrowRight
              size={14}
              strokeWidth={2.25}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </a>
          <a
            href={urls.docsUrl}
            className="group inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.02] px-5 py-3 text-[13px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
          >
            Read the docs
            <ArrowUpRight
              size={14}
              strokeWidth={1.75}
              className="text-white/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </a>
        </motion.div>

        {/* Supported rails footnote - no live status pill */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.6, delay: 0.4 }}
          className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-white/35"
        >
          <span className="font-mono uppercase tracking-[0.22em]">Settles on</span>
          <span className="text-white/55">Arc Testnet</span>
          <span className="text-white/20">/</span>
          <span className="text-white/55">Base Sepolia</span>
          <span className="text-white/20">/</span>
          <span className="text-white/55">Monad Testnet</span>
          <span className="text-white/20">/</span>
          <span className="text-white/55">USDC and EURC</span>
        </motion.div>
      </div>
    </section>
  );
}

/* ============================================================
 * Console preview — stylised product glimpse
 * ========================================================== */

function ConsolePreview() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="border-b border-white/[0.06]">
      <div
        ref={ref}
        className="reveal relative mx-auto max-w-[1280px] px-6 pb-20 md:px-10 md:pb-28"
      >
        <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-px">
          <div className="relative overflow-hidden rounded-[11px] bg-[#070708]">
            {/* Faux window chrome */}
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-white/40">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
                app.disburse.online
              </div>
              <div className="w-14" />
            </div>

            <div className="grid grid-cols-12 gap-0">
              {/* Sidebar */}
              <aside className="col-span-12 border-b border-white/[0.06] p-5 md:col-span-3 md:border-b-0 md:border-r md:border-white/[0.06]">
                <div className="mb-6 flex items-center gap-2">
                  <img src="/favicon.png" alt="" className="h-4 w-4 opacity-80" aria-hidden="true" />
                  <span className="text-[12px] font-semibold tracking-tight">Disburse</span>
                </div>
                <ul className="space-y-1 text-[12px]">
                  {[
                    { label: "Overview", active: true },
                    { label: "Direct send" },
                    { label: "QR requests" },
                    { label: "Import / Export" },
                    { label: "Documentation" },
                  ].map((i) => (
                    <li
                      key={i.label}
                      className={[
                        "rounded-md px-2.5 py-1.5",
                        i.active
                          ? "bg-emerald-400/10 text-white"
                          : "text-white/45",
                      ].join(" ")}
                    >
                      {i.label}
                    </li>
                  ))}
                </ul>
              </aside>

              {/* Main */}
              <div className="col-span-12 p-6 md:col-span-9">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                      Overview
                    </p>
                    <h3 className="text-[15px] font-semibold">Total requested volume</h3>
                  </div>
                  <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10px] font-mono text-white/45 sm:inline-flex">
                    0x9aF3...4c2E
                  </div>
                </div>

                <div className="mb-6 flex items-baseline gap-2">
                  <span className="text-[2.25rem] font-semibold tracking-tight tabular-nums">
                    12,480.00
                  </span>
                  <span className="text-sm text-white/40">USDC</span>
                </div>

                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.06] sm:grid-cols-4">
                  {[
                    { l: "Verified", v: "9,820.00", u: "USDC", t: "text-emerald-400" },
                    { l: "Pending", v: "2,660.00", u: "USDC", t: "text-sky-300" },
                    { l: "Requests", v: "42", t: "text-white" },
                    { l: "Success", v: "96%", t: "text-emerald-400" },
                  ].map((m) => (
                    <div key={m.l} className="bg-[#070708] p-3.5">
                      <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
                        {m.l}
                      </p>
                      <p className={`text-[15px] font-semibold tabular-nums ${m.t}`}>
                        {m.v}
                        {m.u && <span className="ml-1 text-[10px] font-normal text-white/40">{m.u}</span>}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 overflow-hidden rounded-lg border border-white/[0.06]">
                  <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.015] px-4 py-2.5">
                    <span className="text-[11px] font-semibold">Recent activity</span>
                    <span className="font-mono text-[10px] text-white/35">3 records</span>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {[
                      { s: "Paid",    d: "bg-emerald-400", c: "text-emerald-400", ref: "Invoice 042", a: "1,250.00" },
                      { s: "Open",    d: "bg-sky-400",     c: "text-sky-300",     ref: "Invoice 041", a: "480.00" },
                      { s: "Paid",    d: "bg-emerald-400", c: "text-emerald-400", ref: "Retainer Q2", a: "4,500.00" },
                    ].map((row) => (
                      <div key={row.ref} className="grid grid-cols-12 items-center gap-2 px-4 py-2.5 text-[11.5px]">
                        <div className="col-span-3 flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${row.d}`} />
                          <span className={`font-medium ${row.c}`}>{row.s}</span>
                        </div>
                        <div className="col-span-5 truncate font-medium text-white/85">{row.ref}</div>
                        <div className="col-span-2 font-mono text-[10px] text-white/45">0x7e...a81c</div>
                        <div className="col-span-2 text-right font-mono tabular-nums text-white/85">
                          {row.a}
                          <span className="ml-1 text-[9px] text-white/40">USDC</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom fade */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 bottom-0 h-24 bg-gradient-to-b from-transparent to-[#050505]" />
      </div>
    </section>
  );
}

/* ============================================================
 * Principles
 * ========================================================== */

function Principles() {
  return (
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1280px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="Principles"
          title="Three non-negotiables."
          lede="Not a wallet. Not a custodian. A console that turns a wallet signature into a clean accounting record."
        />

        <div className="mt-12 grid grid-cols-1 gap-px bg-white/[0.06] md:grid-cols-3">
          <Principle
            number="01"
            title="The wallet is the authority"
            body="Disburse prepares the calldata. The wallet signs it. We never hold a private key, never touch a balance, and never gate withdrawal."
          />
          <Principle
            number="02"
            title="QR is the contract"
            body="A payment request is a portable JSON payload encoded in a QR code. Scan it, inspect it, pay it. No account, no backend login, no trust assumptions."
          />
          <Principle
            number="03"
            title="Chain data is the source of truth"
            body="A receipt is only green when a Transfer log on the correct token, to the exact recipient, for the exact amount, has confirmed on chain."
          />
        </div>
      </div>
    </section>
  );
}

function Principle({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal group relative overflow-hidden bg-[#050505] p-10 md:p-12">
      {/* Huge ghost numeral from the old page, but restrained */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 -top-6 select-none font-sans text-[10rem] font-semibold leading-none tracking-[-0.05em] text-white/[0.025]"
      >
        {number}
      </span>

      <span className="mb-8 block font-mono text-[11px] text-white/30">
        // {number}
      </span>
      <h3 className="mb-3 text-[20px] font-semibold tracking-tight text-white">{title}</h3>
      <p className="max-w-sm text-[14px] leading-relaxed text-white/55">{body}</p>
    </div>
  );
}

/* ============================================================
 * Pipeline
 * ========================================================== */

function Pipeline() {
  const ref = useReveal<HTMLDivElement>();
  const steps = [
    {
      n: "01",
      t: "Request Created",
      d: "Structured QR payload with recipient, amount, token, invoice metadata, and expiry.",
      icon: QrCode,
    },
    {
      n: "02",
      t: "Payment Submitted",
      d: "Payer scans, connects a wallet, signs an ERC-20 transfer on their preferred chain.",
      icon: Wallet,
    },
    {
      n: "03",
      t: "Onchain Confirmation",
      d: "Transaction lands on Arc. Cross-chain settles via a Polymer cryptographic proof.",
      icon: Zap,
    },
    {
      n: "04",
      t: "Verification",
      d: "Receipt is derived from raw Transfer logs, not a database summary table.",
      icon: CheckCircle2,
    },
    {
      n: "05",
      t: "Attestation (VSR)",
      d: "SHA-256 fingerprinted settlement record. Export as JSON, UBL 2.1 XML, or PDF.",
      icon: ShieldCheck,
    },
  ];

  return (
    <section className="border-b border-white/[0.06]">
      <div ref={ref} className="reveal mx-auto max-w-[1280px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="Lifecycle"
          title="From invoice to attestation."
          lede="Most payment tools stop at 'transaction sent'. Disburse keeps going until the accountant has something to file."
        />

        {/* Vertical rail on mobile, horizontal pipeline on md+ */}
        <ol className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-5">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const isLast = i === steps.length - 1;
            return (
              <li
                key={s.n}
                className="relative rounded-lg border border-white/[0.06] bg-white/[0.015] p-5 transition-colors hover:border-emerald-400/25 hover:bg-white/[0.03]"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/5 text-emerald-400">
                    <Icon size={13} strokeWidth={1.75} />
                  </span>
                  <span className="font-mono text-[10px] text-white/40">{s.n}</span>
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className="hidden h-px flex-1 bg-gradient-to-r from-emerald-400/30 via-white/10 to-transparent md:block"
                    />
                  )}
                </div>
                <p className="mb-1 text-[14px] font-semibold text-white">{s.t}</p>
                <p className="text-[12px] leading-relaxed text-white/50">{s.d}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ============================================================
 * Compliance
 * ========================================================== */

function Compliance() {
  return (
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1280px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="Compliance"
          title="Receipts your auditor can open."
          lede="Three formats, one source of truth. Every export is derived from the onchain Transfer log, not from a summary table."
        />

        <div className="mt-12 grid grid-cols-1 gap-px bg-white/[0.06] md:grid-cols-3">
          <ComplianceCard
            icon={<ShieldCheck size={18} strokeWidth={1.5} />}
            badge="VSR"
            title="Verifiable Settlement Receipt"
            body="Structured JSON proof, SHA-256 fingerprinted. Anyone can re-derive it from the transaction hash."
          />
          <ComplianceCard
            icon={<FileText size={18} strokeWidth={1.5} />}
            badge="UBL 2.1"
            title="EU-compliant invoice XML"
            body="Machine-readable invoice in the format EU e-invoicing systems already accept."
          />
          <ComplianceCard
            icon={<ReceiptText size={18} strokeWidth={1.5} />}
            badge="PDF"
            title="Human-readable receipt"
            body="One-page PDF with the amount, parties, tx hash, and an Arcscan link. No marketing."
          />
        </div>
      </div>
    </section>
  );
}

function ComplianceCard({
  icon,
  badge,
  title,
  body,
}: {
  icon: React.ReactNode;
  badge: string;
  title: string;
  body: string;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal bg-[#050505] p-10 md:p-12">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="text-emerald-400/70">{icon}</span>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-400/80">
          {badge}
        </span>
      </div>
      <h3 className="mb-3 text-[18px] font-semibold tracking-tight text-white">{title}</h3>
      <p className="text-[13px] leading-relaxed text-white/55">{body}</p>
    </div>
  );
}

/* ============================================================
 * Cross-chain
 * ========================================================== */

function CrossChain() {
  const routes = [
    { chain: "Arc Testnet", speed: "~15s", route: "Direct ERC-20", gas: "USDC" },
    { chain: "Base Sepolia", speed: "~2-5 min", route: "Polymer proof", gas: "ETH" },
    { chain: "Monad Testnet", speed: "~2-5 min", route: "Polymer proof", gas: "MON" },
  ];
  return (
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1280px] px-6 py-20 md:px-10 md:py-24">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <SectionHeader
              eyebrow={
                <span className="inline-flex items-center gap-1.5">
                  <Layers size={14} strokeWidth={1.5} className="text-emerald-400/70" />
                  Multi-chain
                </span>
              }
              title={
                <>
                  Pay from any chain.
                  <br />
                  <span className="text-white/50">Settle on Arc.</span>
                </>
              }
              lede="Payers choose their home chain: direct on Arc, or across Base Sepolia and Monad via Polymer proofs. The request, receipt, and invoice stay the same."
            />
          </div>

          <div className="md:col-span-7">
            <div className="grid grid-cols-1 gap-px bg-white/[0.06] md:grid-cols-3">
              {routes.map((r) => (
                <div key={r.chain} className="bg-[#050505] p-6">
                  <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-400/70">
                    {r.route}
                  </p>
                  <h4 className="mb-6 text-[15px] font-semibold text-white">{r.chain}</h4>
                  <dl className="space-y-1.5 text-[11px] text-white/40">
                    <div className="flex justify-between">
                      <dt>Settlement</dt>
                      <dd className="text-white/70">{r.speed}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Gas</dt>
                      <dd className="text-white/70">{r.gas}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Use cases
 * ========================================================== */

function UseCases() {
  const cases = [
    {
      icon: Globe2,
      title: "Cross-border freelance",
      body: "Send a stablecoin invoice your client can pay in 30 seconds from any wallet, any chain. No intermediary bank, no FX markup.",
    },
    {
      icon: Building2,
      title: "DAO and treasury ops",
      body: "Generate receipts that your working group or grantor can verify without trusting an internal spreadsheet or multisig label.",
    },
    {
      icon: ReceiptText,
      title: "Accounting-friendly crypto",
      body: "UBL 2.1 XML slots into existing e-invoicing pipelines. PDFs go to the finance inbox. JSON proofs go to the audit log.",
    },
  ];

  return (
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1280px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="Built for"
          title="Teams that treat receipts as first-class data."
          lede="If a transaction hash alone is not enough documentation, Disburse is the layer that sits between your wallet and your books."
        />

        <div className="mt-12 grid grid-cols-1 gap-px bg-white/[0.06] md:grid-cols-3">
          {cases.map((c) => {
            const Icon = c.icon;
            return (
              <UseCaseCard key={c.title} icon={<Icon size={18} strokeWidth={1.5} />} title={c.title} body={c.body} />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function UseCaseCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal bg-[#050505] p-10 md:p-12">
      <div className="mb-6 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/70">
        {icon}
      </div>
      <h3 className="mb-3 text-[17px] font-semibold tracking-tight text-white">{title}</h3>
      <p className="text-[13px] leading-relaxed text-white/55">{body}</p>
    </div>
  );
}

/* ============================================================
 * FAQ
 * ========================================================== */

function FAQ() {
  const items = [
    {
      q: "Does Disburse hold funds at any point?",
      a: "No. Payments are submitted from the payer's wallet directly to the recipient address. The app prepares calldata and verifies results; it never custodies balances or signing keys.",
    },
    {
      q: "What actually counts as a paid invoice?",
      a: "A request is marked paid only when a Transfer log on the correct token contract, to the exact recipient address, for the exact amount, has confirmed. A near-match (right recipient, wrong amount) is surfaced for review instead of being auto-settled.",
    },
    {
      q: "Which chains are supported today?",
      a: "Arc Testnet (direct), Base Sepolia, and Monad Testnet. Cross-chain payments settle on Arc via Polymer cryptographic proofs. More chains can be added as the Polymer routes expand.",
    },
    {
      q: "How is a Verifiable Settlement Receipt different from a PDF invoice?",
      a: "A VSR is a structured JSON document with a SHA-256 fingerprint. It lets a third party independently derive the same record from the transaction hash, without needing access to Disburse. The PDF is a human copy of the same underlying fact.",
    },
    {
      q: "What is stored in my browser vs. the backend?",
      a: "QR requests and receipts live in localStorage so you keep your history offline. When a Supabase backend is configured, QR confirmations also sync through a thin API so the payer and requester see the same state in realtime.",
    },
  ];

  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1280px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader eyebrow="FAQ" title="The honest short list." />

        <div className="mt-12 divide-y divide-white/[0.06] border-y border-white/[0.06]">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 py-5 text-left transition-colors hover:text-white"
                >
                  <span className="text-[15px] font-medium text-white/85">{item.q}</span>
                  <span
                    aria-hidden="true"
                    className={[
                      "ml-4 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/60 transition-transform",
                      isOpen ? "rotate-45 border-emerald-400/40 text-emerald-400" : "",
                    ].join(" ")}
                  >
                    +
                  </span>
                </button>
                <div
                  className="grid overflow-hidden transition-all duration-300"
                  style={{
                    gridTemplateRows: isOpen ? "1fr" : "0fr",
                    opacity: isOpen ? 1 : 0,
                  }}
                >
                  <div className="min-h-0">
                    <p className="max-w-[72ch] pb-6 pr-10 text-[14px] leading-relaxed text-white/55">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Final CTA
 * ========================================================== */

function FinalCta({ urls }: { urls: Urls }) {
  return (
    <section className="border-b border-white/[0.06]">
      <div className="relative mx-auto max-w-[1280px] overflow-hidden px-6 py-24 md:px-10 md:py-32">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(52,211,153,0.08),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-2xl text-center">
          <h2 className="text-[clamp(2rem,4.75vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
            Test a payment end-to-end
            <span className="block text-white/40">in less than a minute.</span>
          </h2>
          <p className="mt-6 text-[15px] text-white/55">
            Connect a wallet, grab testnet USDC from the Arc faucet, and walk the
            full request, confirmation, and receipt flow. No signup, no waitlist.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href={urls.appUrl}
              className="group inline-flex items-center gap-1.5 rounded-md bg-emerald-400 px-6 py-3.5 text-[13px] font-semibold tracking-tight text-[#04110b] shadow-[0_1px_0_rgba(255,255,255,0.14)_inset,0_12px_32px_-14px_rgba(52,211,153,0.7)] transition-transform hover:-translate-y-px hover:bg-emerald-300"
            >
              Open the console
              <ArrowRight size={14} strokeWidth={2.25} className="transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href={urls.docsUrl}
              className="group inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.02] px-6 py-3.5 text-[13px] font-medium text-white/80 transition-colors hover:border-white/20 hover:text-white"
            >
              Read the docs
              <ArrowUpRight size={14} strokeWidth={1.75} className="text-white/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Footer
 * ========================================================== */

function Footer() {
  return (
    <footer className="mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-4 px-6 py-10 text-[11px] text-white/30 md:flex-row md:items-center md:px-10">
      <div className="flex items-center gap-2">
        <img src="/favicon.png" alt="" className="h-4 w-4 opacity-40" aria-hidden="true" />
        <span>Disburse / Non-custodial stablecoin payments</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <a href="https://x.com/Disburs3" target="_blank" rel="noreferrer" className="transition-colors hover:text-white/70">
          @Disburs3
        </a>
        <a href="https://github.com/Disburse-pay" target="_blank" rel="noreferrer" className="transition-colors hover:text-white/70">
          GitHub
        </a>
        <span>&copy; 2026</span>
      </div>
    </footer>
  );
}

/* ============================================================
 * Section header helper
 * ========================================================== */

function SectionHeader({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  lede?: string;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal max-w-2xl">
      <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">
        {eyebrow}
      </p>
      <h2 className="text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-[1.08] tracking-[-0.02em] text-white">
        {title}
      </h2>
      {lede && <p className="mt-5 text-[15px] leading-relaxed text-white/55">{lede}</p>}
    </div>
  );
}

/* ============================================================
 * Scoped CSS
 * ========================================================== */

const LANDING_CSS = `
  .landing-root {
    letter-spacing: -0.005em;
  }

  /* Reveal-on-scroll. Falls back gracefully if IntersectionObserver never fires. */
  .landing-root .reveal {
    opacity: 0;
    transform: translateY(10px);
    transition:
      opacity 620ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 620ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .landing-root .reveal.is-revealed {
    opacity: 1;
    transform: translateY(0);
  }
  @media (prefers-reduced-motion: reduce) {
    .landing-root .reveal {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }

  /* Subtle blueprint grid. Masked so it fades at the edges. */
  .landing-root .grid-bg {
    opacity: 0.35;
    background-size: 44px 44px;
    background-image:
      linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px);
    -webkit-mask-image: radial-gradient(ellipse 70% 55% at 50% 0%, black 0%, transparent 80%);
            mask-image: radial-gradient(ellipse 70% 55% at 50% 0%, black 0%, transparent 80%);
  }

  /* Single film grain, low opacity. */
  .landing-root .grain {
    opacity: 0.02;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 160px 160px;
    mix-blend-mode: overlay;
  }
`;
