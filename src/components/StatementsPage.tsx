import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { EthereumProvider } from "../lib/onchain";
import type { PaymentToken } from "../lib/payments";
import { isCurrentWalletAccount } from "../lib/accountScope";
import { assertProviderAccount } from "../lib/providerAccount";
import {
  buildStatementAccessTypedData,
  normalizeStatementAuthorizationQuery,
  STATEMENT_AUTH_TTL_SECONDS
} from "../lib/statementAuthorization";
import DateInput from "./ui/DateInput";

const EIP712_DOMAIN_TYPES = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }
] as const;

type Props = {
  account?: `0x${string}`;
  getWalletProvider: () => Promise<EthereumProvider | undefined>;
};

type StatementBundleView = {
  id: string;
  summary: {
    totalProofs: number;
    totalAmount: string | null;
    token: PaymentToken | "MIXED";
    totals: Partial<Record<PaymentToken, string>>;
    period: { from: string; to: string };
    networkMode: string;
  };
  proofs: Array<{
    uid: string;
    invoice?: { label?: string; amount?: string; token?: string };
  }>;
};

export default function StatementsPage({ account, getWalletProvider }: Props) {
  const [recipient, setRecipient] = useState("");
  const [payer, setPayer] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [bundle, setBundle] = useState<StatementBundleView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeAccountRef = useRef(account);
  activeAccountRef.current = account;

  useEffect(() => {
    // Criteria and results are wallet-private. Clear them as the owner changes,
    // before an old async response can publish into the new account's view.
    setRecipient("");
    setPayer("");
    setFromDate("");
    setToDate("");
    setBundle(null);
    setError(null);
    setLoading(false);
  }, [account]);

  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    if (!recipient && !payer) {
      setError("Provide at least a recipient or payer address.");
      return;
    }
    if (!account) {
      setError("Connect a wallet before generating a private statement.");
      return;
    }

    const statementOwner = account;
    setLoading(true);
    setError(null);
    setBundle(null);

    try {
      const query = normalizeStatementAuthorizationQuery({
        recipient: recipient || undefined,
        payer: payer || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        token: "USDC",
        networkMode: "testnet"
      });
      const walletLower = statementOwner.toLowerCase();
      if (
        query.recipient?.toLowerCase() !== walletLower
        && query.payer?.toLowerCase() !== walletLower
      ) {
        throw new Error("The connected wallet must be the statement recipient or payer.");
      }

      const provider = await getWalletProvider();
      if (!provider) {
        throw new Error("A wallet is required to authorize statement access.");
      }
      await assertProviderAccount(provider, statementOwner);

      const expiresAt = BigInt(
        Math.floor(Date.now() / 1_000) + STATEMENT_AUTH_TTL_SECONDS - 30
      );
      const typedData = buildStatementAccessTypedData({
        wallet: statementOwner,
        query,
        expiresAt
      });
      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [
          statementOwner,
          JSON.stringify(
            {
              ...typedData,
              types: { EIP712Domain: EIP712_DOMAIN_TYPES, ...typedData.types }
            },
            (_key, value) => typeof value === "bigint" ? value.toString() : value
          )
        ]
      });
      if (
        typeof signature !== "string"
        || !/^0x(?:[a-fA-F0-9]{2}){64,2048}$/.test(signature)
      ) {
        throw new Error("Wallet did not return a valid statement authorization.");
      }
      if (!isCurrentWalletAccount(activeAccountRef.current, statementOwner)) return;

      const response = await fetch("/api/statements", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-disburse-wallet": statementOwner,
          "x-disburse-expires-at": expiresAt.toString(),
          "x-disburse-signature": signature
        },
        body: JSON.stringify({
          recipient: query.recipient,
          payer: query.payer,
          from: query.from,
          to: query.to,
          token: query.token,
          network_mode: query.networkMode,
          limit: query.limit
        })
      });
      const payload = await response.json().catch(() => undefined) as unknown;
      if (!response.ok) {
        const message = readErrorMessage(payload) ?? "Failed to generate statement.";
        throw new Error(message);
      }
      if (!isStatementBundle(payload)) {
        throw new Error("Statement service returned an invalid response.");
      }
      if (isCurrentWalletAccount(activeAccountRef.current, statementOwner)) {
        setBundle(payload);
      }
    } catch (cause) {
      if (isCurrentWalletAccount(activeAccountRef.current, statementOwner)) {
        setError(cause instanceof Error ? cause.message : "Statement generation failed.");
      }
    } finally {
      if (isCurrentWalletAccount(activeAccountRef.current, statementOwner)) {
        setLoading(false);
      }
    }
  }

  function handleDownloadJson() {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `disburse-statement-${bundle.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="ql-page" aria-labelledby="statements-heading">
      <p className="ql-page-lede">
        Generate a private, wallet-authorized statement bundle for a counterparty and period.
        PSP signatures can be checked offline; on-chain settlement must be checked separately.
      </p>

      <form onSubmit={handleGenerate} className="ql-form-card">
        <div className="form-section">
          <p className="form-section-label">Counterparty</p>
          <div className="field-grid">
            <Field label="Recipient address">
              <input placeholder="0x..." value={recipient} onChange={(event) => setRecipient(event.target.value)} spellCheck={false} />
            </Field>
            <Field label="Payer / counterparty">
              <input placeholder="0x..." value={payer} onChange={(event) => setPayer(event.target.value)} spellCheck={false} />
            </Field>
          </div>
        </div>

        <div className="form-section">
          <p className="form-section-label">Period</p>
          <div className="field-grid">
            <Field label="From"><DateInput value={fromDate} onChange={setFromDate} /></Field>
            <Field label="To"><DateInput value={toDate} onChange={setToDate} /></Field>
          </div>
        </div>

        <div className="action-row">
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Generating…" : "Generate statement"}
          </button>
        </div>
      </form>

      {error && <div className="notice notice-error">{error}</div>}
      {bundle && (
        <div className="ql-statement-result">
          <div className="ql-statement-result-head">
            <h3>Statement summary</h3>
            <button className="secondary-button" type="button" onClick={handleDownloadJson}>Download JSON</button>
          </div>
          <div className="ql-metric-grid">
            <Metric label="Total amount">
              {bundle.summary.token === "MIXED" || bundle.summary.totalAmount === null
                ? Object.entries(bundle.summary.totals).map(([token, amount]) => `${amount} ${token}`).join(" · ") || "0"
                : <>{bundle.summary.totalAmount} <span className="ql-metric-unit">{bundle.summary.token}</span></>}
            </Metric>
            <Metric label="Proofs">{bundle.summary.totalProofs}</Metric>
            <Metric label="Period" detail>
              {new Date(bundle.summary.period.from).toLocaleDateString()} —{" "}
              {new Date(bundle.summary.period.to).toLocaleDateString()}
            </Metric>
            <Metric label="Network" detail>{bundle.summary.networkMode}</Metric>
          </div>

          {bundle.proofs.length > 0 && (
            <div className="ql-proof-list">
              <p className="form-section-label">Individual proofs</p>
              <div className="ql-proof-rows">
                {bundle.proofs.map((proof) => (
                  <div key={proof.uid} className="ql-proof-row">
                    <div className="ql-proof-row-main">
                      <span className="ql-proof-uid">{proof.uid}</span>
                      <span className="ql-proof-label">{proof.invoice?.label || "—"}</span>
                    </div>
                    <span className="ql-proof-amount">{proof.invoice?.amount} {proof.invoice?.token}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Metric({ label, children, detail = false }: { label: string; children: ReactNode; detail?: boolean }) {
  return <div className="ql-metric"><p className="ql-metric-label">{label}</p><p className={detail ? "ql-metric-detail" : "ql-metric-value"}>{children}</p></div>;
}

function readErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

function isStatementBundle(value: unknown): value is StatementBundleView {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StatementBundleView>;
  return typeof candidate.id === "string"
    && Boolean(candidate.summary && typeof candidate.summary === "object")
    && Array.isArray(candidate.proofs);
}
