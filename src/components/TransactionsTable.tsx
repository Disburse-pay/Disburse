import { useState, useMemo } from "react";
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
  open: { label: "Open", dot: "bg-blue-400", text: "text-blue-400" },
  paid: { label: "Paid", dot: "bg-emerald-400", text: "text-emerald-400" },
  expired: { label: "Expired", dot: "bg-neutral-500", text: "text-neutral-500" },
  failed: { label: "Failed", dot: "bg-red-400", text: "text-red-400" },
  possible_match: { label: "Review", dot: "bg-amber-400", text: "text-amber-400" },
};

export default function TransactionsTable({ requests, receipts, now, onNavigate }: Props) {
  const [filter, setFilter] = useState<"all" | PaymentStatus>("all");

  const displayRequests = useMemo(() => {
    const derived = requests.map((r) => refreshDerivedStatus(r, now));
    const sorted = [...derived].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
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
    <div className="border border-brand-border bg-brand-surface/30 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white tracking-wide">Settlement Ledger</h3>
          <span className="text-[10px] font-mono text-muted px-2 py-0.5 bg-white/5 border border-brand-border">
            {requests.length} records
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(["all", "open", "paid", "expired", "failed"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-all duration-200 border ${
                filter === f
                  ? "bg-white/10 border-white/20 text-white"
                  : "border-transparent text-muted hover:text-white/70 hover:bg-white/5"
              }`}
            >
              {f}{statusCounts[f] ? ` (${statusCounts[f]})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {displayRequests.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-border">
                <th className="text-left py-3 px-5 text-[10px] font-mono uppercase tracking-widest text-muted font-medium">Status</th>
                <th className="text-left py-3 px-5 text-[10px] font-mono uppercase tracking-widest text-muted font-medium">Reference</th>
                <th className="text-left py-3 px-5 text-[10px] font-mono uppercase tracking-widest text-muted font-medium">Recipient</th>
                <th className="text-left py-3 px-5 text-[10px] font-mono uppercase tracking-widest text-muted font-medium">Route</th>
                <th className="text-right py-3 px-5 text-[10px] font-mono uppercase tracking-widest text-muted font-medium">Amount</th>
                <th className="text-right py-3 px-5 text-[10px] font-mono uppercase tracking-widest text-muted font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border/50">
              {displayRequests.map((r) => {
                const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.open;
                const receipt = receipts.find((rec) => rec.requestId === r.id);
                return (
                  <tr
                    key={r.id}
                    className="group cursor-pointer hover:bg-white/[0.02] transition-colors duration-150"
                    onClick={() =>
                      onNavigate(`/pay?r=${encodeRequestPayload(r)}`)
                    }
                  >
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="text-white font-medium text-sm">{r.label}</span>
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="text-muted font-mono text-xs">{shortAddress(r.recipient)}</span>
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="text-xs text-muted">
                        {isCrossChainPaymentRequest(r) ? "Cross-chain" : "Arc Direct"}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <span className="text-white font-medium tabular-nums">{r.amount}</span>
                      <span className="text-muted ml-1 text-xs">{r.token}</span>
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <span className="text-muted text-xs">{formatInvoiceDate(r.invoiceDate)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-muted">
          <svg className="w-8 h-8 mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="m21 8-4-4-4 4" /><path d="M17 4v16" />
          </svg>
          <p className="text-sm font-medium text-white/50 mb-1">No settlement records</p>
          <p className="text-xs">Create your first payment request to get started.</p>
        </div>
      )}
    </div>
  );
}
