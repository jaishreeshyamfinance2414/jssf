'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Minus, Plus } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Account { id: string; name: string; type: string; balance: number }
interface CapitalEntry { id: string; contributor_name: string; source_type: string; amount: string; entry_date: string; account_name: string; note: string | null }
interface CapitalWithdrawal { id: string; amount: string; withdrawal_date: string; account_name: string; note: string | null }
interface CapitalData { entries: CapitalEntry[]; withdrawals: CapitalWithdrawal[]; totalIntroduced: number; totalWithdrawn: number; netCapital: number }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const apiError = (err: unknown, fallback: string) => {
  const ax = err as AxiosError<{ error?: { message?: string } }>;
  return ax.response?.data?.error?.message ?? fallback;
};

export default function CapitalPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/accounts') });
  const { data } = useQuery({ queryKey: ['capital'], queryFn: () => apiGet<CapitalData>('/capital') });
  const [form, setForm] = useState({ accountId: '', sourceType: 'owner_capital', contributorName: '', amount: '', entryDate: today(), note: '' });
  const [withdrawForm, setWithdrawForm] = useState({ accountId: '', amount: '', withdrawalDate: today(), note: '' });
  const [createError, setCreateError] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      apiPost('/capital', {
        ...form,
        accountId: form.accountId || accounts[0]?.id || '',
        amount: Number(form.amount),
      }),
    onSuccess: () => {
      setCreateError(null);
      setForm({ accountId: '', sourceType: 'owner_capital', contributorName: '', amount: '', entryDate: today(), note: '' });
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err) => setCreateError(apiError(err, 'Unable to add capital.')),
  });
  const withdraw = useMutation({
    mutationFn: () =>
      apiPost('/capital/withdrawals', {
        ...withdrawForm,
        accountId: withdrawForm.accountId || accounts[0]?.id || '',
        amount: Number(withdrawForm.amount),
      }),
    onSuccess: () => {
      setWithdrawError(null);
      setWithdrawForm({ accountId: '', amount: '', withdrawalDate: today(), note: '' });
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['account-transactions'] });
    },
    onError: (err) => setWithdrawError(apiError(err, 'Unable to withdraw capital.')),
  });
  const accountId = form.accountId || accounts[0]?.id || '';
  const withdrawAccountId = withdrawForm.accountId || accounts[0]?.id || '';
  return (
    <PageShell title="Capital" description="Track capital introduced and returned through cash or bank accounts.">
      {isAdmin && <Card>
        <CardHeader><CardTitle>Introduce Capital</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
              {accounts.map((a) => <option value={a.id} key={a.id}>{a.name} ({a.type}) — {money(a.balance)}</option>)}
            </select>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}>
              <option value="owner_capital">Own fund</option><option value="external_loan">Loan / borrowed</option><option value="other">Credit card / other</option>
            </select>
            <Input placeholder="Source name" value={form.contributorName} onChange={(e) => setForm({ ...form, contributorName: e.target.value })} required />
            <Input type="number" min="0.01" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            <Input type="date" max={today()} value={form.entryDate} onChange={(e) => setForm({ ...form, entryDate: e.target.value })} required />
            <Button disabled={create.isPending || !accountId}><Plus className="h-4 w-4" /> Add Capital</Button>
          </form>
          {createError && <div className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{createError}</div>}
        </CardContent>
      </Card>}
      {isAdmin && <Card>
        <CardHeader><CardTitle>Capital Withdraw</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); withdraw.mutate(); }}>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={withdrawAccountId} onChange={(e) => setWithdrawForm({ ...withdrawForm, accountId: e.target.value })}>
              {accounts.map((a) => <option value={a.id} key={a.id}>{a.name} ({a.type}) — available {money(a.balance)}</option>)}
            </select>
            <Input type="number" min="0.01" step="0.01" placeholder="Amount" value={withdrawForm.amount} onChange={(e) => setWithdrawForm({ ...withdrawForm, amount: e.target.value })} required />
            <Input type="date" max={today()} value={withdrawForm.withdrawalDate} onChange={(e) => setWithdrawForm({ ...withdrawForm, withdrawalDate: e.target.value })} required />
            <Input placeholder="Note (optional)" value={withdrawForm.note} onChange={(e) => setWithdrawForm({ ...withdrawForm, note: e.target.value })} />
            <Button variant="danger" disabled={withdraw.isPending || !withdrawAccountId}><Minus className="h-4 w-4" /> Withdraw Capital</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Withdrawal cannot exceed net invested capital and is allowed only when the selected cash or bank account has enough available balance.</p>
          {withdrawError && <div className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{withdrawError}</div>}
        </CardContent>
      </Card>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardTitle>Total Introduced</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{money(data?.totalIntroduced)}</CardContent></Card>
        <Card><CardHeader><CardTitle>Total Withdrawn</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{money(data?.totalWithdrawn)}</CardContent></Card>
        <Card><CardHeader><CardTitle>Net Capital</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{money(data?.netCapital)}</CardContent></Card>
      </div>
      <CardHeader className="px-0 pb-2"><CardTitle>Capital Introduced</CardTitle></CardHeader>
      <DataTable columns={['Date', 'Source', 'Type', 'Account', 'Amount']} rows={(data?.entries ?? []).map((e) => [date(e.entry_date), e.contributor_name, e.source_type, e.account_name, money(e.amount)])} />
      <CardHeader className="px-0 pb-2"><CardTitle>Capital Withdrawals</CardTitle></CardHeader>
      <DataTable columns={['Date', 'Account', 'Amount', 'Note']} rows={(data?.withdrawals ?? []).map((w) => [date(w.withdrawal_date), w.account_name, money(w.amount), w.note || '-'])} empty="No capital withdrawals recorded" />
    </PageShell>
  );
}
