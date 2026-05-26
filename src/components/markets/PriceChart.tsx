import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { Fill } from "../../lib/markets/types";

type Props = {
  fills: Fill[];
};

export default function PriceChart({ fills }: Props) {
  const data = useMemo(() => {
    return fills
      .slice()
      .sort((a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime())
      .map((f) => ({
        t: new Date(f.filledAt).getTime(),
        yes: f.outcome === "YES" ? f.priceMicros / 1_000_000 : 1 - f.priceMicros / 1_000_000,
        label: new Date(f.filledAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
      }));
  }, [fills]);

  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-[var(--line)] text-[12px] text-[var(--muted)]">
        No trades yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-4">
      <p className="mb-3 text-[11.5px] font-medium uppercase tracking-wider text-[var(--muted)]">
        YES price
      </p>
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="yesPriceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--ink)" stopOpacity={0.22} />
                <stop offset="95%" stopColor="var(--ink)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--line-soft)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              stroke="var(--muted)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              stroke="var(--muted)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: "var(--paper)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                fontSize: 11,
                color: "var(--ink)"
              }}
              formatter={(v) => [`$${Number(v).toFixed(3)}`, "YES"]}
              labelFormatter={(l) => String(l ?? "")}
            />
            <Area
              type="monotone"
              dataKey="yes"
              stroke="var(--ink)"
              strokeWidth={1.5}
              fill="url(#yesPriceFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
