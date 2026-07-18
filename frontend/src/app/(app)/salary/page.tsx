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

interface Staff { id: string; full_name: string; mobile: string; role_name: string; is_active: boolean }
interface Salary {
  id: string;
  user_id: string;
  staff_name: string;
  role_name: string;
  period_year: number;
  period_month: number;
  base_salary: string;
  cash_short_deduct: string;
  advance_deduct: string;
  expense_deduct: string;
  final_salary: string;
  mode: string;
  paid_at: string;
  note: string | null;
  created_by_name: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SORT_OPTIONS = [
  { value: 'latest', label: 'Latest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'name_az', label: 'Staff Name (A → Z)' },
  { value: 'name_za', label: 'Staff Name (Z → A)' },
  { value: 'amount_high', label: 'Final Salary (High → Low)' },
  { value: 'amount_low', label: 'Final Salary (Low → High)' },
  { value: 'deduct_high', label: 'Deductions (High → Low)' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['value'];

const deductions = (s: Salary) => Number(s.cash_short_deduct) + Number(s.advance_deduct) + Number(s.expense_deduct);
const periodValue = (s: Salary) => s.period_year * 100 + s.period_month;

function sortSalaries(list: Salary[], sort: SortKey): Salary[] {
  const byNum = (fn: (s: Salary) => number, dir: 1 | -1) => (a: Salary, b: Salary) => (fn(a) - fn(b)) * dir;
  const sorted = [...list];
  switch (sort) {
    case 'latest': return sorted.sort(byNum(periodValue, -1));
    case 'oldest': return sorted.sort(byNum(periodValue, 1));
    case 'name_az': return sorted.sort((a, b) => a.staff_name.localeCompare(b.staff_name));
    case 'name_za': return sorted.sort((a, b) => b.staff_name.localeCompare(a.staff_name));
    case 'amount_high': return sorted.sort(byNum((s) => Number(s.final_salary), -1));
    case 'amount_low': return sorted.sort(byNum((s) => Number(s.final_salary), 1));
    case 'deduct_high': return sorted.sort(byNum(deductions, -1));
    default: return sorted;
  }
}

const now = new Date();
const EMPTY_FORM = {
  userId: '',
  periodYear: String(now.getFullYear()),
  periodMonth: String(now.getMonth() + 1),
  baseSalary: '',
  cashShortDeduct: '',
  advanceDeduct: '',
  expenseDeduct: '',
  mode: 'cash',
  paidDate: now.toISOString().slice(0, 10),
  note: '',
};

export default function SalaryPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('latest');
  const { data: salaries = [] } = useQuery({ queryKey: ['salaries'], queryFn: () => apiGet<Salary[]>('/salaries') });
  const { data: staff = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<Staff[]>('/users'),
    enabled: can('user.view'),
  });

  const finalSalary = Math.max(
    0,
    Number(form.baseSalary || 0) - Number(form.cashShortDeduct || 0) - Number(form.advanceDeduct || 0) - Number(form.expenseDeduct || 0),
  );

  const create = useMutation({
    mutationFn: () =>
      apiPost('/salaries', {
        userId: form.userId,
        periodYear: Number(form.periodYear),
        periodMonth: Number(form.periodMonth),
        baseSalary: Number(form.baseSalary),
        cashShortDeduct: Number(form.cashShortDeduct || 0),
        advanceDeduct: Number(form.advanceDeduct || 0),
        expenseDeduct: Number(form.expenseDeduct || 0),
        mode: form.mode,
        paidDate: form.paidDate,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      setError(null);
      setShow(false);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ['salaries'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to record salary.');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/salaries/${id}`),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['salaries'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to delete salary record.');
    },
  });

  // Search by staff name, role, period, or amount — then sort.
  const q = search.trim().toLowerCase();
  const visible = sortSalaries(
    q
      ? salaries.filter((s) =>
          s.staff_name.toLowerCase().includes(q) ||
          s.role_name.toLowerCase().includes(q) ||
          MONTHS[s.period_month - 1].toLowerCase().includes(q) ||
          String(s.period_year).includes(q) ||
          String(Number(s.final_salary)).includes(q),
        )
      : salaries,
    sort,
  );

  const totalPaid = salaries.reduce((sum, s) => sum + Number(s.final_salary), 0);
  const thisMonth = salaries
    .filter((s) => s.period_year === now.getFullYear() && s.period_month === now.getMonth() + 1)
    .reduce((sum, s) => sum + Number(s.final_salary), 0);
  const totalDeductions = salaries.reduce((sum, s) => sum + deductions(s), 0);

  return (
    <PageShell
      title="Salary"
      description="Manage staff salary, deductions, agent shortages, and payouts."
      action={can('salary.manage') ? <Button onClick={() => setShow((v) => !v)}><Plus className="h-4 w-4" /> Pay Salary</Button> : undefined}
    >
      {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={`Paid — ${MONTHS[now.getMonth()]} ${now.getFullYear()}`} value={money(thisMonth)} />
        <Metric label="Total Paid (all time)" value={money(totalPaid)} />
        <Metric label="Total Deductions (all time)" value={money(totalDeductions)} />
      </div>
      {show && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Pay Staff Salary</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} required>
                <option value="">Select staff member</option>
                {staff.filter((u) => u.is_active).map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name} — {u.role_name}</option>
                ))}
              </select>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.periodMonth} onChange={(e) => setForm({ ...form, periodMonth: e.target.value })}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <Input type="number" placeholder="Year" value={form.periodYear} onChange={(e) => setForm({ ...form, periodYear: e.target.value })} required />
              <Input type="number" step="0.01" placeholder="Base salary" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} required />
              <Input type="number" step="0.01" placeholder="Cash shortage deduction" value={form.cashShortDeduct} onChange={(e) => setForm({ ...form, cashShortDeduct: e.target.value })} />
              <Input type="number" step="0.01" placeholder="Advance deduction" value={form.advanceDeduct} onChange={(e) => setForm({ ...form, advanceDeduct: e.target.value })} />
              <Input type="number" step="0.01" placeholder="Expense deduction" value={form.expenseDeduct} onChange={(e) => setForm({ ...form, expenseDeduct: e.target.value })} />
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="cash">Pay from Cash</option>
                <option value="bank_transfer">Pay from Bank (UPI/Transfer)</option>
              </select>
              <Input type="date" value={form.paidDate} onChange={(e) => setForm({ ...form, paidDate: e.target.value })} required />
              <Input className="md:col-span-3" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm md:col-span-3">
                Final payable: <span className="font-semibold">{money(finalSalary)}</span>
                {Number(form.baseSalary) > 0 && finalSalary !== Number(form.baseSalary) && (
                  <> | Deductions: <span className="font-semibold text-danger">-{money(Number(form.baseSalary) - finalSalary)}</span></>
                )}
              </div>
              <Button className="md:col-span-3" disabled={create.isPending}>Record Salary Payment</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by staff name, role, month, year, or amount..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {q && (
          <span className="text-sm text-muted-foreground">
            {visible.length} of {salaries.length} records
          </span>
        )}
      </div>
      <DataTable
        columns={['Staff', 'Role', 'Period', 'Base', 'Shortage', 'Advance', 'Expense', 'Final Paid', 'Mode', 'Paid On', 'Note', 'Action']}
        rows={visible.map((s) => [
          s.staff_name,
          <StatusPill key={`${s.id}-role`} value={s.role_name} />,
          `${MONTHS[s.period_month - 1]} ${s.period_year}`,
          money(s.base_salary),
          Number(s.cash_short_deduct) > 0 ? <span key={`${s.id}-cs`} className="text-danger">-{money(s.cash_short_deduct)}</span> : '-',
          Number(s.advance_deduct) > 0 ? <span key={`${s.id}-ad`} className="text-danger">-{money(s.advance_deduct)}</span> : '-',
          Number(s.expense_deduct) > 0 ? <span key={`${s.id}-ex`} className="text-danger">-{money(s.expense_deduct)}</span> : '-',
          <span key={`${s.id}-fin`} className="font-semibold">{money(s.final_salary)}</span>,
          s.mode === 'cash' ? 'Cash' : 'UPI/Bank',
          date(s.paid_at),
          s.note ?? '-',
          can('salary.manage') ? (
            <Button
              key={s.id}
              size="sm"
              variant="danger"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`Delete salary record of ${money(s.final_salary)} for ${s.staff_name}? The amount will be credited back to the account.`)) {
                  remove.mutate(s.id);
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : '-',
        ])}
        empty="No salary payments recorded yet"
      />
    </PageShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
