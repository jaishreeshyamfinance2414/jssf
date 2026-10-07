'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { ArrowUpDown, Plus, Search, Trash2, Wallet } from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { date, money } from '@/lib/format';
import { DataTable } from '@/components/app/data-table';
import { PageShell } from '@/components/app/page-shell';
import { StatusPill } from '@/components/app/status-pill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Member {
  user_id: string; staff_name: string; role_name: string;
  monthly_salary: string | null; payment_day: number | null;
  salary_date: string | null;
  upcoming_expense_deduct: string; upcoming_payable: string | null;
  last_paid_at: string | null;
}

interface Salary {
  id: string; user_id: string; staff_name: string; role_name: string;
  period_year: number; period_month: number; base_salary: string;
  cash_short_deduct: string; advance_deduct: string; expense_deduct: string;
  final_salary: string; mode: string; paid_at: string; note: string | null;
}

interface Payable {
  baseSalary: number; pendingExpense: number; expenseDeduct: number; finalSalary: number;
  lastSalaryDate: string; upcomingSalaryDate: string;
}
interface PersonalExpense {
  id: string; user_id: string; staff_name: string; role_name: string;
  expense_date: string; description: string | null; amount: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const now = new Date();
const upcoming = new Date(now.getFullYear(), now.getMonth() + 1, 1);
const emptyPay = () => ({
  userId: '', periodYear: String(upcoming.getFullYear()), periodMonth: String(upcoming.getMonth() + 1),
  cashShortDeduct: '', advanceDeduct: '', mode: 'cash', paidDate: now.toISOString().slice(0, 10), note: '',
});

export default function SalaryPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [showMember, setShowMember] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('latest');
  const [expenseMonth, setExpenseMonth] = useState('');
  const [memberForm, setMemberForm] = useState({ userId: '', monthlySalary: '', salaryDate: upcoming.toISOString().slice(0, 10) });
  const [payForm, setPayForm] = useState(emptyPay);
  const { data: members = [] } = useQuery({ queryKey: ['salary-members'], queryFn: () => apiGet<Member[]>('/salaries/members') });
  const { data: salaries = [] } = useQuery({ queryKey: ['salaries'], queryFn: () => apiGet<Salary[]>('/salaries') });
  const { data: personalExpenses = [], isFetching: personalExpensesLoading } = useQuery({
    queryKey: ['salary-user-expenses', expenseMonth],
    queryFn: () => apiGet<PersonalExpense[]>(`/salaries/user-expenses?month=${expenseMonth}`),
    enabled: Boolean(expenseMonth),
  });

  const payableParams = new URLSearchParams({
    userId: payForm.userId, periodYear: payForm.periodYear, periodMonth: payForm.periodMonth,
    cashShortDeduct: payForm.cashShortDeduct || '0', advanceDeduct: payForm.advanceDeduct || '0',
  });
  const { data: payable, error: payableError } = useQuery({
    queryKey: ['salary-payable', payForm.userId, payForm.periodYear, payForm.periodMonth, payForm.cashShortDeduct, payForm.advanceDeduct],
    queryFn: () => apiGet<Payable>(`/salaries/payable?${payableParams}`),
    enabled: Boolean(payForm.userId && payForm.periodYear && payForm.periodMonth),
    retry: false,
  });

  function showError(fallback: string) {
    return (err: Error) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? fallback);
    };
  }

  const saveMember = useMutation({
    mutationFn: () => apiPost('/salaries/members', {
      userId: memberForm.userId, monthlySalary: Number(memberForm.monthlySalary), salaryDate: memberForm.salaryDate,
    }),
    onSuccess: () => {
      setError(null); setShowMember(false); setMemberForm({ userId: '', monthlySalary: '', salaryDate: upcoming.toISOString().slice(0, 10) });
      qc.invalidateQueries({ queryKey: ['salary-members'] });
    },
    onError: showError('Unable to save member salary.'),
  });

  const pay = useMutation({
    mutationFn: () => apiPost('/salaries', {
      userId: payForm.userId, periodYear: Number(payForm.periodYear), periodMonth: Number(payForm.periodMonth),
      cashShortDeduct: Number(payForm.cashShortDeduct || 0), advanceDeduct: Number(payForm.advanceDeduct || 0),
      mode: payForm.mode, paidDate: payForm.paidDate, note: payForm.note || undefined,
    }),
    onSuccess: () => {
      setError(null); setShowPay(false); setPayForm(emptyPay());
      qc.invalidateQueries({ queryKey: ['salaries'] }); qc.invalidateQueries({ queryKey: ['salary-members'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: showError('Unable to record salary.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/salaries/${id}`),
    onSuccess: () => {
      setError(null); qc.invalidateQueries({ queryKey: ['salaries'] });
      qc.invalidateQueries({ queryKey: ['salary-members'] }); qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: showError('Unable to delete salary record.'),
  });

  function editMember(member: Member) {
    setMemberForm({ userId: member.user_id, monthlySalary: member.monthly_salary ?? '', salaryDate: member.salary_date?.slice(0, 10) ?? upcoming.toISOString().slice(0, 10) });
    setShowMember(true); setShowPay(false);
  }

  function openPay(member: Member) {
    const next = emptyPay();
    if (member.salary_date) {
      const [year, month] = member.salary_date.slice(0, 10).split('-');
      next.periodYear = year; next.periodMonth = String(Number(month)); next.paidDate = member.salary_date.slice(0, 10);
    }
    setPayForm({ ...next, userId: member.user_id }); setShowPay(true); setShowMember(false);
  }

  const totalPaid = salaries.reduce((sum, salary) => sum + Number(salary.final_salary), 0);
  const totalDeductions = salaries.reduce((sum, salary) => sum + Number(salary.cash_short_deduct) + Number(salary.advance_deduct) + Number(salary.expense_deduct), 0);
  const thisMonthPaid = salaries.filter((salary) => salary.period_year === now.getFullYear() && salary.period_month === now.getMonth() + 1).reduce((sum, salary) => sum + Number(salary.final_salary), 0);
  const term = search.trim().toLowerCase();
  const visibleSalaries = salaries
    .filter((salary) => !term || salary.staff_name.toLowerCase().includes(term) || salary.role_name.toLowerCase().includes(term) || `${MONTHS[salary.period_month - 1]} ${salary.period_year}`.toLowerCase().includes(term))
    .sort((a, b) => {
      if (sort === 'name') return a.staff_name.localeCompare(b.staff_name);
      if (sort === 'amount') return Number(b.final_salary) - Number(a.final_salary);
      return (b.period_year * 100 + b.period_month) - (a.period_year * 100 + a.period_month);
    });

  return (
    <PageShell
      title="Salary"
      description="Fixed monthly salaries, automatic personal-expense deductions, and payment history."
      action={can('salary.manage') ? <Button onClick={() => { setShowMember(true); setShowPay(false); }}><Plus className="h-4 w-4" /> Add Member Salary</Button> : undefined}
    >
      {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active Members" value={String(members.length)} tone="blue" />
        <Metric label={`Paid — ${MONTHS[now.getMonth()]}`} value={money(thisMonthPaid)} tone="green" />
        <Metric label="Total Paid" value={money(totalPaid)} tone="violet" />
        <Metric label="Total Deductions" value={money(totalDeductions)} tone="red" />
      </div>

      {showMember && (
        <Card>
          <CardHeader><CardTitle>Add Member Salary</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); saveMember.mutate(); }}>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={memberForm.userId} onChange={(event) => setMemberForm({ ...memberForm, userId: event.target.value })} required>
                <option value="">Select active user</option>
                {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.staff_name} — {member.role_name}</option>)}
              </select>
              <Input type="number" min="0.01" step="0.01" placeholder="Fixed monthly salary" value={memberForm.monthlySalary} onChange={(event) => setMemberForm({ ...memberForm, monthlySalary: event.target.value })} required />
              <div><label className="mb-1 block text-xs text-muted-foreground">Salary giving date</label><Input type="date" value={memberForm.salaryDate} onChange={(event) => setMemberForm({ ...memberForm, salaryDate: event.target.value })} required /></div>
              <Button className="md:col-span-3" disabled={saveMember.isPending}>Save Member Salary</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {showPay && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Pay Salary</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); pay.mutate(); }}>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={payForm.userId} onChange={(event) => setPayForm({ ...payForm, userId: event.target.value })} required>
                <option value="">Select configured member</option>
                {members.filter((member) => member.monthly_salary).map((member) => <option key={member.user_id} value={member.user_id}>{member.staff_name}</option>)}
              </select>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={payForm.periodMonth} onChange={(event) => setPayForm({ ...payForm, periodMonth: event.target.value })}>
                {MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
              </select>
              <Input type="number" placeholder="Year" value={payForm.periodYear} onChange={(event) => setPayForm({ ...payForm, periodYear: event.target.value })} required />
              <Input type="number" min="0" step="0.01" placeholder="Cash shortage deduction" value={payForm.cashShortDeduct} onChange={(event) => setPayForm({ ...payForm, cashShortDeduct: event.target.value })} />
              <Input type="number" min="0" step="0.01" placeholder="Advance deduction" value={payForm.advanceDeduct} onChange={(event) => setPayForm({ ...payForm, advanceDeduct: event.target.value })} />
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={payForm.mode} onChange={(event) => setPayForm({ ...payForm, mode: event.target.value })}>
                <option value="cash">Pay from Cash</option><option value="bank_transfer">Pay from Bank</option>
              </select>
              <Input type="date" value={payForm.paidDate} onChange={(event) => setPayForm({ ...payForm, paidDate: event.target.value })} required />
              <Input className="md:col-span-2" placeholder="Note (optional)" value={payForm.note} onChange={(event) => setPayForm({ ...payForm, note: event.target.value })} />
              {payableError && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger md:col-span-3">{(payableError as AxiosError<{ error?: { message?: string } }>).response?.data?.error?.message ?? 'Unable to calculate salary.'}</div>}
              {payable && <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm md:col-span-3 sm:grid-cols-3"><div><span className="block text-xs text-muted-foreground">Salary cycle</span><b>{date(payable.lastSalaryDate)} → {date(payable.upcomingSalaryDate)}</b></div><div><span className="block text-xs text-muted-foreground">Personal expenses</span><b className="text-danger">-{money(payable.expenseDeduct)}</b></div><div><span className="block text-xs text-muted-foreground">Exact salary to pay</span><b className="text-emerald-700 dark:text-emerald-300">{money(payable.finalSalary)}</b></div></div>}
              <Button className="md:col-span-3" disabled={pay.isPending || !payable}>Record Salary Payment</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
          <CardHeader className="border-b bg-primary/5"><CardTitle className="text-lg">Active Members</CardTitle><p className="text-sm text-muted-foreground">Fixed monthly salary compared with the exact amount remaining to pay.</p></CardHeader>
          <CardContent className="pt-6">
          <DataTable
            columns={['Member', 'Role', 'Monthly Salary', 'Upcoming Salary', 'Salary Giving Date', 'Last Paid On', 'Actions']}
            rows={members.map((member) => [
              member.staff_name,
              <StatusPill key={`${member.user_id}-role`} value={member.role_name} />,
              member.monthly_salary ? <div key={`${member.user_id}-fixed`} className="inline-flex h-14 min-w-28 flex-col justify-center whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 dark:border-blue-900 dark:bg-blue-950/40"><span className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Fixed salary</span><span className="text-base font-bold text-blue-900 dark:text-blue-100">{money(member.monthly_salary)}</span></div> : <span className="font-medium text-muted-foreground">Not configured</span>,
              member.monthly_salary ? <UpcomingSalary key={`${member.user_id}-upcoming`} member={member} /> : '-',
              member.salary_date ? date(member.salary_date) : '-',
              member.last_paid_at ? date(member.last_paid_at) : '-',
              can('salary.manage') ? <div key={`${member.user_id}-actions`} className="flex flex-nowrap gap-2 whitespace-nowrap"><Button size="sm" variant="outline" onClick={() => editMember(member)}>{member.monthly_salary ? 'Edit' : 'Add Salary'}</Button>{member.monthly_salary && <Button size="sm" onClick={() => openPay(member)}>Pay</Button>}</div> : '-',
            ])}
            rowClassNames={members.map((member) => Number(member.upcoming_expense_deduct) > 0 ? 'bg-amber-50/40 dark:bg-amber-950/10' : '')}
            empty="No active users"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b bg-amber-50 dark:bg-amber-950/20"><CardTitle className="text-lg text-amber-900 dark:text-amber-100">Monthly Personal Expenses</CardTitle><p className="text-sm text-amber-800/80 dark:text-amber-200/70">Money already taken by each member, including the admin/owner.</p></CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="max-w-xs">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Select expense month</label>
            <Input type="month" value={expenseMonth} onChange={(event) => setExpenseMonth(event.target.value)} />
          </div>
          {!expenseMonth ? (
            <div className="rounded-xl border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">Select a month to view staff personal expenses.</div>
          ) : personalExpensesLoading ? (
            <div className="rounded-xl border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">Loading personal expenses...</div>
          ) : (
            <DataTable
              columns={['Member', 'Role', 'Expense Date', 'Description', 'Personal Expense']}
              rows={personalExpenses.map((expense) => [
                expense.staff_name,
                <StatusPill key={`${expense.id}-role`} value={expense.role_name} />,
                date(expense.expense_date),
                expense.description ?? '-',
                <span key={`${expense.id}-amount`} className="inline-flex rounded-full bg-red-100 px-3 py-1 font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">{money(expense.amount)}</span>,
              ])}
              empty="No personal expenses recorded for the selected month"
            />
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search salary history..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="latest">Latest First</option><option value="name">Staff Name</option><option value="amount">Highest Paid</option>
          </select>
        </div>
      </div>
      <DataTable
        columns={['Staff', 'Role', 'Period', 'Base', 'Shortage', 'Advance', 'User Expense', 'Final Paid', 'Mode', 'Paid On', 'Note', 'Action']}
        rows={visibleSalaries.map((salary) => [
          salary.staff_name, <StatusPill key={`${salary.id}-role`} value={salary.role_name} />, `${MONTHS[salary.period_month - 1]} ${salary.period_year}`,
          <span key={`${salary.id}-base`} className="font-semibold text-blue-700 dark:text-blue-300">{money(salary.base_salary)}</span>,
          Number(salary.cash_short_deduct) ? <span key={`${salary.id}-short`} className="text-red-600">-{money(salary.cash_short_deduct)}</span> : '-',
          Number(salary.advance_deduct) ? <span key={`${salary.id}-advance`} className="text-red-600">-{money(salary.advance_deduct)}</span> : '-',
          Number(salary.expense_deduct) ? <span key={`${salary.id}-expense`} className="text-red-600">-{money(salary.expense_deduct)}</span> : '-',
          <span key={`${salary.id}-final`} className="inline-flex rounded-full bg-emerald-100 px-3 py-1 font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">{money(salary.final_salary)}</span>,
          salary.mode === 'cash' ? 'Cash' : 'UPI/Bank', date(salary.paid_at), salary.note ?? '-',
          can('salary.manage') ? <Button key={salary.id} size="sm" variant="danger" disabled={remove.isPending} onClick={() => { if (confirm(`Delete salary payment for ${salary.staff_name}?`)) remove.mutate(salary.id); }}><Trash2 className="h-4 w-4" /> Delete</Button> : '-',
        ])}
        empty="No salary payments recorded yet"
      />
    </PageShell>
  );
}

function UpcomingSalary({ member }: { member: Member }) {
  const deduction = Number(member.upcoming_expense_deduct);
  const remaining = Number(member.upcoming_payable ?? member.monthly_salary ?? 0);
  const isZero = remaining === 0;
  const tone = isZero
    ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100'
    : deduction > 0
      ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
      : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100';
  return (
    <div className={`flex h-14 min-w-48 flex-col justify-center whitespace-nowrap rounded-lg border px-3 ${tone}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-75">Exact remaining to pay</div>
      <div className="flex items-baseline gap-2"><span className="text-lg font-extrabold">{money(remaining)}</span><span className="text-[11px] font-medium opacity-75">{deduction > 0 ? `after -${money(deduction)}` : 'full payable'}</span></div>
    </div>
  );
}

const metricTones = {
  blue: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
  violet: 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100',
  red: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100',
};

function Metric({ label, value, tone }: { label: string; value: string; tone: keyof typeof metricTones }) {
  return <div className={`rounded-xl border p-4 shadow-sm ${metricTones[tone]}`}><div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div><div className="mt-1 text-xl font-extrabold">{value}</div></div>;
}
