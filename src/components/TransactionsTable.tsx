import { ExternalLink } from "lucide-react";
import { shortAddress, toExplorerTxUrl, refreshDerivedStatus, encodeRequestPayload, type PaymentRequest, type PaymentStatus, type Receipt } from "@/src/lib/payments";

interface TransactionsTableProps {
  requests: PaymentRequest[];
  receipts: Receipt[];
  now: Date;
  onNavigate: (target: string) => void;
}

export default function TransactionsTable({ requests, receipts, now, onNavigate }: TransactionsTableProps) {
  const recent = [...requests]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 7);

  return (
    <div className="border border-brand-border bg-brand-dark overflow-hidden hover:border-[#222] transition-all duration-300 hover:-translate-y-0.5">
      <div className="px-6 py-4 flex items-center justify-between border-b border-brand-border">
        <h4 className="text-xs font-mono uppercase tracking-widest text-muted">Recent Invoices</h4>
      </div>

      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-brand-border">
              <th className="px-6 py-3 text-[10px] font-medium text-muted uppercase tracking-widest font-mono">Invoice ID</th>
              <th className="px-6 py-3 text-[10px] font-medium text-muted uppercase tracking-widest font-mono">From/To</th>
              <th className="px-6 py-3 text-[10px] font-medium text-muted uppercase tracking-widest font-mono">Amount</th>
              <th className="px-6 py-3 text-[10px] font-medium text-muted uppercase tracking-widest font-mono">Network</th>
              <th className="px-6 py-3 text-[10px] font-medium text-muted uppercase tracking-widest font-mono">Status</th>
            </tr>
          </thead>
          <tbody>
            {recent.length > 0 ? recent.map((request, index) => {
              const displayRequest = refreshDerivedStatus(request, now);
              return (
                <tr
                  key={request.id}
                  className="border-b border-brand-border hover:bg-brand-surface cursor-pointer group transition-colors"
                  onClick={() => onNavigate(`/pay?r=${encodeRequestPayload(request)}`)}
                >
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-white">{request.label || `Request ${index + 1}`}</div>
                    <div className="text-[10px] text-muted font-mono flex items-center gap-1 mt-0.5">
                      {request.id.slice(0, 12)} <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-xs text-muted">{shortAddress(request.recipient)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-white tabular-nums">{request.amount} {request.token}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-muted">Arc Testnet</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs font-mono uppercase tracking-wider ${
                      displayRequest.status === "paid" ? "text-brand-blue" :
                      displayRequest.status === "open" ? "text-muted" :
                      displayRequest.status === "expired" ? "text-amber-400" :
                      "text-red-400"
                    }`}>
                      {displayRequest.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-muted">
                  <div className="text-sm">No requests yet</div>
                  <div className="text-xs mt-1 font-mono">Create a QR request to start tracking invoices.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
