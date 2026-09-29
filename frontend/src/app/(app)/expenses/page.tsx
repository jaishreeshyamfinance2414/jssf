'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Plus, Receipt } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { date, money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Category { id: string; name: string }
interface User { id: string; full_name: string; role_name: string }
interface Expense {
  id: string;
  category_name: string | null;
  amount: string;
  mode: string;
  expense_date: string;
  description: string;
  created_by_name: string | null;
  user_name: string | null;
}

export default function ExpensesPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    categoryId: '',
    userId: '',
    amount: '',
    mode: 'cash',
    expenseDate: new Date().toISOString().slice(0, 10),
    description: '',
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => apiGet<Category[]>('/expenses/categories'),
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => apiGet<Expense[]>('/expenses'),
  });
  const { data: users = [] } = useQuery({
    queryKey: ['expense-users'],
    queryFn: () => apiGet<User[]>('/expenses/users'),
  });
  const selectedCategory = categories.find((category) => category.id === form.categoryId);
  const isUserExpense = selectedCategory?.name === 'User Expense';
  const create = useMutation({
    mutationFn: () =>
      apiPost('/expenses', {
        ...form,
        categoryId: form.categoryId || null,
        userId: isUserExpense ? form.userId : null,
        amount: Number(form.amount),
      }),
    onSuccess: () => {
      setError(null);
      setForm({
        categoryId: '',
        userId: '',
        amount: '',
        mode: 'cash',
        expenseDate: new Date().toISOString().slice(0, 10),
        description: '',
      });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to add expense.');
    },
  });

  return (
    <PageShell title="Expenses" description="Business expenses, including interest paid on borrowed loans, deducted from cash or bank balance.">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Receipt className="h-4 w-4" /> Add Expense</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value, userId: '' })}>
              <option value="">Category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {isUserExpense && (
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} required>
                <option value="">Select active user</option>
                {users.map((user) => <option key={user.id} value={user.id}>{user.full_name} — {user.role_name}</option>)}
              </select>
            )}
            <Input type="number" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">UPI/Bank</option>
            </select>
            <Input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} required />
            <Input className={isUserExpense ? 'lg:col-span-1' : 'lg:col-span-2'} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            <Button className="lg:col-span-6" disabled={create.isPending}><Plus className="h-4 w-4" /> Add Expense</Button>
          </form>
          {error && <div className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        </CardContent>
      </Card>

      <DataTable
        columns={['Date', 'Category', 'Used By', 'Description', 'Mode', 'Amount', 'Entered By']}
        rows={expenses.map((e) => [
          date(e.expense_date),
          e.category_name ?? '-',
          e.user_name ?? '-',
          e.description,
          e.mode === 'cash' ? 'Cash' : 'UPI/Bank',
          money(e.amount),
          e.created_by_name ?? '-',
        ])}
      />
    </PageShell>
  );
}
