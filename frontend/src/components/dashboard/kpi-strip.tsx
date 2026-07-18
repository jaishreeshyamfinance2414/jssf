'use client';

import { Users, Layers, CheckCircle2, AlertOctagon, ArrowUpRight, DollarSign } from 'lucide-react';
import { inr, compactInr } from '@/lib/utils';
import type { DashboardData } from './types';

const rupeeCompact = (n: number) => `₹${compactInr(n)}`;

interface Tile {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function KpiStrip({ kpis }: { kpis: DashboardData['kpis'] }) {
  const month = new Date().toLocaleDateString('en-IN', { month: 'short' });

  const tiles: Tile[] = [
    {
      label: 'Total Customers',
      value: kpis.totalCustomers.toLocaleString('en-IN'),
      hint: kpis.newCustomersThisMonth != null ? `+${kpis.newCustomersThisMonth} this month` : undefined,
      icon: Users,
    },
    {
      label: 'Active Loans',
      value: kpis.activeLoans.toLocaleString('en-IN'),
      hint: kpis.outstandingPrincipal != null ? `${rupeeCompact(kpis.outstandingPrincipal)} outstanding` : undefined,
      icon: Layers,
    },
    {
      label: 'Pending Approvals',
      value: String(kpis.pendingApprovals),
      hint: kpis.pendingApprovalsValue != null ? `${inr(kpis.pendingApprovalsValue)} requested` : undefined,
      icon: CheckCircle2,
    },
    {
      label: 'Overdue Loans',
      value: kpis.overdueLoansCount != null ? String(kpis.overdueLoansCount) : String(kpis.todaysMissed),
      hint: kpis.overduePenalty != null ? `${inr(kpis.overduePenalty)} penalty accrued` : undefined,
      icon: AlertOctagon,
    },
    {
      label: `Disbursed (${month})`,
      value: kpis.disbursedThisMonth != null ? rupeeCompact(kpis.disbursedThisMonth) : '—',
      hint: kpis.disbursedThisMonthCount != null ? `${kpis.disbursedThisMonthCount} new loans` : undefined,
      icon: ArrowUpRight,
    },
    {
      label: `Expenses (${month})`,
      value: inr(kpis.totalExpenses),
      hint: kpis.salaryExpense != null ? `incl. ${inr(kpis.salaryExpense)} salary` : undefined,
      icon: DollarSign,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border/60 shadow-sm sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border sm:bg-card xl:grid-cols-6">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div key={t.label} className="bg-card p-4 sm:p-5">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground sm:text-[13px]">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{t.label}</span>
            </div>
            <p className="font-serif text-xl font-semibold leading-none text-foreground sm:text-2xl">{t.value}</p>
            {t.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{t.hint}</p>}
          </div>
        );
      })}
    </div>
  );
}
