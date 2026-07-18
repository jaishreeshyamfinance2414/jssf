'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Check, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { dateTime } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { StatusPill } from '@/components/app/status-pill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface ApprovalRequest {
  id: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  requested_by_name?: string;
  reviewed_by_name?: string | null;
  review_note: string | null;
  created_at: string;
}

const ACTION_LABEL: Record<string, string> = {
  'loan.approve': 'Approve Loan',
  'loan.reject': 'Reject Loan',
  'loan.disburse': 'Disburse Loan',
  'loan.close': 'Close Loan',
  'customer.delete': 'Delete Customer',
  'collection.handover': 'Cash Handover',
};

function summarize(r: ApprovalRequest) {
  switch (r.action_type) {
    case 'loan.reject':
      return `Reason: ${r.payload.reason ?? '-'}`;
    case 'loan.disburse':
      return `Mode: ${r.payload.mode ?? '-'}`;
    case 'loan.close':
      return r.payload.waiver ? `Waiver requested${r.payload.reason ? ` — ${r.payload.reason}` : ''}` : 'Fully paid';
    case 'collection.handover':
      return `Submitted amount: ${r.payload.submittedAmount ?? '-'}`;
    default:
      return '-';
  }
}

export default function ApprovalRequestsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canReview = can('approval.review');
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data: queue = [] } = useQuery({
    queryKey: ['approval-requests'],
    queryFn: () => apiGet<ApprovalRequest[]>('/approval-requests?status=pending'),
    enabled: canReview,
  });
  const { data: mine = [] } = useQuery({
    queryKey: ['approval-requests-mine'],
    queryFn: () => apiGet<ApprovalRequest[]>('/approval-requests/mine'),
    enabled: !canReview,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['approval-requests'] });
    qc.invalidateQueries({ queryKey: ['approval-requests-mine'] });
    qc.invalidateQueries({ queryKey: ['loans'] });
    qc.invalidateQueries({ queryKey: ['customers'] });
    qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => apiPost(`/approval-requests/${id}/approve`, {}),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to approve request.');
    },
  });

  const reject = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      apiPost(`/approval-requests/${input.id}/reject`, { reason: input.reason }),
    onSuccess: () => {
      setError(null);
      setRejectingId(null);
      setReason('');
      invalidate();
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to reject request.');
    },
  });

  const submitReject = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (rejectingId) reject.mutate({ id: rejectingId, reason });
  };

  return (
    <PageShell
      title="Approval Requests"
      description={
        canReview
          ? 'Manager-submitted actions awaiting your sign-off before they take effect.'
          : 'Your submitted actions and their approval status.'
      }
    >
      {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      {rejectingId && (
        <Card>
          <CardHeader><CardTitle>Reject Request</CardTitle></CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-center gap-3" onSubmit={submitReject}>
              <Input
                placeholder="Reason for rejection"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                className="w-72"
              />
              <Button variant="danger" disabled={reject.isPending}>Confirm Reject</Button>
              <Button type="button" variant="outline" onClick={() => { setRejectingId(null); setReason(''); }}>Cancel</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {canReview ? (
        <DataTable
          columns={['Requested By', 'Action', 'Details', 'Submitted', 'Decision']}
          rows={queue.map((r) => [
            r.requested_by_name ?? '-',
            ACTION_LABEL[r.action_type] ?? r.action_type,
            summarize(r),
            dateTime(r.created_at),
            <div key={r.id} className="flex gap-2">
              <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button size="sm" variant="danger" onClick={() => { setRejectingId(r.id); setReason(''); }}>
                <X className="h-4 w-4" /> Reject
              </Button>
            </div>,
          ])}
          empty="No pending approval requests"
        />
      ) : (
        <DataTable
          columns={['Action', 'Details', 'Submitted', 'Status', 'Review Note']}
          rows={mine.map((r) => [
            ACTION_LABEL[r.action_type] ?? r.action_type,
            summarize(r),
            dateTime(r.created_at),
            <StatusPill key={r.id} value={r.status} />,
            r.review_note ?? '-',
          ])}
          empty="You have no submitted approval requests"
        />
      )}
    </PageShell>
  );
}
