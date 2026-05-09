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
    <div className="landing-root min-h-screen bg-[#050505] font-sans text-[#eaeaea] antialiased selection:bg-emerald-400/30 selection:text-white">
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
          ? "border-b border-white/[0.08] bg-[#050505]/90 backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
      ].join(" ")}
    >
      <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between px-6 md:px-10">
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
            href="https://github.com/Disburse-pay"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-md px-3 py-1.5 text-xs text-white/60 transition-colors hover:text-white sm:inline-block"
          >
            GitHub
          </a>
          <a
            href={urls.appUrl}
            className="group ml-2 inline-flex items-center gap-1.5 rounded-[4px] bg-white px-3 py-1.5 text-[12px] font-medium tracking-[-0.005em] text-[#0a0b0e] transition-colors hover:bg-white/92"
          >
            Launch app
            <ArrowRight
              size={12}
              strokeWidth={2}
              className="text-[#0a0b0e]/70 transition-transform group-hover:translate-x-0.5"
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
    <section className="relative overflow-hidden border-b border-white/[0.06] pt-28 pb-20 md:pt-36 md:pb-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_-10%,rgba(52,211,153,0.06),transparent_70%)]"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid-bg" />

      <div className="relative mx-auto max-w-[1180px] px-6 md:px-10">
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mb-7 font-mono text-[10.5px] uppercase tracking-[0.22em] text-white/40"
        >
          Verifiable stablecoin settlement
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.05 }
          }
          className="max-w-[20ch] text-[clamp(2.25rem,5.25vw,4.5rem)] font-semibold leading-[1.02] tracking-[-0.035em]"
        >
          Stablecoin invoices
          <br />
          <span className="text-white/55">with receipts you can verify.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.12 }
          }
          className="mt-7 max-w-[52ch] text-[15.5px] leading-[1.6] text-white/60"
        >
          Issue a QR request. The payer settles from any supported chain
          in USDC. Disburse turns the onchain transfer into a structured
          receipt that your accountant or auditor can actually file.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.2 }
          }
          className="mt-8 flex flex-wrap items-center gap-3"
        >
          <a
            href={urls.appUrl}
            className="group inline-flex items-center gap-1.5 rounded-md bg-emerald-400 px-5 py-3 text-[13px] font-semibold tracking-tight text-[#04110b] transition-transform hover:-translate-y-px hover:bg-emerald-300"
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

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.6, delay: 0.32 }}
          className="mt-10 flex flex-wrap items-center gap-1.5 text-[11.5px] text-white/35"
        >
          <Lock size={11} strokeWidth={1.75} className="text-white/30" />
          No signup, no custody, no private keys.
        </motion.div>
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
    <section className="border-b border-white/[0.06] bg-[#060607]">
      <div
        ref={ref}
        className="reveal mx-auto flex max-w-[1180px] flex-col items-start gap-5 px-6 py-7 md:flex-row md:items-center md:justify-between md:px-10"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/35">
          Built on the USDC ecosystem
        </p>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {rails.map((r) => (
            <li
              key={r.label}
              className="flex items-baseline gap-1.5 text-[12.5px] text-white/70"
            >
              <span className="font-semibold tracking-tight text-white/90">{r.label}</span>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/30">
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
    <section className="border-b border-white/[0.06]">
      <div
        ref={ref}
        className="reveal relative mx-auto max-w-[1180px] px-6 pb-20 md:px-10 md:pb-24"
      >
        <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-px">
          <div className="relative overflow-hidden rounded-[11px] bg-[#070708]">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-white/10" />
                <span className="h-2 w-2 rounded-full bg-white/10" />
                <span className="h-2 w-2 rounded-full bg-white/10" />
              </div>
              <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 font-mono text-[10px] text-white/40">
                app.disburse.online
              </div>
              <div className="w-14" />
            </div>

            <div className="grid grid-cols-12">
              <aside className="col-span-12 border-b border-white/[0.06] p-5 md:col-span-3 md:border-b-0 md:border-r md:border-white/[0.06]">
                <div className="mb-5 flex items-center gap-2">
                  <img src="/favicon.png" alt="" className="h-4 w-4 opacity-80" aria-hidden="true" />
                  <span className="text-[12px] font-semibold tracking-tight">Disburse</span>
                </div>
                <ul className="space-y-0.5 text-[12px]">
                  {[
                    { label: "Overview", active: true },
                    { label: "Direct send" },
                    { label: "QR requests" },
                    { label: "Documentation" },
                  ].map((i) => (
                    <li
                      key={i.label}
                      className={[
                        "rounded-md px-2.5 py-1.5",
                        i.active ? "bg-emerald-400/10 text-white" : "text-white/45",
                      ].join(" ")}
                    >
                      {i.label}
                    </li>
                  ))}
                </ul>
              </aside>

              <div className="col-span-12 p-6 md:col-span-9">
                <div className="mb-5">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                    Total requested volume
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[2rem] font-semibold tracking-tight tabular-nums">
                      12,480.00
                    </span>
                    <span className="text-[12.5px] text-white/40">USDC</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.06] sm:grid-cols-4">
                  {[
                    { l: "Verified", v: "9,820.00", u: "USDC", t: "text-emerald-400" },
                    { l: "Pending", v: "2,660.00", u: "USDC", t: "text-sky-300" },
                    { l: "Requests", v: "42", t: "text-white" },
                    { l: "Success", v: "96%", t: "text-emerald-400" },
                  ].map((m) => (
                    <div key={m.l} className="bg-[#070708] p-3">
                      <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
                        {m.l}
                      </p>
                      <p className={`text-[14px] font-semibold tabular-nums ${m.t}`}>
                        {m.v}
                        {m.u && (
                          <span className="ml-1 text-[10px] font-normal text-white/40">
                            {m.u}
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 overflow-hidden rounded-lg border border-white/[0.06]">
                  <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.015] px-4 py-2.5">
                    <span className="text-[11px] font-semibold">Recent activity</span>
                    <span className="font-mono text-[10px] text-white/35">3 records</span>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {[
                      { s: "Paid", d: "bg-emerald-400", c: "text-emerald-400", ref: "Invoice 042", a: "1,250.00" },
                      { s: "Open", d: "bg-sky-400", c: "text-sky-300", ref: "Invoice 041", a: "480.00" },
                      { s: "Paid", d: "bg-emerald-400", c: "text-emerald-400", ref: "Retainer Q2", a: "4,500.00" },
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
    <section className="border-b border-white/[0.06]">
      <div ref={ref} className="reveal mx-auto max-w-[1180px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="How it works"
          title="From invoice to receipt in three steps."
        />

        <ol className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {steps.map((s) => {
            const Icon = s.icon;
            return (
              <li
                key={s.n}
                className="relative rounded-lg border border-white/[0.06] bg-white/[0.015] p-6 transition-colors hover:border-emerald-400/25 hover:bg-white/[0.03]"
              >
                <div className="mb-4 flex items-center gap-2.5">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/5 text-emerald-400">
                    <Icon size={14} strokeWidth={1.75} />
                  </span>
                  <span className="font-mono text-[10px] text-white/40">{s.n}</span>
                </div>
                <p className="mb-1.5 text-[15px] font-semibold text-white">{s.t}</p>
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
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1180px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="Why it works"
          title="Six properties that make a payment auditable."
          lede="Every claim below is checked on chain before a request is marked paid."
        />

        <div className="mt-12 grid grid-cols-1 gap-px bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-3">
          {items.map((f) => {
            const Icon = f.icon;
            return <FeatureCard key={f.title} icon={<Icon size={16} strokeWidth={1.5} />} title={f.title} body={f.body} />;
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
    <div ref={ref} className="reveal bg-[#050505] p-7">
      <span className="mb-4 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-white/70">
        {icon}
      </span>
      <h3 className="mb-1.5 text-[15px] font-semibold tracking-tight text-white">
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
    { chain: "Base Sepolia", speed: "~2 to 5 min", route: "Polymer proof", gas: "ETH" },
    { chain: "Monad", speed: "~2 to 5 min", route: "Polymer proof", gas: "MON" },
  ];
  return (
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1180px] px-6 py-20 md:px-10 md:py-24">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <SectionHeader
              eyebrow={
                <span className="inline-flex items-center gap-1.5">
                  <Layers size={13} strokeWidth={1.5} className="text-emerald-400/70" />
                  Any chain in, USDC out
                </span>
              }
              title={
                <>
                  Payers pick their chain.
                  <br />
                  <span className="text-white/50">Recipients receive on Arc.</span>
                </>
              }
              lede="The request, the QR, and the receipt stay the same regardless of where the payer signs."
            />
          </div>

          <div className="md:col-span-7">
            <div className="grid grid-cols-1 gap-px bg-white/[0.06] sm:grid-cols-3">
              {routes.map((r) => (
                <div key={r.chain} className="bg-[#050505] p-5">
                  <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-400/70">
                    {r.route}
                  </p>
                  <h4 className="mb-5 text-[15px] font-semibold text-white">{r.chain}</h4>
                  <dl className="space-y-1.5 text-[11px] text-white/40">
                    <div className="flex justify-between">
                      <dt>Settle</dt>
                      <dd className="text-white/75">{r.speed}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Gas</dt>
                      <dd className="text-white/75">{r.gas}</dd>
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
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1180px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader eyebrow="FAQ" title="The short list." />

        <div className="mt-10 divide-y divide-white/[0.06] border-y border-white/[0.06]">
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
                  <span className="text-[14.5px] font-medium text-white/85">{item.q}</span>
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
                    <p className="max-w-[72ch] pb-5 pr-10 text-[13.5px] leading-relaxed text-white/55">
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
    <section className="border-b border-white/[0.06]">
      <div className="relative mx-auto max-w-[1180px] overflow-hidden px-6 py-24 md:px-10 md:py-28">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(52,211,153,0.06),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-xl text-center">
          <h2 className="text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-[1.08] tracking-[-0.025em]">
            Try it in under a minute.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-[14.5px] leading-relaxed text-white/55">
            Connect a wallet, grab test USDC from the Circle faucet, and walk
            a full request, payment, verification, and receipt export flow.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={urls.appUrl}
              className="group inline-flex items-center gap-1.5 rounded-md bg-emerald-400 px-5 py-3 text-[13px] font-semibold tracking-tight text-[#04110b] transition-transform hover:-translate-y-px hover:bg-emerald-300"
            >
              Open the console
              <ArrowRight size={14} strokeWidth={2.25} className="transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href={urls.docsUrl}
              className="group inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.02] px-5 py-3 text-[13px] font-medium text-white/80 transition-colors hover:border-white/20 hover:text-white"
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
    <footer className="bg-[#060607]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-7 px-6 py-10 md:flex-row md:items-start md:justify-between md:px-10">
        <div className="max-w-sm">
          <div className="mb-3 flex items-center gap-2">
            <img src="/favicon.png" alt="" className="h-5 w-5" aria-hidden="true" />
            <span className="text-[13px] font-semibold tracking-tight text-white">
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
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
        {title}
      </p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label}>
            <a
              href={item.href}
              target={item.href.startsWith("http") ? "_blank" : undefined}
              rel={item.href.startsWith("http") ? "noreferrer" : undefined}
              className="inline-flex items-center gap-1.5 text-[12.5px] text-white/65 transition-colors hover:text-white"
            >
              {item.label}
              {item.href.startsWith("http") && (
                <ArrowUpRight size={11} strokeWidth={1.75} className="text-white/30" />
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
      <p className="mb-4 font-mono text-[10.5px] uppercase tracking-[0.22em] text-white/40">
        {eyebrow}
      </p>
      <h2 className="text-[clamp(1.5rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-white">
        {title}
      </h2>
      {lede && <p className="mt-4 text-[14.5px] leading-relaxed text-white/55">{lede}</p>}
    </div>
  );
}

/* ============================================================
 * Scoped CSS.
 * ========================================================== */

const LANDING_CSS = `
  .landing-root {
    letter-spacing: -0.005em;
  }

  .landing-root .reveal {
    opacity: 0;
    transform: translateY(8px);
    transition:
      opacity 600ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 600ms cubic-bezier(0.16, 1, 0.3, 1);
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

  .landing-root .grid-bg {
    opacity: 0.25;
    background-size: 48px 48px;
    background-image:
      linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px);
    -webkit-mask-image: radial-gradient(ellipse 70% 55% at 50% 0%, black 0%, transparent 80%);
            mask-image: radial-gradient(ellipse 70% 55% at 50% 0%, black 0%, transparent 80%);
  }
`;
