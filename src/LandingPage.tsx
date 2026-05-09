import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FileText,
  Layers,
  Lock,
  QrCode,
  ReceiptText,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";

/* --------------------------------------------------------------------
 * Disburse landing page.
 *
 * Design goal: calm, confident, fast to read. One accent colour, one
 * background texture, no decorative status pills. Structure answers:
 * what is it, how does it work, why trust it, how do I try it.
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
    <div className="landing-root min-h-screen bg-[#0a0b0e] font-sans text-[#e6e8ed] antialiased selection:bg-emerald-500/25 selection:text-white">
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />

      <Nav urls={urls} />
      <Hero urls={urls} reduceMotion={reduceMotion} />
      <TrustStrip />
      <ConsolePreview />
      <HowItWorks />
      <Features />
      <CrossChain />
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
          ? "border-b border-white/[0.06] bg-[#0a0b0e]/92 backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
      ].join(" ")}
    >
      <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between px-6 md:px-10">
        <a href="/" className="flex items-center gap-2.5" aria-label="Disburse home">
          <img src="/favicon.png" alt="" className="h-[18px] w-[18px]" aria-hidden="true" />
          <span className="text-[13px] font-semibold tracking-[-0.01em]">Disburse</span>
          <span className="ml-1 rounded-sm border border-white/10 bg-white/[0.02] px-1.5 py-[1px] font-mono text-[8.5px] uppercase leading-none tracking-[0.16em] text-white/45">
            Testnet
          </span>
        </a>
        <div className="flex items-center gap-0.5">
          <a
            href={urls.docsUrl}
            className="hidden rounded-sm px-3 py-1.5 text-[12px] text-white/55 transition-colors hover:text-white sm:inline-block"
          >
            Docs
          </a>
          <a
            href="https://github.com/Disburse-pay"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-sm px-3 py-1.5 text-[12px] text-white/55 transition-colors hover:text-white sm:inline-block"
          >
            GitHub
          </a>
          <a
            href={urls.appUrl}
            style={{ color: "#0a0b0e" }}
            className="group ml-2 inline-flex items-center gap-1.5 rounded-[4px] bg-white px-3 py-1.5 text-[12px] font-semibold tracking-[-0.005em] shadow-sm transition-colors hover:bg-neutral-200"
          >
            Launch app
            <ArrowRight
              size={12}
              strokeWidth={2.25}
              style={{ color: "#0a0b0e" }}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </a>
        </div>
      </div>
    </nav>
  );
}

/* ============================================================
 * Hero. Calm, two-line headline, one CTA, no live pill, no glow dot.
 * ========================================================== */

function Hero({ urls, reduceMotion }: { urls: Urls; reduceMotion: boolean }) {
  return (
    <section className="relative overflow-hidden border-b border-white/[0.05] pt-32 pb-20 md:pt-40 md:pb-28">
      {/* Single hairline rule. No radial blobs, no dotted grid. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
      />

      <div className="relative mx-auto max-w-[1180px] px-6 md:px-10">
        <div className="grid grid-cols-1 items-end gap-12 md:grid-cols-12 md:gap-8">
          <div className="md:col-span-8">
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduceMotion ? { duration: 0 } : { duration: 0.5, ease: [0.16, 1, 0.3, 1] }
              }
              className="mb-8 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40"
            >
              <span className="h-[1px] w-6 bg-[var(--primary-bg,#2fb37f)]/60" aria-hidden="true" />
              Verifiable stablecoin settlement
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.05 }
              }
              className="max-w-[22ch] text-[clamp(2.25rem,5vw,4.25rem)] font-medium leading-[1.04] tracking-[-0.035em] text-white"
            >
              Stablecoin invoices
              <br />
              <span className="italic font-normal text-white/55" style={{ fontFamily: "var(--font-serif)" }}>
                with receipts you can verify.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.12 }
              }
              className="mt-7 max-w-[54ch] text-[15px] leading-[1.65] text-white/60"
            >
              Issue a QR request. The payer settles from any supported chain in
              USDC. Disburse turns the onchain transfer into a structured
              receipt your accountant or auditor can actually file.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.2 }
              }
              className="mt-9 flex flex-wrap items-center gap-2.5"
            >
              <a
                href={urls.appUrl}
                style={{ color: "#0a0b0e" }}
                className="group inline-flex items-center gap-1.5 rounded-[4px] bg-white px-5 py-3 text-[13px] font-semibold tracking-[-0.005em] shadow-sm transition-colors hover:bg-neutral-200"
              >
                Launch the console
                <ArrowRight
                  size={14}
                  strokeWidth={2.25}
                  style={{ color: "#0a0b0e" }}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </a>
              <a
                href={urls.docsUrl}
                className="group inline-flex items-center gap-1.5 rounded-[4px] border border-white/10 px-5 py-3 text-[13px] font-medium text-white/85 transition-colors hover:border-white/20 hover:text-white"
              >
                Read the docs
                <ArrowUpRight
                  size={14}
                  strokeWidth={1.75}
                  className="text-white/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                />
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.6, delay: 0.32 }}
              className="mt-10 flex flex-wrap items-center gap-1.5 text-[11.5px] text-white/35"
            >
              <Lock size={11} strokeWidth={1.6} className="text-white/30" />
              No signup, no custody, no private keys.
            </motion.div>
          </div>

          {/* Secondary column: a quiet metadata block, in the spirit of */}
          {/* institutional prospectus pages. */}
          <motion.dl
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.25 }
            }
            className="md:col-span-4 md:border-l md:border-white/[0.06] md:pl-8"
          >
            {[
              { k: "Settlement", v: "Arc Testnet" },
              { k: "Source chains", v: "Arc, Base, Monad" },
              { k: "Asset", v: "USDC, EURC" },
              { k: "Receipt", v: "VSR \u00b7 UBL 2.1 \u00b7 PDF" },
            ].map((row, i) => (
              <div
                key={row.k}
                className={[
                  "grid grid-cols-[120px_1fr] items-baseline gap-3 py-2.5",
                  i !== 0 ? "border-t border-white/[0.04]" : "",
                ].join(" ")}
              >
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-white/35">
                  {row.k}
                </dt>
                <dd className="text-[12.5px] text-white/85">{row.v}</dd>
              </div>
            ))}
          </motion.dl>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * TrustStrip. Ecosystem the project is built on.
 * ========================================================== */

function TrustStrip() {
  const ref = useReveal<HTMLDivElement>();
  const rails: { label: string; sub: string }[] = [
    { label: "USDC", sub: "Stablecoin" },
    { label: "EURC", sub: "Euro stable" },
    { label: "Arc", sub: "Settlement" },
    { label: "Base", sub: "Source" },
    { label: "Monad", sub: "Source" },
    { label: "Polymer", sub: "Proofs" },
  ];
  return (
    <section className="border-b border-white/[0.05] bg-[#08090c]">
      <div
        ref={ref}
        className="reveal mx-auto flex max-w-[1180px] flex-col items-start gap-5 px-6 py-8 md:flex-row md:items-center md:justify-between md:px-10"
      >
        <p className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-white/35">
          Built on the USDC ecosystem
        </p>
        <ul className="flex flex-wrap items-center gap-x-7 gap-y-3">
          {rails.map((r) => (
            <li
              key={r.label}
              className="flex items-baseline gap-1.5 text-[12.5px] text-white/70"
            >
              <span className="font-semibold tracking-[-0.01em] text-white/90">{r.label}</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
                {r.sub}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ============================================================
 * ConsolePreview. One visual proof of the product. Simplified.
 * ========================================================== */

function ConsolePreview() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="border-b border-white/[0.05]">
      <div
        ref={ref}
        className="reveal relative mx-auto max-w-[1180px] px-6 pb-20 md:px-10 md:pb-24"
      >
        {/* Section prelude. Keeps the screenshot from feeling marketing-y. */}
        <div className="mb-7 flex items-end justify-between gap-6">
          <div>
            <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.22em] text-white/40">
              The console
            </p>
            <h2 className="max-w-[30ch] text-[clamp(1.35rem,2.2vw,1.8rem)] font-medium leading-[1.2] tracking-[-0.02em] text-white/95">
              A working statement for every stablecoin payment.
            </h2>
          </div>
          <a
            href="https://app.disburse.online"
            className="hidden items-center gap-1.5 self-end text-[12px] text-white/45 transition-colors hover:text-white md:inline-flex"
          >
            Open app
            <ArrowUpRight size={12} strokeWidth={1.6} className="text-white/30" />
          </a>
        </div>

        <div className="relative overflow-hidden rounded-[8px] border border-white/[0.07] bg-[#0a0b0e]">
          <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-white/10" />
              <span className="h-2 w-2 rounded-full bg-white/10" />
              <span className="h-2 w-2 rounded-full bg-white/10" />
            </div>
            <div className="flex items-center gap-1.5 rounded-sm border border-white/[0.06] bg-white/[0.02] px-2.5 py-0.5 font-mono text-[10px] text-white/40">
              app.disburse.online
            </div>
            <div className="w-14" />
          </div>

          <div className="grid grid-cols-12">
            {/* Sidebar */}
            <aside className="col-span-12 border-b border-white/[0.05] p-4 md:col-span-3 md:border-b-0 md:border-r md:border-white/[0.05]">
              <div className="mb-5 flex items-center gap-2">
                <img src="/favicon.png" alt="" className="h-[16px] w-[16px] opacity-80" aria-hidden="true" />
                <span className="text-[12px] font-semibold tracking-[-0.01em]">Disburse</span>
                <span className="ml-auto rounded-sm border border-white/10 bg-white/[0.02] px-1.5 py-[1px] font-mono text-[8.5px] uppercase leading-none tracking-[0.16em] text-white/40">
                  Testnet
                </span>
              </div>
              <p className="mb-1.5 px-2.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">
                Operate
              </p>
              <ul className="space-y-0 text-[11.5px]">
                {[
                  { label: "Overview", active: true },
                  { label: "Direct send" },
                  { label: "QR requests" },
                ].map((i) => (
                  <li
                    key={i.label}
                    className={[
                      "relative rounded-sm px-2.5 py-1.5",
                      i.active ? "bg-white/[0.04] text-white" : "text-white/45",
                    ].join(" ")}
                  >
                    {i.active && (
                      <span className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-r bg-emerald-500/70" aria-hidden="true" />
                    )}
                    {i.label}
                  </li>
                ))}
              </ul>
              <p className="mt-5 mb-1.5 px-2.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">
                Reference
              </p>
              <ul className="space-y-0 text-[11.5px]">
                <li className="rounded-sm px-2.5 py-1.5 text-white/45">Documentation</li>
              </ul>
            </aside>

            {/* Main area */}
            <div className="col-span-12 p-5 md:col-span-9">
              {/* Headline metric */}
              <div className="rounded-[6px] border border-white/[0.06] bg-[#0f1115]">
                <div className="flex items-start justify-between gap-4 p-5 pb-4">
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
                      Requested volume
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-white/40">
                      Lifetime total of requests issued through this console
                    </p>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="text-[1.9rem] font-semibold leading-none tracking-[-0.025em] text-white tabular-nums">
                        12,480.00
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                        USDC
                      </span>
                    </div>
                  </div>
                  <div className="rounded-sm border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                    <p className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-white/40">
                      Signing account
                    </p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-white/85">
                      0x7e48&thinsp;&thinsp;a81c
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-4 border-t border-white/[0.06]">
                  {[
                    { l: "Verified", v: "9,820.00", u: "USDC", t: "text-emerald-400/90" },
                    { l: "Pending", v: "2,660.00", u: "USDC", t: "text-white/90" },
                    { l: "Requests", v: "42", t: "text-white/90" },
                    { l: "Settlement rate", v: "96%", t: "text-emerald-400/90" },
                  ].map((m, i) => (
                    <div
                      key={m.l}
                      className={[
                        "px-4 py-3",
                        i !== 0 ? "border-l border-white/[0.06]" : "",
                      ].join(" ")}
                    >
                      <dt className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-white/40">
                        {m.l}
                      </dt>
                      <dd className="mt-1 flex items-baseline gap-1.5">
                        <span className={`text-[13px] font-semibold tabular-nums ${m.t}`}>
                          {m.v}
                        </span>
                        {m.u && (
                          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">
                            {m.u}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Ledger */}
              <div className="mt-4 overflow-hidden rounded-[6px] border border-white/[0.06] bg-[#0f1115]">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
                      Ledger
                    </p>
                    <p className="mt-0.5 text-[12px] font-semibold text-white">
                      Recent requests
                    </p>
                  </div>
                  <span className="font-mono text-[10px] text-white/40">3 records</span>
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/[0.05] bg-white/[0.01]">
                      {["Status", "Reference", "Recipient", "Amount"].map((h, i) => (
                        <th
                          key={h}
                          className={[
                            "px-5 py-2 font-mono text-[8.5px] uppercase tracking-[0.18em] text-white/40",
                            i === 3 ? "text-right" : "",
                          ].join(" ")}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { s: "Paid", d: "bg-emerald-400/90", c: "text-emerald-400/90", ref: "Invoice 042", r: "0x7e\u2026a81c", a: "1,250.00" },
                      { s: "Open", d: "bg-sky-400/80", c: "text-sky-300/90", ref: "Invoice 041", r: "0x4b\u202659e3", a: "480.00" },
                      { s: "Paid", d: "bg-emerald-400/90", c: "text-emerald-400/90", ref: "Retainer Q2", r: "0xa1\u20262f7d", a: "4,500.00" },
                    ].map((row) => (
                      <tr key={row.ref} className="border-b border-white/[0.04] last:border-b-0">
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`h-1.5 w-1.5 rounded-full ${row.d}`} />
                            <span className={`text-[11px] font-medium ${row.c}`}>{row.s}</span>
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-[11.5px] font-medium text-white/90">{row.ref}</td>
                        <td className="px-5 py-2.5 font-mono text-[10.5px] text-white/50">{row.r}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-[11.5px] text-white/90">
                          {row.a}
                          <span className="ml-1 font-mono text-[9px] text-white/40">USDC</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * HowItWorks. Three steps, single row, scannable.
 * ========================================================== */

function HowItWorks() {
  const ref = useReveal<HTMLDivElement>();
  const steps = [
    {
      n: "01",
      t: "Create a QR request",
      d: "Enter recipient, amount, and invoice note. Disburse encodes it as a portable QR payload.",
      icon: QrCode,
    },
    {
      n: "02",
      t: "Payer settles in USDC",
      d: "Scan, connect a wallet, and sign one ERC-20 transfer. Arc settles direct. Base and Monad settle via Polymer proofs.",
      icon: Wallet,
    },
    {
      n: "03",
      t: "Receive a verifiable receipt",
      d: "A Verifiable Settlement Receipt is derived from the onchain transfer log. Export as JSON, UBL 2.1 XML, or PDF.",
      icon: ShieldCheck,
    },
  ];

  return (
    <section className="border-b border-white/[0.05]">
      <div ref={ref} className="reveal mx-auto max-w-[1180px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="How it works"
          title="From invoice to receipt in three steps."
        />

        <ol className="mt-12 grid grid-cols-1 gap-px bg-white/[0.05] md:grid-cols-3">
          {steps.map((s) => {
            const Icon = s.icon;
            return (
              <li
                key={s.n}
                className="bg-[#0a0b0e] p-7 transition-colors hover:bg-[#0e0f13]"
              >
                <div className="mb-5 flex items-center justify-between">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 bg-white/[0.02] text-white/80">
                    <Icon size={14} strokeWidth={1.6} />
                  </span>
                  <span className="font-mono text-[10px] tracking-[0.16em] text-white/30">{s.n}</span>
                </div>
                <p className="mb-1.5 text-[14.5px] font-medium tracking-[-0.005em] text-white">{s.t}</p>
                <p className="text-[12.5px] leading-relaxed text-white/55">{s.d}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ============================================================
 * Features. One tight 2-by-3 grid. Merges principles + compliance.
 * ========================================================== */

function Features() {
  const items = [
    {
      icon: Lock,
      title: "Non-custodial",
      body: "The wallet signs. Disburse only prepares calldata and verifies results.",
    },
    {
      icon: CheckCircle2,
      title: "Exact-match verification",
      body: "A request is paid only when the Transfer log matches token, recipient, and amount.",
    },
    {
      icon: ShieldCheck,
      title: "Verifiable Settlement Receipt",
      body: "Structured JSON proof, SHA-256 fingerprinted, re-derivable from the tx hash.",
    },
    {
      icon: FileText,
      title: "UBL 2.1 e-invoice",
      body: "Machine-readable XML that EU e-invoicing systems already accept.",
    },
    {
      icon: ReceiptText,
      title: "Human-readable PDF",
      body: "One-page receipt with amount, parties, tx hash, and an Arcscan link.",
    },
    {
      icon: Zap,
      title: "Fast on Arc",
      body: "Arc source payments settle in about fifteen seconds. Cross-chain in a few minutes.",
    },
  ];

  return (
    <section className="border-b border-white/[0.05]">
      <div className="mx-auto max-w-[1180px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="Principles"
          title="Six properties that make a payment auditable."
          lede="Every claim below is checked on chain before a request is marked paid."
        />

        <div className="mt-12 grid grid-cols-1 gap-px bg-white/[0.05] sm:grid-cols-2 lg:grid-cols-3">
          {items.map((f) => {
            const Icon = f.icon;
            return <FeatureCard key={f.title} icon={<Icon size={15} strokeWidth={1.5} />} title={f.title} body={f.body} />;
          })}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
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
    <div ref={ref} className="reveal bg-[#0a0b0e] p-7 transition-colors hover:bg-[#0e0f13]">
      <span className="mb-5 inline-flex h-8 w-8 items-center justify-center rounded-sm border border-white/[0.08] bg-white/[0.02] text-white/75">
        {icon}
      </span>
      <h3 className="mb-1.5 text-[14.5px] font-medium tracking-[-0.005em] text-white">
        {title}
      </h3>
      <p className="text-[12.5px] leading-relaxed text-white/55">{body}</p>
    </div>
  );
}

/* ============================================================
 * CrossChain. Simplified, single row of chains.
 * ========================================================== */

function CrossChain() {
  const routes = [
    { chain: "Arc", speed: "~15 s", route: "Direct ERC-20", gas: "USDC" },
    { chain: "Base Sepolia", speed: "~2\u20135 min", route: "Polymer proof", gas: "ETH" },
    { chain: "Monad", speed: "~2\u20135 min", route: "Polymer proof", gas: "MON" },
  ];
  return (
    <section className="border-b border-white/[0.05]">
      <div className="mx-auto max-w-[1180px] px-6 py-20 md:px-10 md:py-24">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <SectionHeader
              eyebrow={
                <span className="inline-flex items-center gap-2">
                  <Layers size={12} strokeWidth={1.5} className="text-white/40" />
                  Any chain in, USDC out
                </span>
              }
              title={
                <>
                  Payers pick their chain.
                  <br />
                  <span className="italic font-normal text-white/50" style={{ fontFamily: "var(--font-serif)" }}>
                    Recipients receive on Arc.
                  </span>
                </>
              }
              lede="The request, the QR, and the receipt stay the same regardless of where the payer signs."
            />
          </div>

          <div className="md:col-span-7">
            <div className="grid grid-cols-1 gap-px bg-white/[0.05] sm:grid-cols-3">
              {routes.map((r) => (
                <div key={r.chain} className="bg-[#0a0b0e] p-5">
                  <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/40">
                    {r.route}
                  </p>
                  <h4 className="mb-5 text-[14.5px] font-medium tracking-[-0.005em] text-white">{r.chain}</h4>
                  <dl className="space-y-2 text-[11px]">
                    <div className="flex justify-between border-t border-white/[0.04] pt-2">
                      <dt className="font-mono uppercase tracking-[0.16em] text-white/35">Settle</dt>
                      <dd className="tabular-nums text-white/80">{r.speed}</dd>
                    </div>
                    <div className="flex justify-between border-t border-white/[0.04] pt-2">
                      <dt className="font-mono uppercase tracking-[0.16em] text-white/35">Gas</dt>
                      <dd className="tabular-nums text-white/80">{r.gas}</dd>
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
 * FAQ. Short. Accordion.
 * ========================================================== */

function FAQ() {
  const items = [
    {
      q: "Does Disburse hold funds at any point?",
      a: "No. Payments are submitted from the payer wallet directly to the recipient address. The app never holds balances or signing keys.",
    },
    {
      q: "What counts as a paid invoice?",
      a: "A request is marked paid only when a Transfer log on the correct token contract, to the exact recipient address, for the exact amount, has confirmed on chain.",
    },
    {
      q: "Which chains are supported today?",
      a: "Arc Testnet for direct settlement. Base Sepolia and Monad Testnet as source chains. Cross-chain payments settle on Arc via Polymer cryptographic proofs.",
    },
    {
      q: "How is a Verifiable Settlement Receipt different from a PDF invoice?",
      a: "A VSR is a structured JSON document with a SHA-256 fingerprint. Anyone can re-derive the same record from the transaction hash without access to Disburse.",
    },
    {
      q: "What is stored in my browser versus the backend?",
      a: "QR requests and receipts live in localStorage so history stays offline. If a Supabase backend is configured, QR confirmations also sync through a thin API so payer and requester see the same realtime state.",
    },
  ];

  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="border-b border-white/[0.05]">
      <div className="mx-auto max-w-[1180px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader eyebrow="Frequently asked" title="The short list." />

        <div className="mt-10 divide-y divide-white/[0.05] border-y border-white/[0.05]">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 py-4 text-left transition-colors hover:text-white"
                >
                  <span className="text-[14px] font-medium tracking-[-0.005em] text-white/85">{item.q}</span>
                  <span
                    aria-hidden="true"
                    className={[
                      "ml-4 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/60 transition-transform",
                      isOpen ? "rotate-45 border-white/30 text-white" : "",
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
                    <p className="max-w-[72ch] pb-5 pr-10 text-[13px] leading-relaxed text-white/55">
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
 * FinalCta. One line, two buttons, no pills.
 * ========================================================== */

function FinalCta({ urls }: { urls: Urls }) {
  return (
    <section className="border-b border-white/[0.05]">
      <div className="relative mx-auto max-w-[1180px] overflow-hidden px-6 py-24 md:px-10 md:py-28">
        <div className="relative mx-auto max-w-xl text-center">
          <p className="mb-5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
            Ready when you are
          </p>
          <h2 className="text-[clamp(1.75rem,3.75vw,2.75rem)] font-medium leading-[1.1] tracking-[-0.025em] text-white">
            Try it in under a minute.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-[14px] leading-relaxed text-white/55">
            Connect a wallet, grab test USDC from the Circle faucet, and walk
            a full request, payment, verification, and receipt export flow.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
            <a
              href={urls.appUrl}
              style={{ color: "#0a0b0e" }}
              className="group inline-flex items-center gap-1.5 rounded-[4px] bg-white px-5 py-3 text-[13px] font-semibold tracking-[-0.005em] shadow-sm transition-colors hover:bg-neutral-200"
            >
              Open the console
              <ArrowRight size={14} strokeWidth={2.25} style={{ color: "#0a0b0e" }} className="transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href={urls.docsUrl}
              className="group inline-flex items-center gap-1.5 rounded-[4px] border border-white/10 px-5 py-3 text-[13px] font-medium text-white/85 transition-colors hover:border-white/20 hover:text-white"
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
 * Footer.
 * ========================================================== */

function Footer() {
  return (
    <footer className="bg-[#08090c]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-7 px-6 py-10 md:flex-row md:items-start md:justify-between md:px-10">
        <div className="max-w-sm">
          <div className="mb-3 flex items-center gap-2">
            <img src="/favicon.png" alt="" className="h-[18px] w-[18px]" aria-hidden="true" />
            <span className="text-[13px] font-semibold tracking-[-0.01em] text-white">
              Disburse
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-white/45">
            A non-custodial receipt layer for stablecoin payments. Built for
            freelancers, DAOs, and teams that need settlement they can audit.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-10 md:grid-cols-3 md:gap-12">
          <FooterColumn
            title="Product"
            items={[
              { label: "Console", href: "https://app.disburse.online" },
              { label: "Documentation", href: "https://docs.disburse.online" },
            ]}
          />
          <FooterColumn
            title="Ecosystem"
            items={[
              { label: "USDC", href: "https://www.circle.com/usdc" },
              { label: "Arc", href: "https://www.circle.com/arc" },
              { label: "Polymer", href: "https://www.polymerlabs.org" },
            ]}
          />
          <FooterColumn
            title="Follow"
            items={[
              { label: "GitHub", href: "https://github.com/Disburse-pay" },
              { label: "X / Twitter", href: "https://x.com/Disburs3" },
            ]}
          />
        </div>
      </div>
      <div className="border-t border-white/[0.04]">
        <div className="mx-auto flex max-w-[1180px] flex-col items-start justify-between gap-2 px-6 py-4 text-[10.5px] text-white/30 md:flex-row md:items-center md:px-10">
          <span className="font-mono uppercase tracking-[0.18em]">
            Disburse 2026
          </span>
          <span className="font-mono uppercase tracking-[0.18em]">
            Testnet build, not for production
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  items,
}: {
  title: string;
  items: { label: string; href: string }[];
}) {
  return (
    <div>
      <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.22em] text-white/35">
        {title}
      </p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label}>
            <a
              href={item.href}
              target={item.href.startsWith("http") ? "_blank" : undefined}
              rel={item.href.startsWith("http") ? "noreferrer" : undefined}
              className="inline-flex items-center gap-1.5 text-[12px] text-white/65 transition-colors hover:text-white"
            >
              {item.label}
              {item.href.startsWith("http") && (
                <ArrowUpRight size={11} strokeWidth={1.6} className="text-white/30" />
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================================================
 * Section header helper.
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
    <div ref={ref} className="reveal max-w-xl">
      <p className="mb-4 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">
        <span className="h-[1px] w-6 bg-white/20" aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-medium leading-[1.15] tracking-[-0.02em] text-white">
        {title}
      </h2>
      {lede && <p className="mt-4 text-[14px] leading-relaxed text-white/55">{lede}</p>}
    </div>
  );
}

/* ============================================================
 * Scoped CSS.
 * ========================================================== */

const LANDING_CSS = `
  .landing-root {
    letter-spacing: -0.005em;
    font-feature-settings: "ss01", "cv11";
  }

  .landing-root .reveal {
    opacity: 0;
    transform: translateY(6px);
    transition:
      opacity 520ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 520ms cubic-bezier(0.16, 1, 0.3, 1);
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
`;
