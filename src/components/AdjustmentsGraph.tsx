import {
  BarChart,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type MonthlyDatum = {
  month: string;
  volume: number;
  count: number;
};

type Props = {
  monthlyData: MonthlyDatum[];
  rpcStatusLabel: string;
  rpcBlockLabel: string;
  rpcHealthy?: boolean;
};

export default function AdjustmentsGraph({
  monthlyData,
  rpcStatusLabel,
  rpcBlockLabel,
  rpcHealthy,
}: Props) {
  return (
    <div className="border border-brand-border bg-brand-surface/30 backdrop-blur-sm p-5 h-full flex flex-col">
      {/* System Status */}
      <div className="mb-4">
        <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted mb-3">
          System Status
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <StatusRow label="Network" value="Arc Testnet" />
          <StatusRow
            label="RPC"
            value={rpcStatusLabel}
            healthy={rpcHealthy}
          />
          <StatusRow label="Block" value={rpcBlockLabel} />
          <StatusRow
            label="Status"
            value={rpcHealthy ? "Operational" : "Degraded"}
            healthy={rpcHealthy}
          />
        </div>
      </div>

      {/* Monthly chart */}
      <div className="flex-1 min-h-[100px] mt-2">
        <p className="text-[9px] font-mono uppercase tracking-widest text-muted mb-2">
          6-Month Volume
        </p>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthlyData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#555", fontSize: 10, fontFamily: "monospace" }}
              dy={4}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "#111",
                border: "1px solid #222",
                borderRadius: "0",
                fontSize: "11px",
                fontFamily: "monospace",
                padding: "8px 12px",
              }}
              labelStyle={{ color: "#888", fontSize: "10px", marginBottom: "4px" }}
              itemStyle={{ color: "#eaeaea", padding: 0 }}
              cursor={{ fill: "rgba(255,255,255,0.02)" }}
            />
            <Bar
              dataKey="volume"
              fill="#10b981"
              radius={[1, 1, 0, 0]}
              name="Volume (USDC)"
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  healthy,
}: {
  label: string;
  value: string;
  healthy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-muted font-mono">{label}</span>
      <span className="flex items-center gap-1.5 text-[10px] font-mono text-white/70">
        {healthy !== undefined && (
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              healthy ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
        )}
        {value}
      </span>
    </div>
  );
}
