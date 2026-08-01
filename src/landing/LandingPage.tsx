import {
  ArrowRight,
  ChevronRight,
  ExternalLink,
  Fingerprint,
  LockKeyhole,
  QrCode,
  ScanLine,
  ShieldCheck,
  Wallet
} from "lucide-react";
import type { CSSProperties } from "react";
import { getAppHref, getBridgeHref, getDocsHref } from "../lib/routing";
import "./landing.css";

const CUBE_FACES = ["front", "back", "right", "left", "top", "bottom"] as const;

export default function LandingPage() {
  return (
    <div className="landing-shell">
      <LandingNav />
      <main>
        <Hero />
        <Architecture />
        <Capabilities />
        <Security />
        <FAQ />
        <FinalAction />
      </main>
      <LandingFooter />
    </div>
  );
}

function LandingNav() {
  return (
    <header className="landing-nav">
      <a className="landing-brand" href="#top" aria-label="Disburse home">
        <img src="/favicon.png" alt="" aria-hidden="true" />
        <span>Disburse</span>
      </a>
      <nav aria-label="Main navigation">
        <a href="#security">Security</a>
        <a href={getBridgeHref()}>Bridge</a>
        <a href={getDocsHref()}>Developers</a>
      </nav>
      <a className="landing-nav-cta" href={getAppHref("/")}>
        Open app <ArrowRight size={14} />
      </a>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="landing-hero">
      <div className="landing-hero-copy">
        <p className="landing-eyebrow">Arc-native payment gateway</p>
        <h1>
          Stablecoin payments,
          <br />
          <em>built to reconcile.</em>
        </h1>
        <p className="landing-hero-lede">
          Accept and send native stablecoins on Arc with fixed QR requests, wallet-scoped history, and
          receipts backed by exact onchain evidence.
        </p>
        <div className="landing-hero-actions">
          <a className="landing-button landing-button-primary" href={getAppHref("/")}>
            Launch console <ArrowRight size={15} />
          </a>
          <a className="landing-button landing-button-secondary" href={getDocsHref()}>
            Read documentation
          </a>
        </div>
        <p className="landing-hero-footnote">
          <ShieldCheck size={14} /> Non-custodial · Arc Testnet
        </p>
      </div>
      <div className="landing-hero-visual" aria-label="Disburse settlement cube">
        <RubiksCube />
      </div>
    </section>
  );
}

function RubiksCube() {
  return (
    <div className="landing-cube-scene" aria-hidden="true">
      <div className="landing-cube">
        {[-1, 0, 1].map((slice) => (
          <div key={slice} className={`landing-cube-slice slice-${slice + 1}`}>
            {Array.from({ length: 9 }, (_, cubieIndex) => {
              const row = Math.floor(cubieIndex / 3) - 1;
              const depth = (cubieIndex % 3) - 1;
              return (
                <span
                  key={cubieIndex}
                  className="landing-cubie"
                  style={{ "--row": row, "--depth": depth } as CSSProperties}
                >
                  {CUBE_FACES.map((face) => (
                    <i key={face} className={face} />
                  ))}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Architecture() {
  return (
    <section className="landing-section landing-architecture">
      <div className="landing-architecture-copy">
        <SectionHeading
          index="01"
          eyebrow="Settlement"
          title="Every paid state has a reason."
          text="A QR request is only the intent. Disburse independently matches canonical Arc evidence before a receipt becomes final."
        />
        <ol className="landing-layer-list">
          <li>
            <span>01</span>
            <div>
              <strong>Locked intent</strong>
              <p>Recipient, token, amount, expiry, and owner authorization.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Canonical evidence</strong>
              <p>Transaction status, block hash, transfer log, payer, and exact value.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Portable record</strong>
              <p>Receipt, statement bundle, webhook, and settlement proof exports.</p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}

function Capabilities() {
  const items = [
    {
      icon: QrCode,
      title: "Fixed QR requests",
      text: "Share a payer-safe link whose settlement terms cannot be edited."
    },
    {
      icon: Wallet,
      title: "Direct wallet sends",
      text: "Move native Arc assets without a hosted balance or custody account."
    },
    {
      icon: ScanLine,
      title: "Exact reconciliation",
      text: "Match payer, recipient, asset, value, transaction, block, and log index."
    },
    {
      icon: Fingerprint,
      title: "Wallet-scoped history",
      text: "Signed access keeps account A records out of account B’s session."
    }
  ];
  return (
    <section className="landing-section landing-capabilities">
      <SectionHeading
        index="02"
        eyebrow="Operations"
        title="Small surface. Complete payment loop."
        text="The console is intentionally narrow: request, send, verify, reconcile, export."
      />
      <div className="landing-capability-grid">
        {items.map(({ icon: Icon, title, text }) => (
          <article key={title}>
            <Icon size={19} />
            <strong>{title}</strong>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Security() {
  return (
    <section id="security" className="landing-security">
      <div>
        <p className="landing-eyebrow">Designed around user safety</p>
        <h2>
          The wallet signs.
          <br />
          The chain decides.
        </h2>
      </div>
      <div className="landing-security-list">
        <p>
          <LockKeyhole size={17} />
          <span>
            <strong>No custody</strong>Disburse never receives a signing key.
          </span>
        </p>
        <p>
          <ShieldCheck size={17} />
          <span>
            <strong>No optimistic “paid” state</strong>Canonical evidence must match the request.
          </span>
        </p>
        <p>
          <Fingerprint size={17} />
          <span>
            <strong>No shared browser history</strong>Account changes clear in-memory records before refetch.
          </span>
        </p>
      </div>
    </section>
  );
}

function FAQ() {
  const questions = [
    [
      "Does Disburse hold funds?",
      "No. Address and QR payments settle wallet-to-wallet. Disburse verifies and records the result."
    ],
    [
      "Why is a receipt different from a transaction link?",
      "A transaction link shows chain activity. A Disburse receipt binds that activity to the original payment terms and exact matching event."
    ],
    [
      "Can I move USDC between Arc and another chain?",
      "Yes, on the separate wallet-only Bridge surface. The initial route uses Circle CCTP V2 Standard Transfer between Ethereum Sepolia and Arc Testnet."
    ],
    [
      "Is mainnet enabled?",
      "No. The current product is explicitly testnet. Mainnet remains locked until addresses, fees, recovery procedures, and an independent security review are complete."
    ]
  ];
  return (
    <section className="landing-section landing-faq">
      <SectionHeading index="03" eyebrow="Questions" title="The useful answers." />
      <div>
        {questions.map(([question, answer]) => (
          <details key={question}>
            <summary>
              {question}
              <ChevronRight size={17} />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalAction() {
  return (
    <section className="landing-final">
      <p>Arc-native payments</p>
      <h2>
        Start with a request.
        <br />
        Finish with evidence.
      </h2>
      <div>
        <a className="landing-button landing-button-primary" href={getAppHref("/")}>
          Open the console <ArrowRight size={15} />
        </a>
        <a className="landing-button landing-button-secondary" href={getBridgeHref()}>
          Bridge USDC <ExternalLink size={14} />
        </a>
      </div>
    </section>
  );
}

function SectionHeading({
  index,
  eyebrow,
  title,
  text
}: {
  index: string;
  eyebrow: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="landing-section-heading">
      <span>{index}</span>
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
        {text && <small>{text}</small>}
      </div>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <a className="landing-brand" href="#top">
        <img src="/favicon.png" alt="" />
        <span>Disburse</span>
      </a>
      <p>Native stablecoin payments on Arc.</p>
      <nav>
        <a href={getAppHref("/")}>App</a>
        <a href={getBridgeHref()}>Bridge</a>
        <a href={getDocsHref()}>Docs</a>
      </nav>
      <small>© 2026 Disburse · Testnet software</small>
    </footer>
  );
}
