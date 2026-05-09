import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { ChevronDown } from "lucide-react";

interface MonthlyStatsProps {
  activityData: Array<{ name: string; volume: number; count: number }>;
}

export default function MonthlyStats({ activityData }: MonthlyStatsProps) {
  return (
    <div className="border border-brand-border bg-brand-dark p-6 h-[326px] flex flex-col hover:border-[#222] transition-all duration-300 hover:-translate-y-0.5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-xs font-mono uppercase tracking-widest text-muted">Network Activity</h4>
        <button className="flex items-center gap-1.5 px-2 py-1 border border-brand-border text-xs text-muted hover:text-white hover:bg-brand-surface transition-colors group">
          This week
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      <div className="flex-1 min-h-0 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={activityData}>
            <defs>
              <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#34d399" stopOpacity={0.15}/>
                <stop offset="95%" stopColor="#34d399" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="volume"
              stroke="#34d399"
              fillOpacity={1}
              fill="url(#colorVal)"
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] text-center text-muted font-mono mt-3">Based on Arc Testnet block confirmations</p>
    </div>
  );
}
