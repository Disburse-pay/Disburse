import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell 
} from "recharts";

interface AdjustmentsGraphProps {
  monthlyData: Array<{ month: string; volume: number; count: number }>;
  rpcStatusLabel: string;
  rpcBlockLabel: string;
  rpcHealthy?: boolean;
}

export default function AdjustmentsGraph({ monthlyData, rpcStatusLabel, rpcBlockLabel, rpcHealthy }: AdjustmentsGraphProps) {
  return (
    <div className="border border-brand-border bg-brand-dark p-6 h-[326px] flex flex-col justify-between">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h4 className="text-xs font-mono uppercase tracking-widest text-muted">Settled Volume</h4>
          <p className="text-xs text-muted mt-1">Arc Testnet Volume (USDC)</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthlyData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#888', fontSize: 10, fontWeight: 500 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#888', fontSize: 10, fontWeight: 500 }}
              tickFormatter={(value) => `$${value/1000}k`}
            />
            <Tooltip
              cursor={{ fill: 'rgba(52, 211, 153, 0.05)' }}
              contentStyle={{
                backgroundColor: '#050505',
                border: '1px solid #1a1a1a',
                fontSize: '12px',
                color: '#eaeaea'
              }}
              itemStyle={{ color: '#34d399' }}
            />
            <Bar dataKey="volume" barSize={24}>
              {monthlyData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill="#eaeaea"
                  fillOpacity={0.7}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="pt-4 border-t border-brand-border grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">RPC Status</div>
          <div className={`text-sm font-medium ${rpcHealthy ? 'text-brand-blue' : 'text-amber-400'}`}>{rpcStatusLabel}</div>
        </div>
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Block</div>
          <div className="text-sm font-medium text-white">{rpcBlockLabel}</div>
        </div>
      </div>
    </div>
  );
}
