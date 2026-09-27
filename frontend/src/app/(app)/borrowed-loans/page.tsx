'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Landmark, Plus } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { date, money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Account { id: string; name: string; type: string; balance: number }
interface BorrowedLoan {
  id: string; lender_name: string; loan_type: 'reducing_balance' | 'interest_only';
  receiving_account_name: string; original_principal: string; installment_count: number | null;
  installment_amount: string | null; total_payable: string | null; total_interest: string;
  periodic_interest: string | null; received_date: string; status: 'active' | 'closed';
  principal_paid: string; interest_paid: string; outstanding_principal: string;
  next_payment_date: string | null; next_payment_amount: string | null; overdue_payments: number;
}
interface Payment {
  id: string; payment_date: string; principal_amount: string; interest_amount: string;
  total_amount: string; account_name: string; installment_no: number | null;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const nextMonth = () => {
  const [year, month, day] = today().split('-').map(Number);
  const value = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(day, lastDay));
  return value.toISOString().slice(0, 10);
};
const errorMessage = (error: unknown, fallback: string) =>
  (error as AxiosError<{ error?: { message?: string } }>).response?.data?.error?.message ?? fallback;

export default function BorrowedLoansPage() {
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/accounts') });
  const { data: loans = [] } = useQuery({ queryKey: ['borrowed-loans'], queryFn: () => apiGet<BorrowedLoan[]>('/borrowed-loans') });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = loans.find((loan) => loan.id === selectedId);
  const { data: payments = [] } = useQuery({
    queryKey: ['borrowed-loan-payments', selectedId],
    queryFn: () => apiGet<Payment[]>(`/borrowed-loans/${selectedId}/payments`),
    enabled: !!selectedId,
  });
  const [form, setForm] = useState({
    lenderName: '', loanType: 'reducing_balance', receivingAccountId: '', loanAmount: '',
    receivedDate: today(), firstPaymentDate: nextMonth(), installmentCount: '',
    installmentAmount: '', interestPaymentAmount: '', note: '',
  });
  const [payment, setPayment] = useState({ accountId: '', paymentDate: today(), principalAmount: '' });
  const [createError, setCreateError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiPost('/borrowed-loans', {
      ...form,
      receivingAccountId: form.receivingAccountId || accounts[0]?.id || '',
      loanAmount: Number(form.loanAmount),
      ...(form.loanType === 'reducing_balance'
        ? { installmentCount: Number(form.installmentCount), installmentAmount: Number(form.installmentAmount) }
        : { interestPaymentAmount: Number(form.interestPaymentAmount) }),
    }),
    onSuccess: () => {
      setCreateError(null);
      setForm({ lenderName: '', loanType: 'reducing_balance', receivingAccountId: '', loanAmount: '', receivedDate: today(), firstPaymentDate: nextMonth(), installmentCount: '', installmentAmount: '', interestPaymentAmount: '', note: '' });
      qc.invalidateQueries({ queryKey: ['borrowed-loans'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (error) => setCreateError(errorMessage(error, 'Unable to create borrowed loan.')),
  });
  const pay = useMutation({
    mutationFn: () => apiPost(`/borrowed-loans/${selectedId}/payments`, {
      accountId: payment.accountId || accounts[0]?.id || '',
      paymentDate: payment.paymentDate,
      principalAmount: Number(payment.principalAmount || 0),
    }),
    onSuccess: () => {
      setPaymentError(null);
      setPayment({ accountId: '', paymentDate: today(), principalAmount: '' });
      qc.invalidateQueries({ queryKey: ['borrowed-loans'] });
      qc.invalidateQueries({ queryKey: ['borrowed-loan-payments', selectedId] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['account-transactions'] });
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (error) => setPaymentError(errorMessage(error, 'Unable to record payment.')),
  });

  const totalPayable = Number(form.installmentCount || 0) * Number(form.installmentAmount || 0);
  const calculatedInterest = Math.max(0, totalPayable - Number(form.loanAmount || 0));
  const original = loans.reduce((sum, loan) => sum + Number(loan.original_principal), 0);
  const outstanding = loans.reduce((sum, loan) => sum + Number(loan.outstanding_principal), 0);
  const interestPaid = loans.reduce((sum, loan) => sum + Number(loan.interest_paid), 0);

  return (
    <PageShell title="Borrowed Loans" description="Track money borrowed by the business, repayment liabilities, and interest expense.">
      <Card>
        <CardHeader><CardTitle>Create Borrowed Loan</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
            <Input placeholder="Bank / lender name" value={form.lenderName} onChange={(event) => setForm({ ...form, lenderName: event.target.value })} required />
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.loanType} onChange={(event) => setForm({ ...form, loanType: event.target.value })}>
              <option value="reducing_balance">Reducing-balance loan</option>
              <option value="interest_only">Interest-only loan</option>
            </select>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.receivingAccountId || accounts[0]?.id || ''} onChange={(event) => setForm({ ...form, receivingAccountId: event.target.value })}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({account.type})</option>)}
            </select>
            <Input type="number" min="0.01" step="0.01" placeholder="Total loan amount taken" value={form.loanAmount} onChange={(event) => setForm({ ...form, loanAmount: event.target.value })} required />
            <label className="text-xs text-muted-foreground">Received date<Input className="mt-1" type="date" max={today()} value={form.receivedDate} onChange={(event) => setForm({ ...form, receivedDate: event.target.value })} required /></label>
            <label className="text-xs text-muted-foreground">First payment due date<Input className="mt-1" type="date" min={form.receivedDate} value={form.firstPaymentDate} onChange={(event) => setForm({ ...form, firstPaymentDate: event.target.value })} required /></label>
            {form.loanType === 'reducing_balance' ? <>
              <Input type="number" min="1" step="1" placeholder="Total number of EMIs" value={form.installmentCount} onChange={(event) => setForm({ ...form, installmentCount: event.target.value })} required />
              <Input type="number" min="0.01" step="0.01" placeholder="EMI amount" value={form.installmentAmount} onChange={(event) => setForm({ ...form, installmentAmount: event.target.value })} required />
            </> : <Input type="number" min="0.01" step="0.01" placeholder="Monthly interest payment" value={form.interestPaymentAmount} onChange={(event) => setForm({ ...form, interestPaymentAmount: event.target.value })} required />}
            <Input placeholder="Note (optional)" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            <Button disabled={create.isPending || !accounts.length}><Plus className="h-4 w-4" /> Create Loan</Button>
          </form>
          {form.loanType === 'reducing_balance' && !!form.loanAmount && !!form.installmentCount && !!form.installmentAmount && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm">Total payable: <strong>{money(totalPayable)}</strong> · Total interest expense: <strong>{money(calculatedInterest)}</strong></div>
          )}
          {createError && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{createError}</div>}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardTitle>Original Borrowed</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{money(original)}</CardContent></Card>
        <Card><CardHeader><CardTitle>Outstanding Principal</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{money(outstanding)}</CardContent></Card>
        <Card><CardHeader><CardTitle>Interest Paid (Expense)</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{money(interestPaid)}</CardContent></Card>
      </div>

      <DataTable columns={['Lender', 'Type', 'Original', 'Outstanding', 'Principal Paid', 'Interest Paid', 'Next Payment', 'Overdue', 'Action']} rows={loans.map((loan) => [
        <span className="flex items-center gap-2" key={loan.id}><Landmark className="h-4 w-4" />{loan.lender_name}</span>,
        loan.loan_type === 'reducing_balance' ? 'Reducing balance' : 'Interest only', money(loan.original_principal),
        money(loan.outstanding_principal), money(loan.principal_paid), money(loan.interest_paid),
        loan.next_payment_date ? `${date(loan.next_payment_date)} · ${money(loan.next_payment_amount)}` : '-',
        loan.overdue_payments ? <span className="font-semibold text-danger">{loan.overdue_payments}</span> : '0',
        <Button key={`${loan.id}-pay`} size="sm" variant="outline" onClick={() => { setSelectedId(loan.id); setPaymentError(null); }} disabled={loan.status === 'closed'}>{loan.status === 'closed' ? 'Closed' : 'Record Payment'}</Button>,
      ])} empty="No borrowed loans recorded" />

      {selected && <Card>
        <CardHeader><CardTitle>Record Payment — {selected.lender_name}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            Due: <strong>{money(selected.next_payment_amount)}</strong> on <strong>{date(selected.next_payment_date)}</strong>
            {selected.loan_type === 'interest_only' && <> · Monthly interest: <strong>{money(selected.periodic_interest)}</strong></>}
            {selected.loan_type === 'reducing_balance' && <> · Total payable: <strong>{money(selected.total_payable)}</strong> · Scheduled interest: <strong>{money(selected.total_interest)}</strong></>}
          </div>
          <form className="grid gap-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); pay.mutate(); }}>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={payment.accountId || accounts[0]?.id || ''} onChange={(event) => setPayment({ ...payment, accountId: event.target.value })}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} — available {money(account.balance)}</option>)}
            </select>
            <label className="text-xs text-muted-foreground">Payment date<Input className="mt-1" type="date" min={selected.received_date.slice(0, 10)} max={today()} value={payment.paymentDate} onChange={(event) => setPayment({ ...payment, paymentDate: event.target.value })} required /></label>
            {selected.loan_type === 'interest_only' && <label className="text-xs text-muted-foreground">Optional principal repayment<Input className="mt-1" type="number" min="0" step="0.01" max={selected.outstanding_principal} placeholder="0" value={payment.principalAmount} onChange={(event) => setPayment({ ...payment, principalAmount: event.target.value })} /></label>}
            <Button disabled={pay.isPending || !accounts.length}>Record {selected.loan_type === 'reducing_balance' ? 'EMI' : 'Interest Payment'}</Button>
          </form>
          {paymentError && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{paymentError}</div>}
          <DataTable columns={['Payment Date', 'EMI No.', 'Account', 'Principal', 'Interest Expense', 'Total Paid']} rows={payments.map((item) => [date(item.payment_date), item.installment_no ?? '-', item.account_name, money(item.principal_amount), money(item.interest_amount), money(item.total_amount)])} empty="No payments recorded for this loan" />
        </CardContent>
      </Card>}
    </PageShell>
  );
}
