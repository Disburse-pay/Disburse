import {
  Bar,
  BarChart,
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
 * Network status and 6-month volume.
 *
 * The top block is a compact key-value table; the bottom block is a bar
 * chart of monthly volume. No decorative gradients.
 */
export default function SystemStatusCard({
  monthlyData,
  rpcStatusLabel,
  rpcBlockLabel,
  rpcHealthy,
}: Props) {
  const { t, formatCurrency } = useI18n();
  return (
    <section className="flex h-full flex-col rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-3.5">
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
            {t("network")}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {t("liveTelemetry")}
          </p>
        </div>
        <span
          className={[
            "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] font-medium",
            rpcHealthy
              ? "border-[var(--green-text)]/25 bg-[var(--green-bg)] text-[var(--green-text)]"
              : "border-[var(--yellow-text)]/30 bg-[var(--yellow-bg)] text-[var(--yellow-text)]",
          ].join(" ")}
        >
          <span
            className={[
              "h-1.5 w-1.5 rounded-full",
              rpcHealthy ? "bg-[var(--green-text)]" : "bg-[var(--yellow-text)]",
            ].join(" ")}
            aria-hidden="true"
          />
          {rpcHealthy ? t("operational") : t("degraded")}
        </span>
      </header>

      {/* Key-value rows */}
      <dl className="divide-y divide-[var(--line-soft)] border-b border-[var(--line)] px-5">
        <StatusRow label={t("chain")} value="Arc Testnet 5042002" />
        <StatusRow label={t("rpc")} value={rpcStatusLabel} mono />
        <StatusRow label={t("block")} value={rpcBlockLabel} mono />
      </dl>

      {/* Monthly volume */}
      <div className="flex min-h-[100px] flex-1 flex-col px-5 py-4">
        <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
          {t("sixMonthVolume")}
        </p>
        <div className="flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                dy={4}
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
                formatter={(value) => [formatCurrency(Number(value)), t("settledVolume")]}
                cursor={{ fill: "var(--line-soft)" }}
              />
              <Bar
                dataKey="volume"
                fill="var(--primary-bg)"
                fillOpacity={0.85}
                radius={[1, 1, 0, 0]}
                name={t("settledVolume")}
                maxBarSize={20}
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
    <div className="flex items-center justify-between py-2.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={[
          "max-w-[60%] truncate text-[11.5px] text-[var(--ink)]",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}
