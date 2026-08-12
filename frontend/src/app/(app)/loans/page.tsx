'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { ArrowUpDown, CheckCircle2, Edit2, History, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { date, dateTime, money } from '@/lib/format';
import { DataTable } from '@/components/app/data-table';
import { PageShell } from '@/components/app/page-shell';
import { Pagination } from '@/components/app/pagination';
import { StatusPill } from '@/components/app/status-pill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Customer { id: string; full_name: string; mobile: string }
interface Loan {
  id: string;
  loan_number: string;
  customer_name: string;
  customer_mobile: string;
  principal: string;
  status: string;
  emi_frequency: string;
  tenure_count: number;
  emi_amount: string;
  loan_date: string;
  total_payable: string;
  remaining: string;
  closing_date: string | null;
  closed_at: string | null;
  waiver_amount: string;
}
interface LoanDetail {
  loan: Loan & { total_payable: string; customer_mobile: string };
  schedule: Array<{
    id: string;
    installment_no: number;
    due_date: string;
    due_amount: string;
    paid_amount: string;
    penalty_amount: string;
    missed_penalty: string;
    status: string;
  }>;
  collections: Array<{
    id: string;
    amount: string;
    penalty: string;
    type: string;
    mode: string;
    collected_at: string;
    agent_name: string | null;
    agent_ledger_id: string | null;
    installment_no: number | null;
    due_date: string | null;
    due_amount: string | null;
    emi_status: string | null;
    missed_penalty: string | null;
  }>;
}

type HistoryCollection = LoanDetail['collections'][number];

const TYPE_LABEL: Record<string, string> = { full: 'Full', partial: 'Partial', advance: 'Advance', missed: 'Missed' };

const SORT_OPTIONS = [
  { value: 'latest', label: 'Latest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'loan_no_asc', label: 'Loan No (Low → High)' },
  { value: 'loan_no_desc', label: 'Loan No (High → Low)' },
  { value: 'name_az', label: 'Name (A → Z)' },
  { value: 'name_za', label: 'Name (Z → A)' },
  { value: 'amount_high', label: 'Loan Amount (High → Low)' },
  { value: 'amount_low', label: 'Loan Amount (Low → High)' },
  { value: 'emi_high', label: 'EMI (High → Low)' },
  { value: 'emi_low', label: 'EMI (Low → High)' },
  { value: 'remaining_high', label: 'Remaining (High → Low)' },
  { value: 'remaining_low', label: 'Remaining (Low → High)' },
  { value: 'closing_soon', label: 'Closing Date (Soonest)' },
  { value: 'closing_late', label: 'Closing Date (Farthest)' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['value'];

const PAGE_SIZE = 25;

// Numeric part of a loan number, so LN-9 sorts before LN-10.
const loanNo = (l: Loan) => Number((l.loan_number.match(/\d+/g) ?? []).join('')) || 0;

function sortLoans(list: Loan[], sort: SortKey): Loan[] {
  const byNum = (fn: (l: Loan) => number, dir: 1 | -1) => (a: Loan, b: Loan) => (fn(a) - fn(b)) * dir;
  const sorted = [...list];
  switch (sort) {
    case 'latest': return sorted.sort(byNum((l) => new Date(l.loan_date).getTime(), -1));
    case 'oldest': return sorted.sort(byNum((l) => new Date(l.loan_date).getTime(), 1));
    case 'loan_no_asc': return sorted.sort(byNum(loanNo, 1));
    case 'loan_no_desc': return sorted.sort(byNum(loanNo, -1));
    case 'name_az': return sorted.sort((a, b) => a.customer_name.localeCompare(b.customer_name));
    case 'name_za': return sorted.sort((a, b) => b.customer_name.localeCompare(a.customer_name));
    case 'amount_high': return sorted.sort(byNum((l) => Number(l.principal), -1));
    case 'amount_low': return sorted.sort(byNum((l) => Number(l.principal), 1));
    case 'emi_high': return sorted.sort(byNum((l) => Number(l.emi_amount), -1));
    case 'emi_low': return sorted.sort(byNum((l) => Number(l.emi_amount), 1));
    case 'remaining_high': return sorted.sort(byNum((l) => Number(l.remaining), -1));
    case 'remaining_low': return sorted.sort(byNum((l) => Number(l.remaining), 1));
    case 'closing_soon': return sorted.sort(byNum((l) => (l.closing_date ? new Date(l.closing_date).getTime() : Infinity), 1));
    case 'closing_late': return sorted.sort(byNum((l) => (l.closing_date ? new Date(l.closing_date).getTime() : -Infinity), -1));
    default: return sorted;
  }
}

export default function LoansPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [form, setForm] = useState({ customerId: '', principal: '', emiFrequency: 'daily', tenureCount: '120', emiAmount: '' });
  const [edit, setEdit] = useState<Loan | null>(null);
  const [editForm, setEditForm] = useState({ principal: '', emiFrequency: 'daily', tenureCount: '120', emiAmount: '' });
  const [historyLoan, setHistoryLoan] = useState<Loan | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const [closingLoan, setClosingLoan] = useState<Loan | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('latest');
  const [page, setPage] = useState(1);
  // Customer picker in the create-loan form: type-to-search instead of a
  // giant <select> (customer list will grow past 1000+).
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const { data: loans = [] } = useQuery({ queryKey: ['loans'], queryFn: () => apiGet<Loan[]>('/loans') });
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => apiGet<Customer[]>('/customers') });
  // Deep-link from the global search: /loans?focus=<id> opens that loan's payment history.
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (focus && loans.length) {
      const loan = loans.find((l) => l.id === focus);
      if (loan) setHistoryLoan(loan);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [loans]);
  // The history card renders above the loans table, so on long lists (and
  // especially on mobile) opening it happens off-screen — scroll it into view.
  useEffect(() => {
    if (historyLoan) historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [historyLoan?.id]);
  const { data: history } = useQuery({
    queryKey: ['loan-detail', historyLoan?.id],
    queryFn: () => apiGet<LoanDetail>(`/loans/${historyLoan!.id}`),
    enabled: !!historyLoan,
  });
  const totalReturn = Number(form.emiAmount || 0) * Number(form.tenureCount || 0);
  const editTotalReturn = Number(editForm.emiAmount || 0) * Number(editForm.tenureCount || 0);
  const create = useMutation({
    mutationFn: () => apiPost('/loans', { ...form, principal: Number(form.principal), tenureCount: Number(form.tenureCount), emiAmount: Number(form.emiAmount) }),
    onSuccess: () => {
      setError(null);
      setShow(false);
      setForm({ customerId: '', principal: '', emiFrequency: 'daily', tenureCount: '120', emiAmount: '' });
      setCustomerQuery('');
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to create loan.');
    },
  });
  const update = useMutation({
    mutationFn: () =>
      apiPut(`/loans/${edit?.id}`, {
        principal: Number(editForm.principal),
        emiFrequency: editForm.emiFrequency,
        tenureCount: Number(editForm.tenureCount),
        emiAmount: Number(editForm.emiAmount),
      }),
    onSuccess: () => {
      setError(null);
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to update loan.');
    },
  });
  const closeLoan = useMutation({
    mutationFn: (input: { id: string; waiver: boolean }) =>
      apiPost<{ status: 'applied' | 'pending' }>(`/loans/${input.id}/close`, { waiver: input.waiver, reason: closeReason || undefined }),
    onSuccess: (res) => {
      setError(null);
      setInfo(res.status === 'pending' ? 'Submitted for admin approval — the loan will close once approved.' : null);
      setClosingLoan(null);
      setCloseReason('');
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to close loan.');
    },
  });
  const removeLoan = useMutation({
    mutationFn: (id: string) => apiDelete(`/loans/${id}`),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to delete loan.');
    },
  });
  const removeCollection = useMutation({
    mutationFn: (id: string) => apiDelete(`/collections/${id}`),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['loan-detail'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['collection-sheet'] });
      qc.invalidateQueries({ queryKey: ['collection-sheet-agents'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to delete collection entry.');
    },
  });
  const [editingCollection, setEditingCollection] = useState<HistoryCollection | null>(null);
  const [collectionForm, setCollectionForm] = useState({ amount: '', penalty: '', type: 'full', collectedDate: '' });
  const updateCollection = useMutation({
    mutationFn: (input: { id: string; body: Record<string, unknown> }) => apiPut(`/collections/${input.id}`, input.body),
    onSuccess: () => {
      setError(null);
      setEditingCollection(null);
      qc.invalidateQueries({ queryKey: ['loan-detail'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['collection-sheet'] });
      qc.invalidateQueries({ queryKey: ['collection-sheet-agents'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to update collection entry.');
    },
  });
  const startEditCollection = (c: HistoryCollection) => {
    setEditingCollection(c);
    setCollectionForm({
      amount: String(Number(c.amount)),
      penalty: String(Number(c.penalty)),
      type: c.type,
      collectedDate: new Date(c.collected_at).toISOString().slice(0, 10),
    });
  };
  const startEdit = (loan: Loan) => {
    setEdit(loan);
    setEditForm({
      principal: String(loan.principal),
      emiFrequency: loan.emi_frequency,
      tenureCount: String(loan.tenure_count),
      emiAmount: String(loan.emi_amount),
    });
  };
  const summary = history ? buildPaymentSummary(history) : null;
  // Type-ahead matches for the customer picker (name or mobile), capped at 20.
  const cq = customerQuery.trim().toLowerCase();
  const customerMatches = cq
    ? customers.filter((c) => c.full_name.toLowerCase().includes(cq) || c.mobile.includes(cq)).slice(0, 20)
    : [];
  const selectedCustomer = customers.find((c) => c.id === form.customerId) ?? null;
  // Search by name, mobile, EMI amount, or loan number — then sort.
  const q = search.trim().toLowerCase();
  const visibleLoans = sortLoans(
    q
      ? loans.filter((l) =>
          l.customer_name.toLowerCase().includes(q) ||
          (l.customer_mobile ?? '').includes(q) ||
          l.loan_number.toLowerCase().includes(q) ||
          String(Number(l.emi_amount)).includes(q) ||
          String(Number(l.principal)).includes(q),
        )
      : loans,
    sort,
  );
  const pageCount = Math.max(1, Math.ceil(visibleLoans.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedLoans = visibleLoans.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  // Jump back to page 1 whenever the filter or sort changes.
  useEffect(() => {
    setPage(1);
  }, [q, sort]);
  return (
    <PageShell title="Loans" description="Create daily, weekly, or monthly loan applications for admin approval." action={<Button onClick={() => setShow((v) => !v)}><Plus className="h-4 w-4" /> Create Loan</Button>}>
      {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {info && <div className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">{info}</div>}
      {show && (
        <Card>
          <CardHeader><CardTitle>New Loan Application</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
              <div className="relative lg:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Type customer name or mobile..."
                  value={selectedCustomer && !customerOpen ? `${selectedCustomer.full_name} - ${selectedCustomer.mobile}` : customerQuery}
                  onFocus={() => setCustomerOpen(true)}
                  onBlur={() => setTimeout(() => setCustomerOpen(false), 150)}
                  onChange={(e) => {
                    setCustomerQuery(e.target.value);
                    setCustomerOpen(true);
                    if (form.customerId) setForm({ ...form, customerId: '' });
                  }}
                  required={!form.customerId}
                />
                {customerOpen && cq && (
                  <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-background shadow-md">
                    {customerMatches.length ? (
                      customerMatches.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setForm({ ...form, customerId: c.id });
                            setCustomerQuery('');
                            setCustomerOpen(false);
                          }}
                        >
                          <span>{c.full_name}</span>
                          <span className="text-xs text-muted-foreground">{c.mobile}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No matching customer</div>
                    )}
                  </div>
                )}
              </div>
              <Input type="number" placeholder="Loan amount" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} required />
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.emiFrequency} onChange={(e) => setForm({ ...form, emiFrequency: e.target.value })}>
                <option value="daily">Daily EMI</option><option value="weekly">Weekly EMI</option><option value="monthly">Monthly EMI</option>
              </select>
              <Input type="number" placeholder={form.emiFrequency === 'daily' ? 'Total days / EMIs' : 'Total EMIs'} value={form.tenureCount} onChange={(e) => setForm({ ...form, tenureCount: e.target.value })} required />
              <Input type="number" placeholder={form.emiFrequency === 'daily' ? 'Per day EMI amount' : 'Per EMI amount'} value={form.emiAmount} onChange={(e) => setForm({ ...form, emiAmount: e.target.value })} required />
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm lg:col-span-6">
                Customer will return: <span className="font-semibold">{money(totalReturn)}</span>
                {Number(form.principal) > 0 && <> | Profit: <span className="font-semibold">{money(totalReturn - Number(form.principal || 0))}</span></>}
              </div>
              <Button className="lg:col-span-6" disabled={create.isPending}>Submit Application</Button>
            </form>
          </CardContent>
        </Card>
      )}
      {edit && (
        <Card>
          <CardHeader><CardTitle>Edit Loan {edit.loan_number}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); update.mutate(); }}>
              <Input type="number" placeholder="Loan amount" value={editForm.principal} onChange={(e) => setEditForm({ ...editForm, principal: e.target.value })} required />
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={editForm.emiFrequency} onChange={(e) => setEditForm({ ...editForm, emiFrequency: e.target.value })}>
                <option value="daily">Daily EMI</option><option value="weekly">Weekly EMI</option><option value="monthly">Monthly EMI</option>
              </select>
              <Input type="number" placeholder={editForm.emiFrequency === 'daily' ? 'Total days / EMIs' : 'Total EMIs'} value={editForm.tenureCount} onChange={(e) => setEditForm({ ...editForm, tenureCount: e.target.value })} required />
              <Input type="number" placeholder={editForm.emiFrequency === 'daily' ? 'Per day EMI amount' : 'Per EMI amount'} value={editForm.emiAmount} onChange={(e) => setEditForm({ ...editForm, emiAmount: e.target.value })} required />
              <div className="flex gap-2">
                <Button disabled={update.isPending}>Save</Button>
                <Button type="button" variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm lg:col-span-5">
                Customer will return: <span className="font-semibold">{money(editTotalReturn)}</span>
                {Number(editForm.principal) > 0 && <> | Profit: <span className="font-semibold">{money(editTotalReturn - Number(editForm.principal || 0))}</span></>}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      {closingLoan && (
        <Card>
          <CardHeader><CardTitle>Close Loan {closingLoan.loan_number}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              Total Payable: <span className="font-semibold">{money(closingLoan.total_payable)}</span>
              {' · '}Remaining Balance: <span className="font-semibold">{money(closingLoan.remaining)}</span>
            </div>
            {Number(closingLoan.remaining) <= 0.01 ? (
              <div className="flex gap-2">
                <Button
                  disabled={closeLoan.isPending}
                  onClick={() => {
                    if (confirm(`Close loan ${closingLoan.loan_number}? This cannot be undone.`)) {
                      closeLoan.mutate({ id: closingLoan.id, waiver: false });
                    }
                  }}
                >
                  Close Loan (Fully Paid)
                </Button>
                <Button type="button" variant="outline" onClick={() => setClosingLoan(null)}>Cancel</Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  This loan still has {money(closingLoan.remaining)} remaining. It can only be closed by applying a
                  waiver for the full remaining balance.
                </p>
                <Input
                  placeholder="Waiver reason (optional)"
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    disabled={closeLoan.isPending}
                    onClick={() => {
                      if (confirm(`Waive ${money(closingLoan.remaining)} and close this loan?`)) {
                        closeLoan.mutate({ id: closingLoan.id, waiver: true });
                      }
                    }}
                  >
                    Close With Waiver ({money(closingLoan.remaining)})
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setClosingLoan(null)}>Cancel</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
      {historyLoan && (
        <div ref={historyRef} className="scroll-mt-16">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span>Payment History - {historyLoan.loan_number}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setHistoryLoan(null)}>Close</Button>
            </CardTitle>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>Customer: <span className="font-medium text-foreground">{historyLoan.customer_name}</span></span>
              <span>Loan Amount: <span className="font-medium text-foreground">{money(historyLoan.principal)}</span></span>
              <span>EMI: <span className="font-medium text-foreground">{money(historyLoan.emi_amount)} ({historyLoan.emi_frequency} x {historyLoan.tenure_count})</span></span>
              <span>Loan Date: <span className="font-medium text-foreground">{date(historyLoan.loan_date)}</span></span>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {history && summary ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
                  <Metric label="Total Payable" value={money(summary.totalPayable)} />
                  <Metric label="Paid" value={money(summary.paid)} />
                  <Metric label="Remaining" value={money(summary.remaining)} />
                  <Metric label="Penalty Added" value={money(summary.penalty)} />
                  <Metric label="On Time" value={String(summary.onTime)} />
                  <Metric label="Delayed" value={String(summary.delayed)} />
                  <Metric label="Missed" value={String(summary.missed)} />
                </div>
                {editingCollection && (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="mb-2 text-sm font-semibold">
                      Edit Entry — {dateTime(editingCollection.collected_at)}
                    </div>
                    <form
                      className="grid gap-3 md:grid-cols-5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const body: Record<string, unknown> = {
                          collectedDate: collectionForm.collectedDate,
                          type: collectionForm.type,
                        };
                        if (collectionForm.type !== 'missed') {
                          body.amount = Number(collectionForm.amount);
                          body.penalty = Number(collectionForm.penalty || 0);
                        } else {
                          body.amount = 0;
                          body.penalty = 0;
                        }
                        updateCollection.mutate({ id: editingCollection.id, body });
                      }}
                    >
                      <select
                        className="h-10 rounded-md border bg-background px-3 text-sm"
                        value={collectionForm.type}
                        onChange={(e) => {
                          const t = e.target.value;
                          setCollectionForm({
                            ...collectionForm,
                            type: t,
                            amount: t === 'missed' ? '0' : collectionForm.amount === '0' ? '' : collectionForm.amount,
                            penalty: t === 'missed' ? '0' : collectionForm.penalty,
                          });
                        }}
                      >
                        <option value="full">Paid (Full)</option>
                        <option value="partial">Paid (Partial)</option>
                        <option value="advance">Paid (Advance)</option>
                        <option value="missed">Missed (₹0)</option>
                      </select>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Amount"
                        value={collectionForm.amount}
                        onChange={(e) => setCollectionForm({ ...collectionForm, amount: e.target.value })}
                        disabled={collectionForm.type === 'missed'}
                        required={collectionForm.type !== 'missed'}
                      />
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Penalty"
                        value={collectionForm.penalty}
                        onChange={(e) => setCollectionForm({ ...collectionForm, penalty: e.target.value })}
                        disabled={collectionForm.type === 'missed'}
                      />
                      <Input
                        type="date"
                        value={collectionForm.collectedDate}
                        onChange={(e) => setCollectionForm({ ...collectionForm, collectedDate: e.target.value })}
                        required
                      />
                      <div className="flex gap-2">
                        <Button disabled={updateCollection.isPending}>Save</Button>
                        <Button type="button" variant="outline" onClick={() => setEditingCollection(null)}>Cancel</Button>
                      </div>
                    </form>
                  </div>
                )}
                <DataTable
                  columns={['Collected On', 'EMI No', 'Due Date', 'Amount', 'Penalty', 'Type', 'Mode', 'Agent', 'Timing', 'Action']}
                  rows={history.collections.map((c) => {
                    const delayed = c.due_date ? new Date(c.collected_at) > endOfDay(c.due_date) : false;
                    return [
                      dateTime(c.collected_at),
                      c.installment_no ?? '-',
                      c.due_date ? date(c.due_date) : '-',
                      money(c.amount),
                      // Missed day entries carry no money — show the penalty
                      // accrued onto the EMI (already added to total payable).
                      c.type === 'missed'
                        ? <span key={`${c.id}-pen`} className="font-medium text-danger">+{money(c.missed_penalty ?? 0)}</span>
                        : money(c.penalty),
                      <StatusPill key={`${c.id}-type`} value={TYPE_LABEL[c.type] ?? c.type} />,
                      c.type === 'missed' ? '-' : c.mode === 'cash' ? 'Cash' : 'UPI/Bank',
                      c.agent_name ?? '-',
                      c.due_date ? (delayed ? 'Delayed' : 'On time') : 'Advance/manual',
                      <div key={c.id} className="flex flex-wrap gap-2">
                        {can('collection.update') && (
                          <Button size="sm" variant="outline" disabled={updateCollection.isPending} onClick={() => startEditCollection(c)}>
                            <Pencil className="h-4 w-4" /> Edit
                          </Button>
                        )}
                        {can('collection.delete') && (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={removeCollection.isPending}
                            onClick={() => {
                              if (confirm(`Delete this collection of ${money(c.amount)}? The loan balance and EMI will be restored.`)) {
                                removeCollection.mutate(c.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" /> Delete
                          </Button>
                        )}
                        {!can('collection.update') && !can('collection.delete') && '-'}
                      </div>,
                    ];
                  })}
                  empty="No collections recorded for this loan"
                />
              </>
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading payment history...</div>
            )}
          </CardContent>
        </Card>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, mobile, EMI, or loan number..."
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
            {visibleLoans.length} of {loans.length} loans
          </span>
        )}
      </div>
      <DataTable
        columns={['Loan No', 'Customer', 'Principal', 'EMI', 'Frequency', 'Status', 'Date', 'Closing Date', 'Action']}
        rows={pagedLoans.map((l) => [
          l.loan_number,
          l.customer_name,
          money(l.principal),
          money(l.emi_amount),
          `${l.emi_frequency} x ${l.tenure_count}`,
          <StatusPill key={l.id} value={l.status} />,
          date(l.loan_date),
          l.status === 'closed'
            ? dateTime(l.closed_at)
            : l.status === 'active'
              ? <span key={`${l.id}-closing`}>{date(l.closing_date)} <span className="text-xs text-muted-foreground">(expected)</span></span>
              : '-',
          <div key={l.id} className="flex flex-wrap gap-2">
            {['active', 'closed'].includes(l.status) && <Button size="sm" variant="outline" onClick={() => setHistoryLoan(l)}><History className="h-4 w-4" /> Payments</Button>}
            {can('loan.update') && <Button size="sm" variant="outline" onClick={() => startEdit(l)}><Edit2 className="h-4 w-4" /> Edit</Button>}
            {can('loan.close') && l.status === 'active' && (
              <Button size="sm" variant="outline" onClick={() => setClosingLoan(l)}><CheckCircle2 className="h-4 w-4" /> Close Loan</Button>
            )}
            {can('loan.delete') && l.status === 'rejected' && (
              <Button
                size="sm"
                variant="danger"
                disabled={removeLoan.isPending}
                onClick={() => {
                  if (confirm(`Delete rejected loan ${l.loan_number}? This cannot be undone.`)) removeLoan.mutate(l.id);
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
          </div>,
        ])}
      />
      <Pagination page={currentPage} pageCount={pageCount} total={visibleLoans.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
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

function endOfDay(value: string) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

function buildPaymentSummary(detail: LoanDetail) {
  // Paid = sum of every collection actually recorded against this loan (matches
  // the backend's remaining-balance enforcement in collection.service.ts), not
  // a per-EMI sum — a per-EMI calculation zeroes out any installment paid
  // extra instead of applying that surplus toward the loan's overall balance.
  const totalPayable = Number(detail.loan.total_payable);
  const paid = detail.collections.reduce((sum, c) => sum + Number(c.amount), 0);
  const remaining = Math.max(0, Number((totalPayable - paid).toFixed(2)));
  const today = endOfDay(new Date().toISOString());
  const missed = detail.schedule.filter((e) => Number(e.paid_amount) < Number(e.due_amount) && endOfDay(e.due_date) < today).length;
  // Total penalty accrued from missed days (already included in total_payable).
  const penalty = detail.schedule.reduce((sum, e) => sum + Number(e.missed_penalty || 0), 0);
  // Zero-amount 'missed' day entries are not payments — keep them out of the timing stats.
  const payments = detail.collections.filter((c) => c.type !== 'missed');
  const onTime = payments.filter((c) => c.due_date && new Date(c.collected_at) <= endOfDay(c.due_date)).length;
  const delayed = payments.filter((c) => c.due_date && new Date(c.collected_at) > endOfDay(c.due_date)).length;
  return { totalPayable, paid, remaining, penalty, missed, onTime, delayed };
}
