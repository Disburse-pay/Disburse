import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { QrCode } from "lucide-react";
import type { PaymentRequest, Receipt, PaymentStatus } from "../lib/payments";
import { refreshDerivedStatus, shortAddress, encodeRequestPayload, isCrossChainPaymentRequest } from "../lib/payments";
import { formatInvoiceDate } from "../lib/invoice";

type Props = {
  requests: PaymentRequest[];
  receipts: Receipt[];
  now: Date;
  onNavigate: (target: string) => void;
};

const STATUS_CONFIG: Record<PaymentStatus, { label: string; dot: string; text: string }> = {
  open:           { label: "Open",    dot: "bg-[var(--blue-text)]",   text: "text-[var(--blue-text)]" },
  paid:           { label: "Paid",    dot: "bg-[var(--green-text)]",  text: "text-[var(--green-text)]" },
  expired:        { label: "Expired", dot: "bg-[var(--muted)]",       text: "text-[var(--muted)]" },
  failed:         { label: "Failed",  dot: "bg-[var(--red-text)]",    text: "text-[var(--red-text)]" },
  possible_match: { label: "Review",  dot: "bg-[var(--yellow-text)]", text: "text-[var(--yellow-text)]" },
};

const FILTERS = ["all", "open", "paid", "expired", "failed"] as const;
const FILTER_LABEL: Record<(typeof FILTERS)[number], string> = {
  all: "All",
  open: "Open",
  paid: "Paid",
  expired: "Expired",
  failed: "Failed",
};

export default function TransactionsTable({ requests, receipts, now, onNavigate }: Props) {
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
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[14px] font-semibold tracking-tight text-[var(--ink)]">
            Recent activity
          </h3>
          {requests.length > 0 && (
            <span className="rounded-full border border-[var(--line)] bg-[var(--input-bg)] px-2 py-0.5 text-[10px] font-mono text-[var(--muted)]">
              {requests.length} {requests.length === 1 ? "record" : "records"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
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
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
                  active
                    ? "bg-[var(--line-soft)] text-[var(--ink)]"
                    : "text-[var(--muted)] hover:bg-[var(--line-soft)] hover:text-[var(--ink)]",
                ].join(" ")}
              >
                {FILTER_LABEL[f]}
                {count > 0 && f !== "all" && (
                  <span className="ml-1 text-[var(--muted)]">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table / Empty state */}
      {displayRequests.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line-soft)]">
                <Th>Status</Th>
                <Th>Reference</Th>
                <Th>Recipient</Th>
                <Th>Route</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Date</Th>
              </tr>
            </thead>
            <tbody>
              {displayRequests.map((r, index) => {
                const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.open;
                const receipt = receipts.find((rec) => rec.requestId === r.id);
                void receipt; // (kept for future row-expanded receipt details)
                return (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.22,
                      delay: Math.min(index * 0.02, 0.18),
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="group cursor-pointer border-b border-[var(--line-soft)] transition-colors last:border-b-0 hover:bg-[var(--line-soft)]/60"
                    onClick={() => onNavigate(`/pay?r=${encodeRequestPayload(r)}`)}
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} aria-hidden="true" />
                        <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
                      </div>
                    </Td>
                    <Td>
                      <span className="text-[13px] font-medium text-[var(--ink)]">{r.label}</span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-[var(--muted)]">
                        {shortAddress(r.recipient)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs text-[var(--muted)]">
                        {isCrossChainPaymentRequest(r) ? "Cross-chain" : "Arc direct"}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="text-[13px] font-medium text-[var(--ink)] tabular-nums">
                        {r.amount}
                      </span>
                      <span className="ml-1 text-xs text-[var(--muted)]">{r.token}</span>
                    </Td>
                    <Td align="right">
                      <span className="text-xs text-[var(--muted)]">
                        {formatInvoiceDate(r.invoiceDate)}
                      </span>
                    </Td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState filter={filter} onCreate={() => onNavigate("/qr-payments")} />
      )}
    </div>
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
        "px-5 py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]",
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
    <td className={["px-5 py-3.5", align === "right" ? "text-right" : "text-left"].join(" ")}>
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
  const isFiltered = filter !== "all";
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--input-bg)] text-[var(--muted)]">
        <QrCode size={20} strokeWidth={1.5} />
      </div>
      <p className="mb-1 text-[13px] font-medium text-[var(--ink)]">
        {isFiltered ? `No ${filter} requests` : "No requests yet"}
      </p>
      <p className="mb-4 text-xs text-[var(--muted)]">
        {isFiltered
          ? "Change the filter to see all records."
          : "Create a QR request to start collecting payments."}
      </p>
      {!isFiltered && (
        <button
          type="button"
          onClick={onCreate}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--line-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        >
          Create your first request
        </button>
      )}
    </div>
  );
}
