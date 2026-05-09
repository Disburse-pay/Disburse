import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FileText,
  Layers,
  ShieldCheck,
} from "lucide-react";

/* --------------------------------------------------------------------
 * A low-noise, editorial landing page. One accent (emerald), one grain
 * layer, and calmer section transitions. Copy leans human, not protocol-
 * speak.
 * ------------------------------------------------------------------ */

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
  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const appUrl = isLocal ? "http://app.localhost:5173" : "https://app.disburse.online";
  const docsUrl = isLocal ? "/docs" : "https://docs.disburse.online";
  const reduceMotion = useReducedMotion();

  return (
    <div className="landing-root min-h-screen bg-[#050505] font-sans text-[#eaeaea] antialiased selection:bg-emerald-400/30 selection:text-white">
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />

      <Nav appUrl={appUrl} docsUrl={docsUrl} />
      <Hero appUrl={appUrl} docsUrl={docsUrl} reduceMotion={Boolean(reduceMotion)} />
      <Principles />
      <Pipeline />
      <Compliance />
      <CrossChain />
      <FinalCta appUrl={appUrl} />
      <Footer />
    </div>
  );
}

/* ---------- Nav ---------- */

function Nav({ appUrl, docsUrl }: { appUrl: string; docsUrl: string }) {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-[#050505]/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-6 md:px-10">
        <a href="/" className="flex items-center gap-2.5" aria-label="Disburse home">
          <img src="/favicon.png" alt="" className="h-5 w-5" aria-hidden="true" />
          <span className="text-[13px] font-semibold tracking-tight">Disburse</span>
        </a>
        <div className="flex items-center gap-1">
          <a
            href={docsUrl}
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
            href={appUrl}
            className="group ml-1 inline-flex items-center gap-1.5 rounded-md bg-white px-3.5 py-1.5 text-[12px] font-medium text-black transition-transform hover:-translate-y-px"
          >
            Launch app
            <ArrowRight
              size={14}
              strokeWidth={2}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </a>
        </div>
      </div>
    </nav>
  );
}

/* ---------- Hero ---------- */

function Hero({
  appUrl,
  docsUrl,
  reduceMotion,
}: {
  appUrl: string;
  docsUrl: string;
  reduceMotion: boolean;
}) {
  return (
    <section className="relative overflow-hidden border-b border-white/[0.06] pt-32 pb-24 md:pt-40 md:pb-32">
      {/* ONE calm background layer: subtle radial wash, nothing else. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(52,211,153,0.06),transparent_70%)]"
      />
      {/* A single faint grain at 2% opacity, not 3% + grid + glow. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grain" />

      <div className="relative mx-auto max-w-[1280px] px-6 md:px-10">
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 text-[11px] text-white/60"
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
            aria-hidden="true"
          />
          <span>Live on Arc Testnet</span>
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.05 }
          }
          className="max-w-[14ch] text-[clamp(2.25rem,6vw,5.5rem)] font-semibold leading-[1.02] tracking-[-0.03em]"
        >
          Stablecoin invoices
          <br />
          <span className="text-white/50">with receipts that</span>
          <br />
          actually settle.
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
          Send a QR request. The payer settles from any supported chain. Disburse
          writes a verifiable receipt you can hand to your accountant — signed
          from chain data, not a spreadsheet.
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
            href={appUrl}
            className="group inline-flex items-center gap-1.5 rounded-md bg-white px-5 py-3 text-[13px] font-medium text-black transition-transform hover:-translate-y-px"
          >
            Launch the console
            <ArrowRight
              size={14}
              strokeWidth={2}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </a>
          <a
            href={docsUrl}
            className="group inline-flex items-center gap-1.5 rounded-md border border-white/10 px-5 py-3 text-[13px] font-medium text-white/80 transition-colors hover:border-white/20 hover:text-white"
          >
            Read the docs
            <ArrowUpRight
              size={14}
              strokeWidth={1.75}
              className="text-white/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </a>
        </motion.div>

        {/* Quiet footnote of supported rails */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.6, delay: 0.4 }}
          className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-white/35"
        >
          <span className="uppercase tracking-[0.2em]">Settles on</span>
          <span>Arc Testnet</span>
          <span className="text-white/20">·</span>
          <span>Base Sepolia</span>
          <span className="text-white/20">·</span>
          <span>Monad Testnet</span>
          <span className="text-white/20">·</span>
          <span>USDC / EURC</span>
        </motion.div>
      </div>
    </section>
  );
}

/* ---------- Principles ---------- */

function Principles() {
  return (
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1280px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="Principles"
          title="Three non-negotiables."
          lede="Not a wallet. Not a custodian. Just a console that turns a wallet signature into a clean accounting record."
        />

        <div className="mt-12 grid grid-cols-1 gap-px bg-white/[0.06] md:grid-cols-3">
          <Principle
            number="01"
            title="The wallet is the authority"
            body="Disburse prepares the calldata, the wallet signs it. We never hold a private key, never touch a balance, and never gate withdrawal."
          />
          <Principle
            number="02"
            title="QR is the contract"
            body="A payment request is a tiny, portable JSON payload in a QR code. Scan it, inspect it, pay it. No account, no backend login."
          />
          <Principle
            number="03"
            title="Chain data is the source of truth"
            body="A receipt is only green when a Transfer log on the correct token, to the exact recipient, for the exact amount, has confirmed."
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
    <div ref={ref} className="reveal group relative bg-[#050505] p-10 md:p-12">
      <span className="mb-8 block font-mono text-[11px] text-white/30">{number}</span>
      <h3 className="mb-3 text-[20px] font-semibold tracking-tight text-white">
        {title}
      </h3>
      <p className="max-w-sm text-[14px] leading-relaxed text-white/55">{body}</p>
    </div>
  );
}

/* ---------- Pipeline ---------- */

function Pipeline() {
  const ref = useReveal<HTMLDivElement>();
  const steps = [
    { n: "01", t: "Request", d: "Recipient, amount, token, invoice date. Encoded into a QR payload." },
    { n: "02", t: "Submit", d: "Payer scans, connects a wallet, signs an ERC-20 transfer." },
    { n: "03", t: "Confirm", d: "Transaction lands on Arc. Cross-chain settles via Polymer proof." },
    { n: "04", t: "Verify", d: "Receipt derived from raw Transfer logs — not a database." },
    { n: "05", t: "Attest", d: "SHA-256 fingerprinted record. Export as JSON, UBL XML, or PDF." },
  ];
  return (
    <section className="border-b border-white/[0.06]">
      <div ref={ref} className="reveal mx-auto max-w-[1280px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="Lifecycle"
          title="From invoice to attestation."
          lede="Most payment tools stop at 'transaction sent.' Disburse keeps going until the accountant has something to file."
        />

        {/* Horizontal pipeline on lg+, vertical on mobile. */}
        <ol className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-5">
          {steps.map((s, i) => (
            <li
              key={s.n}
              className="relative rounded-lg border border-white/[0.06] bg-white/[0.015] p-5"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/5 font-mono text-[10px] text-emerald-400">
                  {s.n}
                </span>
                {i < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="hidden h-px flex-1 bg-gradient-to-r from-emerald-400/30 via-white/10 to-transparent md:block"
                  />
                )}
              </div>
              <p className="mb-1 text-[14px] font-semibold text-white">{s.t}</p>
              <p className="text-[12px] leading-relaxed text-white/50">{s.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- Compliance ---------- */

function Compliance() {
  return (
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1280px] px-6 py-20 md:px-10 md:py-24">
        <SectionHeader
          eyebrow="Compliance"
          title="Receipts your auditor can open."
          lede="Three formats, one source of truth. Every export is derived from the onchain Transfer log — not from a summary table."
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
            icon={<CheckCircle2 size={18} strokeWidth={1.5} />}
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
      <h3 className="mb-3 text-[18px] font-semibold tracking-tight text-white">
        {title}
      </h3>
      <p className="text-[13px] leading-relaxed text-white/55">{body}</p>
    </div>
  );
}

/* ---------- Cross-chain ---------- */

function CrossChain() {
  const routes = [
    { chain: "Arc Testnet", speed: "~15s", route: "Direct ERC-20", gas: "USDC" },
    { chain: "Base Sepolia", speed: "~2–5 min", route: "Polymer proof", gas: "ETH" },
    { chain: "Monad Testnet", speed: "~2–5 min", route: "Polymer proof", gas: "MON" },
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
              lede="Payers choose their home chain — direct on Arc, or across Base Sepolia and Monad via Polymer proofs. The request, receipt, and invoice stay the same."
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

/* ---------- Final CTA ---------- */

function FinalCta({ appUrl }: { appUrl: string }) {
  return (
    <section className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-[1280px] px-6 py-24 md:px-10 md:py-32">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
            Test a payment end-to-end
            <span className="block text-white/40">in less than a minute.</span>
          </h2>
          <p className="mt-6 text-[15px] text-white/55">
            Connect a wallet, grab testnet USDC from the Arc faucet, and walk the
            full request → confirmation → receipt flow. No signup.
          </p>
          <a
            href={appUrl}
            className="mt-10 inline-flex items-center gap-1.5 rounded-md bg-white px-6 py-3.5 text-[13px] font-medium text-black transition-transform hover:-translate-y-px"
          >
            Open the console
            <ArrowRight size={14} strokeWidth={2} />
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */

function Footer() {
  return (
    <footer className="mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-4 px-6 py-8 text-[11px] text-white/30 md:flex-row md:items-center md:px-10">
      <div className="flex items-center gap-2">
        <img src="/favicon.png" alt="" className="h-4 w-4 opacity-40" aria-hidden="true" />
        <span>Disburse · Non-custodial stablecoin payments</span>
      </div>
      <div className="flex items-center gap-6">
        <a
          href="https://x.com/Disburs3"
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-white/70"
        >
          @Disburs3
        </a>
        <span>&copy; 2026</span>
      </div>
    </footer>
  );
}

/* ---------- Section header helper ---------- */

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

/* ---------- Scoped CSS for landing-only tricks ---------- */

const LANDING_CSS = `
  .landing-root {
    letter-spacing: -0.005em;
  }

  /* Reveal-on-scroll. Falls back gracefully if IntersectionObserver never fires. */
  .landing-root .reveal {
    opacity: 0;
    transform: translateY(10px);
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

  /* A single subtle grain, at lower opacity than the old combo. */
  .landing-root .grain {
    opacity: 0.018;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 160px 160px;
    mix-blend-mode: overlay;
  }
`;
