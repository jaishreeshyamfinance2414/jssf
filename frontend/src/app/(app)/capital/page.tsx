'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Plus } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { date, money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Account { id: string; name: string; type: string; balance: number }
interface CapitalEntry { id: string; contributor_name: string; source_type: string; amount: string; entry_date: string; account_name: string; note: string | null }
interface CapitalData { entries: CapitalEntry[]; totalIntroduced: number }

export default function CapitalPage() {
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/accounts') });
  const { data } = useQuery({ queryKey: ['capital'], queryFn: () => apiGet<CapitalData>('/capital') });
  const [form, setForm] = useState({ accountId: '', sourceType: 'owner_capital', contributorName: '', amount: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      apiPost('/capital', {
        ...form,
        accountId: form.accountId || accounts[0]?.id || '',
        amount: Number(form.amount),
        entryDate: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      setError(null);
      setForm({ accountId: '', sourceType: 'owner_capital', contributorName: '', amount: '', note: '' });
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to add capital.');
    },
  });
  const accountId = form.accountId || accounts[0]?.id || '';
  return (
    <PageShell title="Capital" description="Introduce business money from own funds, external loans, credit cards, or borrowed sources.">
      <Card>
        <CardHeader><CardTitle>Introduce Capital</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
              {accounts.map((a) => <option value={a.id} key={a.id}>{a.name} ({a.type})</option>)}
            </select>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}>
              <option value="owner_capital">Own fund</option><option value="external_loan">Loan / borrowed</option><option value="other">Credit card / other</option>
            </select>
            <Input placeholder="Source name" value={form.contributorName} onChange={(e) => setForm({ ...form, contributorName: e.target.value })} required />
            <Input type="number" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            <Button disabled={create.isPending || !accountId}><Plus className="h-4 w-4" /> Add Capital</Button>
          </form>
          {error && <div className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Total Introduced</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{money(data?.totalIntroduced)}</CardContent></Card>
      <DataTable columns={['Date', 'Source', 'Type', 'Account', 'Amount']} rows={(data?.entries ?? []).map((e) => [date(e.entry_date), e.contributor_name, e.source_type, e.account_name, money(e.amount)])} />
    </PageShell>
  );
}
