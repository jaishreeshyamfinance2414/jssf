'use client';

import Link from 'next/link';
import { Wallet, CheckCircle2, AlertTriangle, HandCoins, Smartphone, FileText, XCircle, Trash2 } from 'lucide-react';
import { inr } from '@/lib/utils';
import type { DashboardData } from './types';

type Activity = NonNullable<DashboardData['recentActivity']>[number];

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function describe(a: Activity): { icon: React.ComponentType<{ className?: string }>; tone: string; text: string; amount: number | null } {
  const m = a.meta ?? {};
  const amount = num(m.amount) ?? num(m.submitted) ?? num(m.principal) ?? null;
  const who = a.actorName;
  const ref = str(m.loanNumber) ?? str(m.reference) ?? str(m.customerName);

  const base = { icon: FileText, tone: 'text-muted-foreground', amount, text: '' };

  switch (a.entity) {
    case 'collection': {
      const mode = str(m.mode);
      const modeLabel = mode === 'upi' ? 'UPI' : mode === 'bank' ? 'Bank' : mode ?? '';
      const icon = mode === 'cash' ? Wallet : Smartphone;
      if (a.action === 'DELETE')
        return { ...base, icon, tone: 'text-danger', text: `${who} deleted a ${modeLabel} entry${ref ? ` · ${ref}` : ''}` };
      if (a.action === 'UPDATE')
        return { ...base, icon, tone: 'text-primary', text: `${who} edited a ${modeLabel} entry${ref ? ` · ${ref}` : ''}` };
      return { ...base, icon, tone: 'text-primary', text: `${who} recorded a ${modeLabel} payment${ref ? ` · ${ref}` : ''}` };
    }
    case 'loan': {
      switch (a.action) {
        case 'APPROVE':
        case 'APPROVAL':
          return { ...base, icon: CheckCircle2, tone: 'text-primary', text: `${who} approved a loan${ref ? ` · ${ref}` : ''}` };
        case 'UNAPPROVE':
          return { ...base, icon: AlertTriangle, tone: 'text-warning', text: `${who} unapproved a loan${ref ? ` · ${ref}` : ''}` };
        case 'REJECT':
          return { ...base, icon: XCircle, tone: 'text-danger', text: `${who} rejected a loan application${ref ? ` · ${ref}` : ''}` };
        case 'DELETE':
          return { ...base, icon: Trash2, tone: 'text-danger', text: `${who} deleted a loan application${ref ? ` · ${ref}` : ''}` };
        case 'CLOSE':
          return { ...base, icon: CheckCircle2, tone: 'text-primary', text: `${who} closed a loan${ref ? ` · ${ref}` : ''}` };
        case 'DISBURSE':
          return { ...base, icon: HandCoins, tone: 'text-primary', text: `${who} disbursed a loan${ref ? ` · ${ref}` : ''}` };
        case 'UPDATE':
        case 'STATUS_CHANGE':
          return { ...base, icon: CheckCircle2, tone: 'text-primary', text: `${who} updated a loan${ref ? ` · ${ref}` : ''}` };
        default:
          return { ...base, icon: HandCoins, tone: 'text-primary', text: `${who} created a new loan${ref ? ` · ${ref}` : ''}` };
      }
    }
    case 'emi_schedule':
      return { ...base, icon: AlertTriangle, tone: 'text-danger', text: `Missed EMI flagged${ref ? ` for ${ref}` : ''}` };
    case 'agent_ledger':
      return { ...base, icon: Wallet, tone: 'text-primary', text: `${who} submitted a cash handover` };
    default:
      return { ...base, text: `${who} · ${a.action.toLowerCase()} ${a.entity}` };
  }
}

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function RecentActivity({ rows }: { rows: Activity[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="font-serif text-lg font-semibold text-foreground">Recent Activity</h3>
          <p className="text-xs text-muted-foreground">Live collection &amp; approval feed</p>
        </div>
        <Link href="/audit" className="text-xs font-semibold text-primary hover:underline">
          Audit log
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No recent activity</p>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((a) => {
            const d = describe(a);
            const Icon = d.icon;
            const positive = a.entity === 'collection' && a.action !== 'DELETE';
            return (
              <div key={a.id} className="flex items-center gap-3 py-3.5">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted ${d.tone}`}>
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-foreground">{d.text}</p>
                  <p className="text-[11px] text-muted-foreground">{ago(a.createdAt)}</p>
                </div>
                {d.amount != null && (
                  <span className={`text-[13px] font-semibold ${positive ? 'text-success' : 'text-foreground'}`}>
                    {positive ? '+' : ''}
                    {inr(d.amount)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
