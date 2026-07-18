'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { apiPost } from '@/lib/api';
import { inr } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AgentPending {
  agentId: string;
  agentName: string;
  pendingAmount: number;
  dueAmount: number;
}

export function HandoverCard({ rows }: { rows: AgentPending[] }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: (input: { agentId: string; submittedAmount: number; note?: string }) =>
      apiPost<{ status: 'applied' | 'pending' }>('/agent-ledger/handover', input),
    onSuccess: (res) => {
      setActiveId(null);
      setError(null);
      setInfo(res.status === 'pending' ? 'Submitted for admin approval — the ledger updates once approved.' : null);
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to record handover.');
    },
  });

  if (!rows.length) return null;

  const submit = (agentId: string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    record.mutate({
      agentId,
      submittedAmount: Number(form.get('submittedAmount')),
      note: (form.get('note') as string) || undefined,
    });
  };

  return (
    <Card>
      <CardHeader><CardTitle>Pending Cash Handover</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => (
          <div key={r.agentId} className="rounded-lg border p-3">
            <div className="flex items-center justify-between text-sm">
              <div>
                <p className="font-medium">{r.agentName}</p>
                <p className="text-xs text-muted-foreground">
                  Pending {inr(r.pendingAmount)}
                  {r.dueAmount > 0 && <> · Due {inr(r.dueAmount)}</>}
                </p>
              </div>
              {can('collection.handover') && r.pendingAmount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setActiveId(activeId === r.agentId ? null : r.agentId)}
                >
                  Record Handover
                </Button>
              )}
            </div>
            {activeId === r.agentId && (
              <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={submit(r.agentId)}>
                <Input
                  name="submittedAmount"
                  type="number"
                  step="0.01"
                  placeholder={`Expected ~${r.pendingAmount}`}
                  required
                  className="w-full sm:w-40"
                />
                <Input name="note" placeholder="Note (optional)" className="w-full sm:w-56" />
                <Button size="sm" disabled={record.isPending}>Confirm</Button>
              </form>
            )}
          </div>
        ))}
        {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        {info && <div className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">{info}</div>}
      </CardContent>
    </Card>
  );
}
