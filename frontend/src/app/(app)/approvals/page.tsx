'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { CheckSquare, X, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { StatusPill } from '@/components/app/status-pill';
import { Button } from '@/components/ui/button';

interface Loan { id: string; loan_number: string; customer_name: string; principal: string; status: string; emi_frequency: string; tenure_count: number }
type ActionInput =
  | { id: string; action: 'approve' | 'reject' | 'unapprove' }
  | { id: string; action: 'disburse'; mode: 'cash' | 'bank_transfer' };

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { data: pending = [] } = useQuery({ queryKey: ['loans', 'pending'], queryFn: () => apiGet<Loan[]>('/loans?status=pending') });
  const { data: approved = [] } = useQuery({ queryKey: ['loans', 'approved'], queryFn: () => apiGet<Loan[]>('/loans?status=approved') });
  const act = useMutation({
    mutationFn: (input: ActionInput) => {
      const { id, action } = input;
      return (
      action === 'reject'
        ? apiPost<{ status: 'applied' | 'pending' }>(`/loans/${id}/reject`, { reason: 'Rejected by admin' })
        : apiPost<{ status: 'applied' | 'pending' }>(`/loans/${id}/${action}`, action === 'disburse' ? { mode: input.mode } : undefined)
      );
    },
    onSuccess: (res) => {
      setError(null);
      setInfo(res.status === 'pending' ? 'Submitted for admin approval — this will take effect once approved.' : null);
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Action failed.');
    },
  });
  return (
    <PageShell title="Loan Approval" description="Admin reviews applications, approves them, then disburses from available cash or bank.">
      {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {info && <div className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">{info}</div>}
      <DataTable
        columns={['Loan No', 'Customer', 'Principal', 'Frequency', 'Status', 'Decision']}
        rows={pending.map((l) => [
          l.loan_number,
          l.customer_name,
          money(l.principal),
          `${l.emi_frequency} x ${l.tenure_count}`,
          <StatusPill key={`${l.id}-s`} value={l.status} />,
          <div key={l.id} className="flex gap-2"><Button size="sm" onClick={() => act.mutate({ id: l.id, action: 'approve' })}><CheckSquare className="h-4 w-4" /> Approve</Button><Button size="sm" variant="danger" onClick={() => act.mutate({ id: l.id, action: 'reject' })}><X className="h-4 w-4" /> Reject</Button></div>,
        ])}
        empty="No pending applications"
      />
      <DataTable
        columns={['Approved Loan', 'Customer', 'Principal', 'Action']}
        rows={approved.map((l) => [
          l.loan_number,
          l.customer_name,
          money(l.principal),
          <div key={l.id} className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => act.mutate({ id: l.id, action: 'disburse', mode: 'cash' })}>Cash</Button>
            <Button size="sm" variant="outline" onClick={() => act.mutate({ id: l.id, action: 'disburse', mode: 'bank_transfer' })}>UPI/Bank</Button>
            <Button size="sm" variant="danger" onClick={() => act.mutate({ id: l.id, action: 'unapprove' })}><Undo2 className="h-4 w-4" /> Undo</Button>
          </div>,
        ])}
        empty="No approved loans waiting for disbursement"
      />
    </PageShell>
  );
}
