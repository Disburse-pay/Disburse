import {
  Bar,
  BarChart,
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

/**
 * System status + 6-month volume. Previously misnamed "AdjustmentsGraph".
 */
export default function SystemStatusCard({
  monthlyData,
  rpcStatusLabel,
  rpcBlockLabel,
  rpcHealthy,
}: Props) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-[var(--line)] bg-[var(--paper)] p-5">
      {/* System Status */}
      <div className="mb-4">
        <h4 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
          System status
        </h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <StatusRow label="Network" value="Arc Testnet" />
          <StatusRow label="RPC" value={rpcStatusLabel} healthy={rpcHealthy} />
          <StatusRow label="Block" value={rpcBlockLabel} />
          <StatusRow
            label="Status"
            value={rpcHealthy ? "Operational" : "Degraded"}
            healthy={rpcHealthy}
          />
        </div>
      </div>

      {/* Monthly chart */}
      <div className="mt-2 min-h-[96px] flex-1">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
          6-month volume
        </p>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthlyData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted)", fontSize: 10 }}
              dy={4}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "var(--paper)",
                border: "1px solid var(--line)",
                borderRadius: "6px",
                fontSize: "11px",
                padding: "8px 10px",
                color: "var(--ink)",
                boxShadow: "0 8px 24px -12px rgba(0,0,0,0.4)",
              }}
              labelStyle={{ color: "var(--muted)", fontSize: "10px", marginBottom: "4px" }}
              itemStyle={{ color: "var(--ink)", padding: 0 }}
              cursor={{ fill: "var(--line-soft)" }}
            />
            <Bar
              dataKey="volume"
              fill="var(--primary-bg)"
              radius={[2, 2, 0, 0]}
              name="Volume (USDC)"
              maxBarSize={24}
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
      <span className="text-[11px] text-[var(--muted)]">{label}</span>
      <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink)]">
        {healthy !== undefined && (
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              healthy ? "bg-[var(--green-text)]" : "bg-[var(--red-text)]"
            }`}
            aria-hidden="true"
          />
        )}
        <span className={value.length > 16 ? "truncate font-mono" : "font-mono"}>
          {value}
        </span>
      </span>
    </div>
  );
}
