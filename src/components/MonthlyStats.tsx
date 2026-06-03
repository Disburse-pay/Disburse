import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useI18n } from "../lib/i18n";

type ActivityDatum = {
  name: string;
  volume: number;
  count: number;
};

type Props = {
  activityData: ActivityDatum[];
};

/**
 * 7-day request activity card. Plain-language labels, large headline number.
 */
export default function MonthlyStats({ activityData }: Props) {
  const { t, formatCurrency } = useI18n();
  const totalCount = activityData.reduce((s, d) => s + d.count, 0);
  const totalVolume = activityData.reduce((s, d) => s + d.volume, 0);

  const delta = computeWindowDelta(activityData.map((d) => d.volume));
  const showDelta = delta !== null && totalVolume > 0;
  const deltaPositive = (delta ?? 0) >= 0;

  return (
    <section className="flex h-full flex-col rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--card-shadow)]">
      {/* Heading */}
      <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
        <div>
          <p className="text-[13px] font-medium text-[var(--ink)]">{t("activity")}</p>
          <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">{t("last7Days")}</p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <p className="text-[18px] font-semibold leading-none text-[var(--ink)] tabular-nums">
              {totalCount}
              <span className="ml-1.5 text-[12px] font-normal text-[var(--muted)]">
                {totalCount === 1 ? t("req") : t("reqs")}
              </span>
            </p>
            {showDelta && (
              <span
                className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-[var(--muted)]"
                title="vs previous 3 days"
              >
                {deltaPositive ? (
                  <ArrowUpRight size={10} strokeWidth={2} />
                ) : (
                  <ArrowDownRight size={10} strokeWidth={2} />
                )}
                {deltaPositive ? "+" : ""}
                {(delta as number).toFixed(0)}%
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-[var(--muted)]">
            {formatCurrency(totalVolume)}
          </p>
        </div>
      </header>

      {/* Chart */}
      <div className="min-h-[132px] flex-1 px-2 pb-2 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={activityData} margin={{ top: 4, right: 10, bottom: 0, left: 10 }}>
            <defs>
              <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary-bg)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--primary-bg)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="2 4"
              vertical={false}
              stroke="var(--line-soft)"
            />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              dy={8}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "var(--paper)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                fontSize: 12,
                padding: "8px 10px",
                color: "var(--ink)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
              }}
              labelStyle={{ color: "var(--muted)", fontSize: 11, marginBottom: 2 }}
              itemStyle={{ color: "var(--ink)", padding: 0 }}
              formatter={(value) => [formatCurrency(Number(value)), t("settledVolume")]}
              cursor={{ stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "2 3" }}
            />
            <Area
              type="monotone"
              dataKey="volume"
              stroke="var(--primary-bg)"
              strokeWidth={1.75}
              fill="url(#activityGradient)"
              name={t("settledVolume")}
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

function computeWindowDelta(series: number[]): number | null {
  if (series.length < 4) return null;
  const mid = Math.floor(series.length / 2);
  const prev = series.slice(0, mid).reduce((a, b) => a + b, 0);
  const curr = series.slice(mid).reduce((a, b) => a + b, 0);
  if (prev === 0 && curr === 0) return null;
  if (prev === 0) return 100;
  return ((curr - prev) / prev) * 100;
}
