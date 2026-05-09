import {
  Area,
  AreaChart,
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
    <div className="flex h-full flex-col rounded-xl border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            Last 7 days
          </h4>
          <p className="text-[17px] font-semibold text-[var(--ink)] tabular-nums">
            {totalCount}
            <span className="ml-1.5 text-[11px] font-normal text-[var(--muted)]">
              {totalCount === 1 ? "request" : "requests"}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="mb-1 text-[9.5px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            Volume
          </p>
          <p className="text-[12.5px] font-medium tabular-nums text-[var(--green-text)]">
            {totalVolume.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="min-h-[120px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={activityData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary-bg)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--primary-bg)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted)", fontSize: 10 }}
              dy={8}
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
              cursor={{ stroke: "var(--line)", strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="volume"
              stroke="var(--primary-bg)"
              strokeWidth={1.75}
              fill="url(#activityGradient)"
              name="Volume (USDC)"
              dot={false}
              activeDot={{
                r: 3,
                fill: "var(--primary-bg)",
                stroke: "var(--paper)",
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
