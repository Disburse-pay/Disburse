import type { PaymentRequest, Receipt } from "../lib/payments";
import { useI18n } from "../lib/i18n";

type Props = {
  requests: PaymentRequest[];
  receipts: Receipt[];
  onExport: () => void;
};

export default function ImportExportPage({ requests, receipts, onExport }: Props) {
  const { t } = useI18n();
  return (
    <section className="ql-page" aria-label="Data export">
      <p className="ql-page-lede">
        Export contains the active wallet&apos;s non-secret, server-backed ledger metadata only.
        QR bearer capabilities and payer authorizations are never written to the JSON file.
      </p>
      <div className="ql-ie-grid">
        <article className="ql-ie-card">
          <p className="form-section-label">Export</p>
          <h3>{t("exportHistory")}</h3>
          <p className="ql-ie-card-text">
            {t("exportHistoryText", { requests: requests.length, receipts: receipts.length })}
          </p>
          <button className="primary-button" type="button" onClick={onExport} disabled={!requests.length}>
            {t("exportJson")}
          </button>
        </article>
      </div>
      <aside className="ql-ie-note">
        <p className="form-section-label">Privacy</p>
        <p>
          History is loaded from a wallet-signed Disburse API request. Switching or disconnecting the
          wallet clears it from browser memory immediately.
        </p>
      </aside>
    </section>
  );
}
