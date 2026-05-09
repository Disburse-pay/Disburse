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

/**
 * 7-day request activity card.
 *
 * Structure: an eyebrow label and a large figure, a matched sub-label,
 * and a hairline chart below. No decorative gradients larger than the
 * series itself.
 */
export default function MonthlyStats({ activityData }: Props) {
  const totalCount = activityData.reduce((s, d) => s + d.count, 0);
  const totalVolume = activityData.reduce((s, d) => s + d.volume, 0);

  return (
    <section className="flex h-full flex-col rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]">
      {/* Heading */}
      <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-3.5">
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
            Activity
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Last 7 days, by request date
          </p>
        </div>
        <div className="text-right">
          <p className="text-[15px] font-semibold leading-none text-[var(--ink)] tabular-nums">
            {totalCount}
            <span className="ml-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] font-normal text-[var(--muted)]">
              {totalCount === 1 ? "req" : "reqs"}
            </span>
          </p>
          <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[var(--green-text)]">
            {totalVolume.toFixed(2)}
            <span className="ml-1 text-[var(--muted)]">USDC</span>
          </p>
        </div>
      </header>

      {/* Chart */}
      <div className="min-h-[128px] flex-1 px-2 pb-2 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={activityData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary-bg)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--primary-bg)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              dy={8}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "var(--paper)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                fontSize: 11,
                padding: "6px 9px",
                color: "var(--ink)",
                boxShadow: "none",
              }}
              labelStyle={{ color: "var(--muted)", fontSize: 10, fontFamily: "var(--font-mono)", marginBottom: 2 }}
              itemStyle={{ color: "var(--ink)", padding: 0 }}
              cursor={{ stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "2 3" }}
            />
            <Area
              type="monotone"
              dataKey="volume"
              stroke="var(--primary-bg)"
              strokeWidth={1.5}
              fill="url(#activityGradient)"
              name="Volume (USDC)"
              dot={false}
              activeDot={{
                r: 3,
                fill: "var(--primary-bg)",
                stroke: "var(--paper)",
                strokeWidth: 1.5,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
