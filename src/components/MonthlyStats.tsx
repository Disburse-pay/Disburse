import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ActivityDatum = {
  name: string;
  volume: number;
  count: number;
};

type Props = {
  activityData: ActivityDatum[];
};

export default function MonthlyStats({ activityData }: Props) {
  const totalCount = activityData.reduce((s, d) => s + d.count, 0);
  const totalVolume = activityData.reduce((s, d) => s + d.volume, 0);

  return (
    <div className="border border-brand-border bg-brand-surface/30 backdrop-blur-sm p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted mb-1">
            7-Day Activity
          </h4>
          <p className="text-lg font-semibold text-white tabular-nums">
            {totalCount} <span className="text-xs text-muted font-normal">requests</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted mb-1">Volume</p>
          <p className="text-sm font-medium text-emerald-400 tabular-nums">{totalVolume.toFixed(2)}</p>
        </div>
      </div>

      <div className="flex-1 min-h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={activityData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#555", fontSize: 10, fontFamily: "monospace" }}
              dy={8}
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
              cursor={{ stroke: "#333", strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="volume"
              stroke="#10b981"
              strokeWidth={1.5}
              fill="url(#activityGradient)"
              name="Volume (USDC)"
              dot={false}
              activeDot={{ r: 3, fill: "#10b981", stroke: "#050505", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
