'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { apiPost } from '@/lib/api';
import { inr } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import type { DashboardData } from './types';

const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function PendingApprovals({
  rows,
  totalPending,
}: {
  rows: NonNullable<DashboardData['pendingLoanApprovals']>;
  totalPending: number;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const approve = useMutation({
    mutationFn: (id: string) => apiPost(`/loans/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      alert(ax.response?.data?.error?.message ?? 'Approval failed.');
    },
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="font-serif text-lg font-semibold text-foreground">Pending Loan Approvals</h3>
          <p className="text-xs text-muted-foreground">{totalPending} awaiting your decision</p>
        </div>
        <Link href="/approvals" className="text-xs font-semibold text-primary hover:underline">
          View all
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No pending applications</p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 sm:hidden">
            {rows.map((r) => {
              const reloan = r.sequenceNo > 1;
              return (
                <div key={r.id} className="rounded-xl border border-border bg-background/40 p-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                      {initials(r.customerName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{r.customerName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {r.area} · <span className="font-mono">{r.loanNumber}</span>
                      </p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        reloan ? 'bg-info/10 text-info' : 'bg-warning/10 text-warning'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${reloan ? 'bg-info' : 'bg-warning'}`} />
                      {reloan ? 'Re-loan' : 'Pending'}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{inr(r.amount)}</span>
                    <div className="flex items-center gap-2">
                      <Link
                        href="/approvals"
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                      >
                        View
                      </Link>
                      {can('loan.approve') && (
                        <button
                          onClick={() => approve.mutate(r.id)}
                          disabled={approve.isPending}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                        >
                          Approve
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 font-semibold">Customer</th>
                <th className="pb-2 font-semibold">Loan No.</th>
                <th className="pb-2 text-right font-semibold">Amount</th>
                <th className="pb-2 font-semibold">Status</th>
                <th className="pb-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const reloan = r.sequenceNo > 1;
                return (
                  <tr key={r.id}>
                    <td className="py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                          {initials(r.customerName)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{r.customerName}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{r.area}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 font-mono text-xs text-muted-foreground">{r.loanNumber}</td>
                    <td className="py-3 text-right font-semibold text-foreground">{inr(r.amount)}</td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          reloan ? 'bg-info/10 text-info' : 'bg-warning/10 text-warning'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${reloan ? 'bg-info' : 'bg-warning'}`} />
                        {reloan ? 'Re-loan' : 'Pending'}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href="/approvals"
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                        >
                          View
                        </Link>
                        {can('loan.approve') && (
                          <button
                            onClick={() => approve.mutate(r.id)}
                            disabled={approve.isPending}
                            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
