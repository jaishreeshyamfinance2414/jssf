'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Account { id: string; name: string; type: 'cash' | 'bank'; balance: number }
interface Txn {
  id: string;
  direction: 'credit' | 'debit';
  amount: string;
  source: string;
  description: string | null;
  txn_date: string;
  created_at: string;
  running_balance: string;
}

const SOURCE_LABEL: Record<string, string> = {
  capital: 'Capital Introduced',
  collection: 'Collection Received',
  agent_submission: 'Agent Cash Submission',
  loan_disbursement: 'Loan Disbursed',
  expense: 'Expense',
  salary: 'Salary Paid',
  adjustment: 'Manual Adjustment',
};

export default function AccountsPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const { data = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/accounts') });
  const { data: txns = [] } = useQuery({
    queryKey: ['account-transactions', openId],
    queryFn: () => apiGet<Txn[]>(`/accounts/${openId}/transactions`),
    enabled: !!openId,
  });
  const cash = data.filter((a) => a.type === 'cash').reduce((s, a) => s + a.balance, 0);
  const bank = data.filter((a) => a.type === 'bank').reduce((s, a) => s + a.balance, 0);
  const openAccount = data.find((a) => a.id === openId);

  return (
    <PageShell title="Cash & Bank" description="Live business liquidity after capital, disbursements, collections, expenses, and salary.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardHeader><CardTitle>Cash In Hand</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{money(cash)}</CardContent></Card>
        <Card><CardHeader><CardTitle>Bank Balance</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{money(bank)}</CardContent></Card>
      </div>
      <DataTable
        columns={['Account', 'Type', 'Balance', 'Action']}
        rows={data.map((a) => [
          <span className="flex items-center gap-2" key={a.id}><Wallet className="h-4 w-4" />{a.name}</span>,
          a.type,
          money(a.balance),
          <Button key={`${a.id}-btn`} size="sm" variant="outline" onClick={() => setOpenId(a.id === openId ? null : a.id)}>
            {a.id === openId ? 'Hide Ledger' : 'View Ledger'}
          </Button>,
        ])}
      />
      {openAccount && (
        <Card>
          <CardHeader><CardTitle>{openAccount.name} — Ledger (how the balance arrived)</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              columns={['Date & Time', 'Description', 'Source', 'Credit', 'Debit', 'Running Balance']}
              rows={txns.map((t) => [
                dateTime(t.created_at),
                t.description || SOURCE_LABEL[t.source] || t.source,
                SOURCE_LABEL[t.source] ?? t.source,
                t.direction === 'credit' ? money(t.amount) : '-',
                t.direction === 'debit' ? money(t.amount) : '-',
                money(t.running_balance),
              ])}
              empty="No transactions recorded for this account yet"
            />
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
