import { useMemo, useState } from "react";
import { QrCode } from "lucide-react";
import type { PaymentRequest, Receipt, PaymentStatus } from "../lib/payments";
import {
  encodeRequestPayload,
  isCrossChainPaymentRequest,
  refreshDerivedStatus,
  shortAddress,
} from "../lib/payments";
import { formatInvoiceDate } from "../lib/invoice";
import { useI18n } from "../lib/i18n";

type Props = {
  requests: PaymentRequest[];
  receipts: Receipt[];
  now: Date;
  onNavigate: (target: string) => void;
};

const STATUS_CONFIG: Record<
  PaymentStatus,
  { labelKey: string; dot: string; text: string }
> = {
  open:           { labelKey: "open",    dot: "bg-[var(--blue-text)]",   text: "text-[var(--blue-text)]" },
  paid:           { labelKey: "paid",    dot: "bg-[var(--green-text)]",  text: "text-[var(--green-text)]" },
  expired:        { labelKey: "expired", dot: "bg-[var(--muted)]",       text: "text-[var(--muted)]" },
  failed:         { labelKey: "failed",  dot: "bg-[var(--red-text)]",    text: "text-[var(--red-text)]" },
  possible_match: { labelKey: "review",  dot: "bg-[var(--yellow-text)]", text: "text-[var(--yellow-text)]" },
};

const FILTERS = ["all", "open", "paid", "expired", "failed"] as const;
const FILTER_LABEL: Record<(typeof FILTERS)[number], string> = {
  all: "all",
  open: "open",
  paid: "paid",
  expired: "expired",
  failed: "failed",
};

/**
 * Ledger of recent payment requests.
 *
 * Designed to read like a statement: a quiet header row, a dense hairline
 * grid, tabular numerals, monospace references. No row hover chrome beyond
 * a soft background change.
 */
export default function TransactionsTable({
  requests,
  receipts,
  now,
  onNavigate,
}: Props) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  const displayRequests = useMemo(() => {
    const derived = requests.map((r) => refreshDerivedStatus(r, now));
    const sorted = [...derived].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    if (filter === "all") return sorted;
    return sorted.filter((r) => r.status === filter);
  }, [requests, now, filter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: requests.length };
    for (const r of requests) {
      const d = refreshDerivedStatus(r, now);
      counts[d.status] = (counts[d.status] ?? 0) + 1;
    }
    return counts;
  }, [requests, now]);

  return (
    <section className="overflow-hidden rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
        <div className="flex items-baseline gap-3">
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
              {t("ledger")}
            </p>
            <h3 className="mt-0.5 text-[13.5px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
              {t("recentRequestsLower")}
            </h3>
          </div>
          {requests.length > 0 && (
            <span className="font-mono text-[10px] text-[var(--muted)]">
              {requests.length} {requests.length === 1 ? t("record") : t("records")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--input-bg)] p-0.5">
          {FILTERS.map((f) => {
            const count = statusCounts[f] ?? 0;
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={active}
                className={[
                  "rounded-[3px] px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
                  active
                    ? "bg-[var(--paper)] text-[var(--ink)] shadow-[0_0_0_1px_var(--line)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]",
                ].join(" ")}
              >
                {t(FILTER_LABEL[f])}
                {count > 0 && f !== "all" && (
                  <span
                    className={[
                      "ml-1 font-mono text-[9.5px] tabular-nums",
                      active ? "text-[var(--muted)]" : "text-[var(--muted-soft)]",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {displayRequests.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--paper-2)]/50">
                <Th>{t("status")}</Th>
                <Th>{t("reference")}</Th>
                <Th>{t("recipient")}</Th>
                <Th>{t("route")}</Th>
                <Th align="right">{t("amount")}</Th>
                <Th align="right">{t("issued")}</Th>
              </tr>
            </thead>
            <tbody>
              {displayRequests.map((r) => {
                const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.open;
                const receipt = receipts.find((rec) => rec.requestId === r.id);
                void receipt;
                return (
                  <tr
                    key={r.id}
                    className="group cursor-pointer border-b border-[var(--line-soft)] transition-colors last:border-b-0 hover:bg-[var(--line-soft)]/50"
                    onClick={() =>
                      onNavigate(`/pay?r=${encodeRequestPayload(r)}`)
                    }
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`}
                          aria-hidden="true"
                        />
                        <span className={`text-[11.5px] font-medium ${cfg.text}`}>
                          {t(cfg.labelKey)}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <span className="text-[12.5px] font-medium text-[var(--ink)]">
                        {r.label}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-mono text-[11px] text-[var(--muted)]">
                        {shortAddress(r.recipient)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[11.5px] text-[var(--muted)]">
                        {isCrossChainPaymentRequest(r) ? t("crossChain") : t("arcDirect")}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="text-[12.5px] font-medium text-[var(--ink)] tabular-nums">
                        {r.amount}
                      </span>
                      <span className="ml-1 font-mono text-[10px] text-[var(--muted)]">
                        {r.token}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="font-mono text-[11px] text-[var(--muted)]">
                        {formatInvoiceDate(r.invoiceDate)}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState filter={filter} onCreate={() => onNavigate("/qr-payments")} />
      )}
    </section>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={[
        "px-5 py-2.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={[
        "px-5 py-3",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

function EmptyState({
  filter,
  onCreate,
}: {
  filter: (typeof FILTERS)[number];
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const isFiltered = filter !== "all";
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[var(--btn-radius)] border border-[var(--line)] bg-[var(--input-bg)] text-[var(--muted)]">
        <QrCode size={18} strokeWidth={1.5} />
      </div>
      <p className="mb-1 text-[13px] font-medium text-[var(--ink)]">
        {isFiltered ? t("noFilteredRequests", { filter: t(FILTER_LABEL[filter]).toLowerCase() }) : t("noRequests")}
      </p>
      <p className="mb-4 max-w-[32ch] text-[11.5px] leading-relaxed text-[var(--muted)]">
        {isFiltered
          ? t("changeFilter")
          : t("createQrStartCollecting")}
      </p>
      {!isFiltered && (
        <button
          type="button"
          onClick={onCreate}
          className="rounded-[var(--btn-radius)] border border-[var(--line)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--line-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        >
          {t("createFirstRequest")}
        </button>
      )}
    </div>
  );
}
