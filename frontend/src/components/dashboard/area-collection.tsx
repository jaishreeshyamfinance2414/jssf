'use client';

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { inr, compactInr } from '@/lib/utils';
import type { DashboardData } from './types';

// Emerald → lime ramp, darkest for the top area.
const RAMP = ['#0F5132', '#157347', '#1E8A54', '#3FA96B', '#6FBF73', '#A3D977'];

export function AreaCollection({ rows }: { rows: DashboardData['areaWiseCollection'] }) {
  const data = [...rows].sort((a, b) => b.amount - a.amount).slice(0, 6);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="mb-4">
        <h3 className="font-serif text-lg font-semibold text-foreground">Area-wise Collection</h3>
        <p className="text-xs text-muted-foreground">Today</p>
      </div>

      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No collections today</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, data.length * 46)}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap={12}>
            <XAxis
              type="number"
              tickFormatter={(v: number) => `₹${compactInr(v)}`}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis
              type="category"
              dataKey="area"
              width={92}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              stroke="hsl(var(--foreground))"
            />
            <Tooltip
              formatter={(v: number) => [inr(v), 'Collected']}
              cursor={{ fill: 'hsl(var(--muted))' }}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid hsl(var(--border))',
                fontSize: 12,
                boxShadow: '0 8px 24px -12px rgba(0,0,0,0.25)',
              }}
            />
            <Bar dataKey="amount" radius={[0, 6, 6, 0]} barSize={20}>
              {data.map((_, i) => (
                <Cell key={i} fill={RAMP[i % RAMP.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
