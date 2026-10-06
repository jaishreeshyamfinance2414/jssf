'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { BellRing, Check, Plus } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { date, money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Customer { id: string; file_number: number; full_name: string; mobile: string }
interface Reminder {
  id: string;
  customer_name: string;
  customer_mobile: string;
  reminder_date: string;
  amount: string;
  note: string;
  status: 'pending' | 'completed';
  created_by_name: string;
}

interface ApiErrorBody { error?: { message?: string; details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> } } }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const errorMessage = (error: unknown) => {
  const apiError = (error as AxiosError<ApiErrorBody>).response?.data?.error;
  const details = [...(apiError?.details?.formErrors ?? []), ...Object.values(apiError?.details?.fieldErrors ?? {}).flat()];
  return details.length ? [...new Set(details)].join(' · ') : apiError?.message ?? 'Unable to save reminder.';
};

export default function RemindersPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ customerId: '', reminderDate: today(), amount: '', note: '' });
  const { data: customers = [] } = useQuery({
    queryKey: ['reminder-customers'],
    queryFn: () => apiGet<Customer[]>('/customers?status=active'),
  });
  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ['reminders'],
    queryFn: () => apiGet<Reminder[]>('/reminders'),
  });
  const create = useMutation({
    mutationFn: () => apiPost('/reminders', { ...form, amount: Number(form.amount) }),
    onSuccess: () => {
      setError(null);
      setForm({ customerId: '', reminderDate: today(), amount: '', note: '' });
      qc.invalidateQueries({ queryKey: ['reminders'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const complete = useMutation({
    mutationFn: (id: string) => apiPost(`/reminders/${id}/complete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <PageShell title="Set Reminders" description="Record customer payment promises. Pending reminders appear in the dashboard notification bell on their due date and remain there until completed.">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><BellRing className="h-4 w-4" /> Add Payment Reminder</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2 lg:grid-cols-6" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
            <select className="h-10 rounded-md border bg-background px-3 text-sm lg:col-span-2" value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })} required>
              <option value="">Select customer</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>#{customer.file_number} · {customer.full_name} · {customer.mobile}</option>)}
            </select>
            <Input type="date" min={today()} value={form.reminderDate} onChange={(event) => setForm({ ...form, reminderDate: event.target.value })} required />
            <Input type="number" min="0.01" step="0.01" placeholder="Promised amount" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required />
            <Input className="lg:col-span-2" maxLength={500} placeholder="Reminder note" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} required />
            <Button className="lg:col-span-6" disabled={create.isPending}><Plus className="h-4 w-4" /> {create.isPending ? 'Adding…' : 'Add Reminder'}</Button>
          </form>
          {error && <div className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        </CardContent>
      </Card>

      <DataTable
        columns={['Due Date', 'Customer', 'Mobile', 'Amount', 'Note', 'Set By', 'Status', 'Action']}
        empty={isLoading ? 'Loading reminders…' : 'No reminders set yet.'}
        mobilePrimary={[0, 1]}
        rowClassNames={reminders.map((reminder) => reminder.status === 'completed' ? 'opacity-60' : '')}
        rows={reminders.map((reminder) => [
          date(reminder.reminder_date),
          reminder.customer_name,
          reminder.customer_mobile,
          money(reminder.amount),
          reminder.note,
          reminder.created_by_name,
          <span key="status" className={`rounded-full px-2 py-1 text-xs font-semibold ${reminder.status === 'pending' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>{reminder.status === 'pending' ? 'Pending' : 'Completed'}</span>,
          reminder.status === 'pending' ? <Button key="complete" size="sm" variant="outline" disabled={complete.isPending} onClick={() => complete.mutate(reminder.id)}><Check className="h-4 w-4" /> Complete</Button> : '-',
        ])}
      />
    </PageShell>
  );
}
