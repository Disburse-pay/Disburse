import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "../lib/i18n";

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
 * Network status and 6-month volume. Plain-language labels, calm status pill.
 */
export default function SystemStatusCard({
  monthlyData,
  rpcStatusLabel,
  rpcBlockLabel,
  rpcHealthy,
}: Props) {
  const { t, formatCurrency } = useI18n();
  return (
    <section className="flex h-full flex-col rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--card-shadow)]">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
        <div>
          <p className="text-[13px] font-medium text-[var(--ink)]">{t("network")}</p>
          <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">{t("liveTelemetry")}</p>
        </div>
        {/* Status: monochrome. Only the degraded state shows any chrome. */}
        {rpcHealthy ? (
          <span className="text-[11.5px] text-[var(--muted)]">
            {t("operational")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium italic text-[var(--muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--ink-soft)]" aria-hidden="true" />
            {t("degraded")}
          </span>
        )}
      </header>

      {/* Key-value rows */}
      <dl className="divide-y divide-[var(--line-soft)] border-b border-[var(--line)] px-5">
        <StatusRow label={t("chain")} value="Arc Testnet 5042002" />
        <StatusRow label={t("rpc")} value={rpcStatusLabel} mono />
        <StatusRow label={t("block")} value={rpcBlockLabel} mono />
      </dl>

      {/* Monthly volume */}
      <div className="flex min-h-[104px] flex-1 flex-col px-5 py-4">
        <p className="mb-2 text-[12.5px] font-medium text-[var(--muted)]">
          {t("sixMonthVolume")}
        </p>
        <div className="flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <CartesianGrid
                strokeDasharray="2 4"
                vertical={false}
                stroke="var(--line-soft)"
              />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                dy={4}
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
                cursor={{ fill: "var(--line-soft)" }}
              />
              <Bar
                dataKey="volume"
                fill="var(--primary-bg)"
                fillOpacity={0.85}
                radius={[3, 3, 0, 0]}
                name={t("settledVolume")}
                maxBarSize={22}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function StatusRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <dt className="text-[12.5px] text-[var(--muted)]">{label}</dt>
      <dd
        className={[
          "max-w-[60%] truncate text-[12.5px] text-[var(--ink)]",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}
