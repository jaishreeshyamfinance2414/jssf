'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { inr } from '@/lib/utils';
import type { DashboardData } from './types';

const AVATAR_COLORS = [
  'bg-emerald-600',
  'bg-sky-600',
  'bg-amber-500',
  'bg-violet-600',
  'bg-rose-500',
  'bg-teal-600',
];

const BAR_COLORS = ['bg-emerald-600', 'bg-teal-500', 'bg-amber-500', 'bg-violet-500', 'bg-slate-400', 'bg-sky-500'];

const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function AgentCollection({ rows }: { rows: DashboardData['agentWiseCollection'] }) {
  const max = Math.max(...rows.map((r) => r.amount), 1);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="font-serif text-lg font-semibold text-foreground">Agent Collection</h3>
          <p className="text-xs text-muted-foreground">Today · cash reconciliation</p>
        </div>
        <Link href="/accounts" className="text-xs font-semibold text-primary hover:underline">
          Ledger
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-8 text-sm text-muted-foreground">
          No agent collections today
        </p>
      ) : (
        <div className="space-y-4">
          {rows.slice(0, 6).map((r, i) => {
            const short = r.shortAmount ?? 0;
            return (
              <div key={(r.agentId ?? r.agent) + i} className="flex items-center gap-3">
                <span className="w-3 text-xs font-semibold text-muted-foreground">{i + 1}</span>
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                >
                  {initials(r.agent)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-foreground">{r.agent}</p>
                  {r.area && <p className="truncate text-[11px] text-muted-foreground">{r.area}</p>}
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                      style={{ width: `${(r.amount / max) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[13px] font-semibold text-foreground">{inr(r.amount)}</p>
                  {short > 0 ? (
                    <p className="text-[11px] font-medium text-danger">{inr(short)} short</p>
                  ) : (
                    <p className="flex items-center justify-end gap-0.5 text-[11px] font-medium text-success">
                      <Check className="h-3 w-3" /> cleared
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
