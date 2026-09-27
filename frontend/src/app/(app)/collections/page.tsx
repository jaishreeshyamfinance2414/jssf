'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { IndianRupee, Loader2, XCircle } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { date, money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { StatusPill } from '@/components/app/status-pill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Due {
  id: string;
  loan_id: string;
  loan_number: string;
  customer_name: string;
  customer_mobile: string;
  due_date: string;
  due_amount: string;
  collection_due: string;
  status: string;
  today_status: 'pending';
  principal: string;
  total_payable: string;
  start_date: string;
  closing_date: string | null;
  missed_count: number;
  due_till_today: string;
  received: string;
  remaining: string;
}
interface LoanSearchResult {
  id: string;
  loan_number: string;
  principal: string;
  emi_amount: string;
  customer_name: string;
  customer_mobile: string;
  file_number: number;
  guarantor_name: string | null;
  guarantor_mobile: string | null;
  loan_remaining: string;
  next_emi: null | {
    id: string;
    dueDate: string;
    dueAmount: string;
    paidAmount: string;
    remainingAmount: string;
    status: string;
  };
}

const SORT_OPTIONS = [
  { value: 'due_date_asc', label: 'Due date (oldest first)' },
  { value: 'name_asc', label: 'Customer name (A–Z)' },
  { value: 'name_desc', label: 'Customer name (Z–A)' },
  { value: 'loan_number_asc', label: 'Loan number' },
  { value: 'start_date_desc', label: 'Start date (newest first)' },
  { value: 'start_date_asc', label: 'Start date (oldest first)' },
  { value: 'closing_date_asc', label: 'Closing date (earliest first)' },
  { value: 'closing_date_desc', label: 'Closing date (latest first)' },
  { value: 'missed_desc', label: 'Missed EMIs (most first)' },
  { value: 'amount_desc', label: 'Loan amount (high → low)' },
  { value: 'amount_asc', label: 'Loan amount (low → high)' },
  { value: 'due_till_desc', label: 'Due till today (high → low)' },
  { value: 'remaining_desc', label: 'Remaining (high → low)' },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]['value'];

function sortDue(rows: Due[], sort: SortKey): Due[] {
  const byNum = (v: string | number) => Number(v) || 0;
  const byDate = (v: string | null) => (v ? new Date(v).getTime() : 0);
  // Loans with no closing date sink to the bottom in closing-date sorts.
  const cmp: Record<SortKey, (a: Due, b: Due) => number> = {
    due_date_asc: (a, b) => byDate(a.due_date) - byDate(b.due_date),
    name_asc: (a, b) => a.customer_name.localeCompare(b.customer_name),
    name_desc: (a, b) => b.customer_name.localeCompare(a.customer_name),
    loan_number_asc: (a, b) => a.loan_number.localeCompare(b.loan_number, undefined, { numeric: true }),
    start_date_desc: (a, b) => byDate(b.start_date) - byDate(a.start_date),
    start_date_asc: (a, b) => byDate(a.start_date) - byDate(b.start_date),
    closing_date_asc: (a, b) => (a.closing_date ? byDate(a.closing_date) : Infinity) - (b.closing_date ? byDate(b.closing_date) : Infinity),
    closing_date_desc: (a, b) => byDate(b.closing_date) - byDate(a.closing_date),
    missed_desc: (a, b) => b.missed_count - a.missed_count,
    amount_desc: (a, b) => byNum(b.principal) - byNum(a.principal),
    amount_asc: (a, b) => byNum(a.principal) - byNum(b.principal),
    due_till_desc: (a, b) => byNum(b.due_till_today) - byNum(a.due_till_today),
    remaining_desc: (a, b) => byNum(b.remaining) - byNum(a.remaining),
  };
  return [...rows].sort(cmp[sort]);
}

const INDIA_OFFSET = '+05:30';

function indiaNowLocal(): string {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 19);
}

function indiaLocalToIso(value: string): string {
  return new Date(`${value}${INDIA_OFFSET}`).toISOString();
}

export default function CollectionsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [manual, setManual] = useState({ amount: '', mode: 'cash', entryDate: indiaNowLocal() });
  const [search, setSearch] = useState('');
  const [selectedLoan, setSelectedLoan] = useState<LoanSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('due_date_asc');
  const { data: due = [] } = useQuery({ queryKey: ['collections', 'due'], queryFn: () => apiGet<Due[]>('/collections/due') });
  const { data: searchResults = [] } = useQuery({
    queryKey: ['loan-search', search],
    queryFn: () => apiGet<LoanSearchResult[]>(`/loans/search?q=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2 && !selectedLoan,
  });
  const invalidate = () =>
    // Returned (and awaited by the mutation) so the UI stays in its "saving"
    // state until the refetched tables actually arrive — on slow networks the
    // old rows otherwise linger and invite double entries.
    Promise.all([
      qc.invalidateQueries({ queryKey: ['collections'] }),
      qc.invalidateQueries({ queryKey: ['collection-sheet'] }),
      qc.invalidateQueries({ queryKey: ['collection-sheet-agents'] }),
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] }),
      qc.invalidateQueries({ queryKey: ['accounts'] }),
    ]);
  const record = useMutation({
    mutationFn: (body: unknown) => apiPost('/collections', body),
    onSuccess: () => {
      setError(null);
      setManual({ amount: '', mode: 'cash', entryDate: indiaNowLocal() });
      setSearch('');
      setSelectedLoan(null);
      return invalidate();
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to record collection.');
    },
  });
  // The EMI row a record-mutation is currently saving for (drives per-row spinners).
  const pendingEmiId = record.isPending ? (record.variables as { emiId?: string } | undefined)?.emiId : undefined;
  return (
    <PageShell title="Collections" description="Daily EMI collection desk for field agents, with cash/bank posting into business accounts.">
      <Card>
        <CardHeader><CardTitle>Manual Collection</CardTitle></CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedLoan) {
                setError('Search and select a loan account first.');
                return;
              }
              if (manual.mode === 'missed') {
                if (!selectedLoan.next_emi?.id) {
                  setError('This loan has no pending EMI to mark as missed.');
                  return;
                }
                record.mutate({
                  loanId: selectedLoan.id,
                  emiId: selectedLoan.next_emi.id,
                  amount: 0,
                  mode: 'cash',
                  type: 'missed',
                  ...(user?.role === 'admin' ? { entryDate: indiaLocalToIso(manual.entryDate) } : {}),
                });
                return;
              }
              const remaining = Number(selectedLoan.loan_remaining);
              if (Number(manual.amount) > remaining) {
                setError(`Amount exceeds the remaining loan balance. Remaining: ${money(remaining)}.`);
                return;
              }
              record.mutate({
                loanId: selectedLoan.id,
                emiId: selectedLoan.next_emi?.id ?? null,
                amount: Number(manual.amount),
                mode: manual.mode,
                ...(user?.role === 'admin' ? { entryDate: indiaLocalToIso(manual.entryDate) } : {}),
              });
            }}
          >
            <div className="relative">
              <Input
                placeholder="Search by customer name, mobile, loan number, file number, amount, guarantor name or guarantor mobile"
                value={selectedLoan ? `${selectedLoan.loan_number} - ${selectedLoan.customer_name}` : search}
                onChange={(e) => {
                  setSelectedLoan(null);
                  setSearch(e.target.value);
                }}
                required
              />
              {search.trim().length >= 2 && !selectedLoan && (
                <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-md border bg-card shadow-lg">
                  {searchResults.length ? searchResults.map((loan) => (
                    <button
                      type="button"
                      key={loan.id}
                      className="block w-full border-b px-3 py-3 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setSelectedLoan(loan);
                        setManual({
                          ...manual,
                          amount: String(Number(loan.next_emi?.remainingAmount ?? loan.emi_amount)),
                          entryDate: indiaNowLocal(),
                        });
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{loan.customer_name} - {loan.loan_number}</span>
                        <span className="text-muted-foreground">{money(loan.principal)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        File #{loan.file_number} | Mobile: {loan.customer_mobile}
                        {loan.guarantor_name ? ` | Guarantor: ${loan.guarantor_name}` : ''}
                        {loan.guarantor_mobile ? ` (${loan.guarantor_mobile})` : ''}
                      </div>
                      <div className="mt-1 text-xs">
                        Next due: {loan.next_emi ? `${date(loan.next_emi.dueDate)} - ${money(loan.next_emi.remainingAmount)}` : 'No pending EMI'}
                        {' · '}Loan remaining: {money(loan.loan_remaining)}
                      </div>
                    </button>
                  )) : (
                    <div className="px-3 py-4 text-sm text-muted-foreground">No active loan found</div>
                  )}
                </div>
              )}
            </div>
            {selectedLoan && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="font-semibold">{selectedLoan.customer_name} ({selectedLoan.customer_mobile})</div>
                <div className="mt-1 text-muted-foreground">
                  File #{selectedLoan.file_number} | Loan {selectedLoan.loan_number} | Principal {money(selectedLoan.principal)} | EMI {money(selectedLoan.emi_amount)}
                </div>
                {selectedLoan.next_emi && (
                  <div className="mt-1 text-muted-foreground">
                    Next EMI due {date(selectedLoan.next_emi.dueDate)} | Remaining {money(selectedLoan.next_emi.remainingAmount)}
                  </div>
                )}
                <div className="mt-1 font-medium">Loan remaining balance: {money(selectedLoan.loan_remaining)}</div>
              </div>
            )}
            <div className={`grid gap-3 ${user?.role === 'admin' ? 'md:grid-cols-[1fr_180px_230px_auto]' : 'md:grid-cols-[1fr_180px_auto]'}`}>
            <Input
              type="number"
              placeholder={manual.mode === 'missed' ? 'No amount — marking day as missed' : 'Amount'}
              value={manual.mode === 'missed' ? '' : manual.amount}
              onChange={(e) => setManual({ ...manual, amount: e.target.value })}
              max={selectedLoan ? selectedLoan.loan_remaining : undefined}
              disabled={manual.mode === 'missed'}
              required={manual.mode !== 'missed'}
            />
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={manual.mode} onChange={(e) => setManual({ ...manual, mode: e.target.value })}><option value="cash">Cash</option><option value="bank_transfer">UPI/Bank</option><option value="missed">Missed</option></select>
            {user?.role === 'admin' && (
              <label className="relative">
                <span className="absolute -top-2 left-2 z-10 bg-card px-1 text-[10px] font-semibold text-muted-foreground">Entry date &amp; time</span>
                <Input
                  type="datetime-local"
                  step="1"
                  max={indiaNowLocal()}
                  aria-label="Entry date and time"
                  value={manual.entryDate}
                  onChange={(e) => setManual({ ...manual, entryDate: e.target.value })}
                  required
                />
              </label>
            )}
            <Button disabled={record.isPending} variant={manual.mode === 'missed' ? 'danger' : 'default'}>
              {record.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
                : manual.mode === 'missed' ? <><XCircle className="h-4 w-4" /> Mark Missed</>
                : <><IndianRupee className="h-4 w-4" /> Record</>}
            </Button>
            </div>
          </form>
          {error && <div className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        </CardContent>
      </Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Due EMIs</h2>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Sort by
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>
      <DataTable
        columns={['Loan No', 'Customer', 'EMI', "Today's Status", 'EMIs Missed', 'Due Till Today', 'Start Date', 'Closing Date', 'Loan Amount', 'Received', 'Remaining', 'Collect']}
        rows={sortDue(due, sort).map((d) => [
          d.loan_number.slice(-4),
          `${d.customer_name} (${d.customer_mobile})`,
          money(d.due_amount),
          <StatusPill key={d.id} value={d.today_status} />,
          d.missed_count > 0 ? <span key={`${d.id}-miss`} className="font-medium text-danger">{d.missed_count}</span> : '0',
          <span key={`${d.id}-due`} className="font-medium">{money(d.due_till_today)}</span>,
          date(d.start_date),
          d.closing_date ? date(d.closing_date) : '-',
          money(d.principal),
          money(d.received),
          money(d.remaining),
          <div key={`${d.id}-btn`} className="flex flex-wrap gap-2">
            <Button size="sm" disabled={record.isPending} onClick={() => record.mutate({ loanId: d.loan_id, emiId: d.id, amount: Number(d.collection_due), mode: 'cash' })}>
              {pendingEmiId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cash
            </Button>
            <Button size="sm" variant="outline" disabled={record.isPending} onClick={() => record.mutate({ loanId: d.loan_id, emiId: d.id, amount: Number(d.collection_due), mode: 'bank_transfer' })}>
              {pendingEmiId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} UPI/Bank
            </Button>
            {d.status !== 'missed' && (
              <Button
                size="sm"
                variant="danger"
                disabled={record.isPending}
                onClick={() => {
                  if (confirm(`Mark this EMI of ${d.customer_name} as missed for ${date(d.due_date)}?`)) {
                    record.mutate({ loanId: d.loan_id, emiId: d.id, amount: 0, mode: 'cash', type: 'missed' });
                  }
                }}
              >
                <XCircle className="h-4 w-4" /> Missed
              </Button>
            )}
          </div>,
        ])}
        empty="No due EMIs"
      />
    </PageShell>
  );
}
