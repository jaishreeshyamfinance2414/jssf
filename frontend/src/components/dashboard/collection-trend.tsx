'use client';

import { useState } from 'react';
import {
  Area,
  ComposedChart,
  Line,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { inr, compactInr } from '@/lib/utils';
import type { DashboardData } from './types';

const RANGES = [
  { key: '7D', days: 7 },
  { key: '14D', days: 14 },
  { key: '30D', days: 30 },
] as const;

export function CollectionTrend({ data }: { data: DashboardData['collectionTrend'] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('14D');
  const days = RANGES.find((r) => r.key === range)!.days;
  const rows = data.slice(-days);
  const hasDue = rows.some((r) => r.due != null);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="font-serif text-lg font-semibold text-foreground">Collection Trend</h3>
          <p className="text-xs text-muted-foreground">Collected vs due, last {days} days</p>
        </div>
        <div className="flex rounded-lg border border-border bg-muted/50 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                range === r.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2 flex items-center justify-end gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-primary" /> Collected
        </span>
        {hasDue && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-0 w-3 border-t-2 border-dashed border-muted-foreground/50" /> Due
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="collectedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            stroke="hsl(var(--muted-foreground))"
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v: number) => `₹${compactInr(v)}`}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            stroke="hsl(var(--muted-foreground))"
            width={56}
          />
          <Tooltip
            formatter={(v: number, name: string) => [inr(v), name === 'amount' ? 'Collected' : 'Due']}
            labelFormatter={(d: string) => new Date(d).toLocaleDateString('en-IN')}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid hsl(var(--border))',
              fontSize: 12,
              boxShadow: '0 8px 24px -12px rgba(0,0,0,0.25)',
            }}
          />
          <Area
            type="monotone"
            dataKey="amount"
            stroke="hsl(var(--primary))"
            strokeWidth={2.5}
            fill="url(#collectedFill)"
          />
          {hasDue && (
            <Line
              type="monotone"
              dataKey="due"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
