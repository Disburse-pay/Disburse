import { useMemo, useState } from "react";
import { ChevronRight, QrCode, ShieldCheck } from "lucide-react";
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

/* Monochrome status: state is read from the label text, not the color.
 *   paid    → filled ink dot
 *   open    → ring-only (hollow) dot
 *   expired → muted-soft hollow dot
 *   failed  → filled ink dot, italic label
 *   review  → ring-only dot, italic label
 */
const STATUS_CONFIG: Record<
  PaymentStatus,
  { labelKey: string; dot: string; text: string }
> = {
  open:           { labelKey: "open",    dot: "bg-transparent ring-1 ring-inset ring-[var(--ink-soft)]",  text: "text-[var(--muted)]" },
  paid:           { labelKey: "paid",    dot: "bg-[var(--ink)]",                                           text: "text-[var(--ink)]" },
  expired:        { labelKey: "expired", dot: "bg-transparent ring-1 ring-inset ring-[var(--muted-soft)]", text: "text-[var(--muted)]" },
  failed:         { labelKey: "failed",  dot: "bg-[var(--ink)]",                                           text: "text-[var(--ink)] italic" },
  possible_match: { labelKey: "review",  dot: "bg-transparent ring-1 ring-inset ring-[var(--ink-soft)]",  text: "text-[var(--muted)] italic" },
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
 * Ledger of recent payment requests. Plain-language column headers, calm
 * status pills, navigable rows.
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
    <section className="overflow-hidden rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--card-shadow)]">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
        <div className="flex items-baseline gap-3">
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.012em] text-[var(--ink)]">
              {t("recentRequestsLower")}
            </p>
            <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">
              {t("ledger")}
            </p>
          </div>
          {requests.length > 0 && (
            <span className="text-[12px] text-[var(--muted)]">
              {requests.length} {requests.length === 1 ? t("record") : t("records")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 rounded-md border border-[var(--line)] bg-[var(--paper-2)] p-0.5">
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
                  "rounded px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
                  active
                    ? "bg-[var(--paper)] text-[var(--ink)] shadow-[0_0_0_1px_var(--line)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]",
                ].join(" ")}
              >
                {t(FILTER_LABEL[f])}
                {count > 0 && f !== "all" && (
                  <span
                    className={[
                      "ml-1 text-[11px] tabular-nums",
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
              <tr className="border-b border-[var(--line)] bg-[var(--paper-2)]">
                <Th>{t("status")}</Th>
                <Th>{t("reference")}</Th>
                <Th>{t("recipient")}</Th>
                <Th>{t("route")}</Th>
                <Th align="right">{t("amount")}</Th>
                <Th align="right">{t("issued")}</Th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {displayRequests.map((r) => {
                const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.open;
                const receipt = receipts.find((rec) => rec.requestId === r.id);
                return (
                  <tr
                    key={r.id}
                    className="group cursor-pointer border-b border-[var(--line-soft)] transition-colors last:border-b-0 hover:bg-[var(--paper-2)]"
                    onClick={() =>
                      onNavigate(`/pay?r=${encodeRequestPayload(r)}`)
                    }
                  >
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`}
                          aria-hidden="true"
                        />
                        <span className={`text-[12px] font-medium ${cfg.text}`}>
                          {t(cfg.labelKey)}
                        </span>
                        {receipt && (
                          <span
                            className="inline-flex text-[var(--muted)]"
                            title={t("verified")}
                            aria-label={t("verified")}
                          >
                            <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" />
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[13.5px] font-medium text-[var(--ink)]">
                        {r.label}
                      </span>
                      {r.note && (
                        <span className="ml-2 hidden max-w-[24ch] truncate align-middle text-[12px] text-[var(--muted)] md:inline-block">
                          {r.note}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="font-mono text-[12px] text-[var(--muted)]">
                        {shortAddress(r.recipient)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[12.5px] text-[var(--muted)]">
                        {isCrossChainPaymentRequest(r) ? t("crossChain") : t("arcDirect")}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="text-[13.5px] font-medium text-[var(--ink)] tabular-nums">
                        {r.amount}
                      </span>
                      <span className="ml-1 text-[11.5px] text-[var(--muted)]">
                        {r.token}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="text-[12.5px] text-[var(--muted)]">
                        {formatRelative(r.createdAt, now)}
                      </span>
                      <span className="block text-[11px] text-[var(--muted-soft)]">
                        {formatInvoiceDate(r.invoiceDate)}
                      </span>
                    </Td>
                    <td className="pr-4 text-right">
                      <ChevronRight
                        size={15}
                        strokeWidth={1.75}
                        className="text-[var(--muted-soft)] opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </td>
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
        "px-5 py-3 text-[12px] font-medium text-[var(--muted)]",
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
        "px-5 py-3.5",
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
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--paper-2)] text-[var(--muted)]">
        <QrCode size={20} strokeWidth={1.5} />
      </div>
      <p className="mb-1 text-[14px] font-medium text-[var(--ink)]">
        {isFiltered ? t("noFilteredRequests", { filter: t(FILTER_LABEL[filter]).toLowerCase() }) : t("noRequests")}
      </p>
      <p className="mb-4 max-w-[32ch] text-[12.5px] leading-relaxed text-[var(--muted)]">
        {isFiltered
          ? t("changeFilter")
          : t("createQrStartCollecting")}
      </p>
      {!isFiltered && (
        <button
          type="button"
          onClick={onCreate}
          className="rounded-md bg-[var(--primary-bg)] px-3.5 py-1.5 text-[13px] font-medium text-[color:var(--primary-text)] shadow-sm transition-colors hover:bg-[var(--primary-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        >
          {t("createFirstRequest")}
        </button>
      )}
    </div>
  );
}

/** Lightweight, locale-agnostic "N d ago" formatter. */
function formatRelative(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffMs = now.getTime() - t;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}
