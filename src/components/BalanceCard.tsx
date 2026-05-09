import type { Address } from "viem";

type Props = {
  totalVolume: string;
  verifiedVolume: string;
  pendingVolume: string;
  requestCount: number;
  receiptCount: number;
  account?: Address;
  onNavigate: (target: string) => void;
};

export default function BalanceCard({
  totalVolume,
  verifiedVolume,
  pendingVolume,
  requestCount,
  receiptCount,
  account,
  onNavigate,
}: Props) {
  const successRate =
    requestCount > 0 ? Math.round((receiptCount / requestCount) * 100) : 0;

  return (
    <div className="relative overflow-hidden border border-brand-border bg-brand-surface/30 backdrop-blur-sm">
      {/* Ambient glow */}
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-emerald-500/[0.04] blur-[100px] rounded-full pointer-events-none -translate-y-1/2 translate-x-1/3" />

      <div className="relative p-6">
        {/* Top row */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted mb-2">
              Total Requested Volume
            </p>
            <h2 className="text-4xl font-semibold tracking-tight text-white tabular-nums">
              {totalVolume}
              <span className="text-lg text-white/30 ml-2 font-normal">USDC</span>
            </h2>
          </div>

          {account && (
            <div className="text-right">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted mb-1">
                Connected
              </p>
              <p className="text-xs font-mono text-white/50">
                {account.slice(0, 6)}...{account.slice(-4)}
              </p>
            </div>
          )}
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricCell
            label="Verified"
            value={verifiedVolume}
            unit="USDC"
            accent="text-emerald-400"
          />
          <MetricCell
            label="Pending"
            value={pendingVolume}
            unit="USDC"
            accent="text-blue-400"
          />
          <MetricCell
            label="Requests"
            value={String(requestCount)}
            accent="text-white"
          />
          <MetricCell
            label="Success Rate"
            value={`${successRate}%`}
            accent={successRate >= 80 ? "text-emerald-400" : successRate >= 50 ? "text-amber-400" : "text-red-400"}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="px-4 py-2 bg-white text-black font-medium text-xs tracking-wide hover:bg-white/90 transition-colors"
            onClick={() => onNavigate("/qr-payments")}
          >
            Create Request
          </button>
          <button
            type="button"
            className="px-4 py-2 border border-white/15 text-white font-medium text-xs tracking-wide hover:bg-white/5 transition-colors"
            onClick={() => onNavigate("/payments")}
          >
            Direct Send
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCell({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent: string;
}) {
  return (
    <div className="p-3 border border-brand-border/50 bg-white/[0.01]">
      <p className="text-[9px] font-mono uppercase tracking-widest text-muted mb-1.5">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${accent}`}>
        {value}
        {unit && <span className="text-[10px] text-muted ml-1 font-normal">{unit}</span>}
      </p>
    </div>
  );
}
