'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, TrendingUp, CalendarDays, AlertTriangle, User, Users, Landmark, FileText } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { date, dateTime, money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { StatusPill } from '@/components/app/status-pill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// ── Types matching backend /reports responses ────────────────────────────────
interface ProfitLoss {
  from: string; to: string;
  collected: number; penaltyIncome: number; disbursed: number;
  interestBooked: number; expenses: number; salaries: number; capitalIn: number;
}
interface DailyRow { date: string; entries: string; missed_entries: string; cash: string; digital: string; penalty: string; total: string }
interface MissedRow { loan_number: string; customer_name: string; mobile: string; area: string; missed_count: string; oldest_due: string; overdue_amount: string; penalty: string; loan_remaining: string }
interface AgentRow { agent_id: string; agent: string; entries: string; loans_touched: string; missed_marked: string; cash: string; digital: string; total: string; short_amount: string }
interface AccountLedger {
  transactions: Array<{ date: string; created_at: string; account: string; account_type: string; direction: string; amount: string; source: string; description: string | null; created_by: string | null }>;
  balances: Array<{ name: string; type: string; balance: string }>;
}
interface CustomerLite { id: string; file_number: number; full_name: string; mobile: string }
interface CustomerLedger {
  customer: { id: string; file_number: number; full_name: string; mobile: string; area: string } | null;
  loans: Array<{ id: string; loan_number: string; principal: string; total_payable: string; status: string; loan_date: string; emi_amount: string; emi_frequency: string; tenure_count: number; paid: string; remaining: string }>;
  entries: Array<{ collected_at: string; loan_number: string; amount: string; penalty: string; type: string; mode: string; agent_name: string | null }>;
}

const TABS = [
  { key: 'profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { key: 'daily-collection', label: 'Daily Collection', icon: CalendarDays },
  { key: 'missed-emi', label: 'Missed EMI', icon: AlertTriangle },
  { key: 'customer-ledger', label: 'Customer Ledger', icon: User },
  { key: 'agent-performance', label: 'Agent Performance', icon: Users },
  { key: 'account-ledger', label: 'Cash/Bank Ledger', icon: Landmark },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const TYPE_LABEL: Record<string, string> = { full: 'Full', partial: 'Partial', advance: 'Advance', missed: 'Missed' };
const SOURCE_LABEL: Record<string, string> = {
  capital: 'Capital', collection: 'Collection', agent_submission: 'Agent Handover',
  loan_disbursement: 'Disbursement', expense: 'Expense', salary: 'Salary', adjustment: 'Adjustment',
};

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + '01';

/** Download rows as a CSV file. */
function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone ?? 'text-foreground'}`}>{value}</div>
    </div>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<TabKey>('profit-loss');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [customerId, setCustomerId] = useState('');
  // Customer ledger: which loan's statement is shown ('' = all loans combined).
  const [statementLoan, setStatementLoan] = useState('');

  const rangeQs = `?from=${from}&to=${to}`;
  const dateFiltered = tab !== 'missed-emi' && tab !== 'customer-ledger';

  const { data: pl } = useQuery({
    queryKey: ['report', 'profit-loss', from, to],
    queryFn: () => apiGet<ProfitLoss>(`/reports/profit-loss${rangeQs}`),
    enabled: tab === 'profit-loss',
  });
  const { data: daily = [] } = useQuery({
    queryKey: ['report', 'daily-collection', from, to],
    queryFn: () => apiGet<DailyRow[]>(`/reports/daily-collection${rangeQs}`),
    enabled: tab === 'daily-collection',
  });
  const { data: missed = [] } = useQuery({
    queryKey: ['report', 'missed-emi'],
    queryFn: () => apiGet<MissedRow[]>('/reports/missed-emi'),
    enabled: tab === 'missed-emi',
  });
  const { data: agents = [] } = useQuery({
    queryKey: ['report', 'agent-performance', from, to],
    queryFn: () => apiGet<AgentRow[]>(`/reports/agent-performance${rangeQs}`),
    enabled: tab === 'agent-performance',
  });
  const { data: accounts } = useQuery({
    queryKey: ['report', 'account-ledger', from, to],
    queryFn: () => apiGet<AccountLedger>(`/reports/account-ledger${rangeQs}`),
    enabled: tab === 'account-ledger',
  });
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => apiGet<CustomerLite[]>('/customers'),
    enabled: tab === 'customer-ledger',
  });
  const { data: ledger } = useQuery({
    queryKey: ['report', 'customer-ledger', customerId],
    queryFn: () => apiGet<CustomerLedger>(`/reports/customer-ledger?customerId=${customerId}`),
    enabled: tab === 'customer-ledger' && !!customerId,
  });

  // Net position for P&L: money earned (interest + fees + penalties) minus operating outgo.
  const plNet = useMemo(() => (pl ? pl.interestBooked + pl.penaltyIncome - pl.expenses - pl.salaries : 0), [pl]);

  const onExport = () => {
    const stamp = `${from}_to_${to}`;
    if (tab === 'profit-loss' && pl) {
      exportCsv(`profit-loss_${stamp}.csv`, ['Metric', 'Amount'], [
        ['Collections received', pl.collected],
        ['Penalty income', pl.penaltyIncome],
        ['Interest + fees booked', pl.interestBooked],
        ['Loans disbursed', pl.disbursed],
        ['Expenses', pl.expenses],
        ['Salaries paid', pl.salaries],
        ['Capital introduced', pl.capitalIn],
        ['Net (interest + penalty - expenses - salaries)', plNet],
      ]);
    } else if (tab === 'daily-collection') {
      exportCsv(`daily-collection_${stamp}.csv`,
        ['Date', 'Entries', 'Missed', 'Cash', 'UPI/Bank', 'Penalty', 'Total'],
        daily.map((d) => [d.date, d.entries, d.missed_entries, d.cash, d.digital, d.penalty, d.total]));
    } else if (tab === 'missed-emi') {
      exportCsv(`missed-emi_${today()}.csv`,
        ['Loan No', 'Customer', 'Mobile', 'Area', 'Missed EMIs', 'Oldest Due', 'Overdue Amount', 'Penalty', 'Loan Remaining'],
        missed.map((m) => [m.loan_number, m.customer_name, m.mobile, m.area, m.missed_count, m.oldest_due, m.overdue_amount, m.penalty, m.loan_remaining]));
    } else if (tab === 'customer-ledger' && ledger?.customer) {
      const name = ledger.customer.full_name.replace(/\s+/g, '_');
      exportCsv(statementLoan ? `statement_${statementLoan}_${name}.csv` : `customer-ledger_${name}.csv`,
        ['Date & Time', 'Loan', 'Amount', 'Penalty', 'Type', 'Mode', 'Agent'],
        ledger.entries
          .filter((e) => !statementLoan || e.loan_number === statementLoan)
          .map((e) => [dateTime(e.collected_at), e.loan_number, e.amount, e.penalty, e.type, e.mode, e.agent_name ?? '']));
    } else if (tab === 'agent-performance') {
      exportCsv(`agent-performance_${stamp}.csv`,
        ['Agent', 'Entries', 'Loans Touched', 'Missed Marked', 'Cash', 'UPI/Bank', 'Total', 'Shortage'],
        agents.map((a) => [a.agent, a.entries, a.loans_touched, a.missed_marked, a.cash, a.digital, a.total, a.short_amount]));
    } else if (tab === 'account-ledger' && accounts) {
      exportCsv(`account-ledger_${stamp}.csv`,
        ['Date', 'Account', 'Type', 'Direction', 'Amount', 'Source', 'Description', 'By'],
        accounts.transactions.map((t) => [t.date, t.account, t.account_type, t.direction, t.amount, SOURCE_LABEL[t.source] ?? t.source, t.description ?? '', t.created_by ?? '']));
    }
  };

  return (
    <PageShell title="Reports" description="Operational and financial reports for the finance company.">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Filters + export */}
      <div className="grid grid-cols-2 items-end gap-2.5 sm:flex sm:flex-wrap sm:gap-3">
        {dateFiltered && (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">From</span>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-40" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">To</span>
              <Input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-40" />
            </label>
          </>
        )}
        {tab === 'customer-ledger' && (
          <label className="col-span-2 text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Customer</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-72"
              value={customerId}
              onChange={(e) => { setCustomerId(e.target.value); setStatementLoan(''); }}
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name} — {c.mobile} (File #{c.file_number})</option>
              ))}
            </select>
          </label>
        )}
        <Button variant="outline" onClick={onExport} className="col-span-2 sm:col-span-1">
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* ── Profit & Loss ── */}
      {tab === 'profit-loss' && pl && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Collections Received" value={money(pl.collected)} tone="text-success" />
            <Stat label="Penalty Income" value={money(pl.penaltyIncome)} tone="text-success" />
            <Stat label="Interest + Fees Booked" value={money(pl.interestBooked)} tone="text-success" />
            <Stat label="Capital Introduced" value={money(pl.capitalIn)} />
            <Stat label="Loans Disbursed" value={money(pl.disbursed)} />
            <Stat label="Expenses" value={money(pl.expenses)} tone="text-danger" />
            <Stat label="Salaries Paid" value={money(pl.salaries)} tone="text-danger" />
            <Stat label="Net (Income − Outgo)" value={money(plNet)} tone={plNet >= 0 ? 'text-success' : 'text-danger'} />
          </div>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> How this is computed</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Net = interest &amp; processing fees booked on loans disbursed in the period + penalty collected − expenses − salaries.
              Collections and disbursements move cash but are principal flows, not profit.
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Daily Collection ── */}
      {tab === 'daily-collection' && (
        <DataTable
          columns={['Date', 'Entries', 'Missed', 'Cash', 'UPI/Bank', 'Penalty', 'Total']}
          rows={daily.map((d) => [
            date(d.date),
            d.entries,
            Number(d.missed_entries) > 0 ? <span key={d.date} className="font-medium text-danger">{d.missed_entries}</span> : '0',
            money(d.cash),
            money(d.digital),
            money(d.penalty),
            <span key={`${d.date}-t`} className="font-semibold">{money(d.total)}</span>,
          ])}
          empty="No collections in this period"
        />
      )}

      {/* ── Missed EMI ── */}
      {tab === 'missed-emi' && (
        <DataTable
          columns={['Loan No', 'Customer', 'Area', 'Missed EMIs', 'Oldest Due', 'Overdue Amount', 'Penalty', 'Loan Remaining']}
          rows={missed.map((m) => [
            m.loan_number,
            `${m.customer_name} (${m.mobile})`,
            m.area,
            <span key={m.loan_number} className="font-medium text-danger">{m.missed_count}</span>,
            date(m.oldest_due),
            <span key={`${m.loan_number}-o`} className="font-medium">{money(m.overdue_amount)}</span>,
            money(m.penalty),
            money(m.loan_remaining),
          ])}
          empty="No overdue EMIs — all caught up"
        />
      )}

      {/* ── Customer Ledger ── */}
      {tab === 'customer-ledger' && !customerId && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Select a customer above to view their full ledger.</CardContent></Card>
      )}
      {tab === 'customer-ledger' && ledger?.customer && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>{ledger.customer.full_name} — File #{ledger.customer.file_number}</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {ledger.customer.mobile} · {ledger.customer.area}
            </CardContent>
          </Card>
          <DataTable
            columns={['Loan No', 'Date', 'Principal', 'Total Payable', 'EMI', 'Paid', 'Remaining', 'Status', 'Statement']}
            rows={ledger.loans.map((l) => [
              l.loan_number,
              date(l.loan_date),
              money(l.principal),
              money(l.total_payable),
              <span key={l.id}>{money(l.emi_amount)} <span className="text-xs text-muted-foreground">× {l.tenure_count} {l.emi_frequency}</span></span>,
              money(l.paid),
              money(l.remaining),
              <StatusPill key={`${l.id}-s`} value={l.status} />,
              statementLoan === l.loan_number ? (
                <Button key={`${l.id}-b`} size="sm" onClick={() => setStatementLoan('')}>
                  <FileText className="h-4 w-4" /> Showing
                </Button>
              ) : (
                <Button key={`${l.id}-b`} size="sm" variant="outline" onClick={() => setStatementLoan(l.loan_number)}>
                  <FileText className="h-4 w-4" /> View Statement
                </Button>
              ),
            ])}
            empty="No loans for this customer"
          />
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {statementLoan ? `Statement — Loan ${statementLoan}` : 'Statement — All Loans'}
            </h2>
            {statementLoan && (
              <Button size="sm" variant="outline" onClick={() => setStatementLoan('')}>Show all loans</Button>
            )}
          </div>
          <DataTable
            columns={['Date & Time', 'Loan', 'Amount', 'Penalty', 'Type', 'Mode', 'Agent']}
            rows={ledger.entries
              .filter((e) => !statementLoan || e.loan_number === statementLoan)
              .map((e, i) => [
                dateTime(e.collected_at),
                e.loan_number,
                money(e.amount),
                money(e.penalty),
                <StatusPill key={i} value={TYPE_LABEL[e.type] ?? e.type} />,
                e.type === 'missed' ? '-' : e.mode === 'cash' ? 'Cash' : 'UPI/Bank',
                e.agent_name ?? '-',
              ])}
            empty={statementLoan ? `No payment entries for ${statementLoan}` : 'No payment entries yet'}
          />
        </div>
      )}

      {/* ── Agent Performance ── */}
      {tab === 'agent-performance' && (
        <DataTable
          columns={['Agent', 'Entries', 'Loans Touched', 'Missed Marked', 'Cash', 'UPI/Bank', 'Total Collected', 'Shortage']}
          rows={agents.map((a) => [
            a.agent,
            a.entries,
            a.loans_touched,
            Number(a.missed_marked) > 0 ? <span key={a.agent_id} className="text-danger">{a.missed_marked}</span> : '0',
            money(a.cash),
            money(a.digital),
            <span key={`${a.agent_id}-t`} className="font-semibold">{money(a.total)}</span>,
            Number(a.short_amount) > 0 ? <span key={`${a.agent_id}-s`} className="font-medium text-danger">{money(a.short_amount)}</span> : '-',
          ])}
          empty="No agent collections in this period"
        />
      )}

      {/* ── Cash/Bank Ledger ── */}
      {tab === 'account-ledger' && accounts && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {accounts.balances.map((b) => (
              <Stat key={b.name} label={`${b.name} (${b.type === 'cash' ? 'Cash' : 'Bank'}) — current balance`} value={money(b.balance)} />
            ))}
          </div>
          <DataTable
            columns={['Date', 'Account', 'Direction', 'Amount', 'Source', 'Description', 'By']}
            rows={accounts.transactions.map((t, i) => [
              date(t.date),
              `${t.account} (${t.account_type === 'cash' ? 'Cash' : 'Bank'})`,
              t.direction === 'credit'
                ? <span key={i} className="font-medium text-success">Credit</span>
                : <span key={i} className="font-medium text-danger">Debit</span>,
              money(t.amount),
              SOURCE_LABEL[t.source] ?? t.source,
              t.description ?? '-',
              t.created_by ?? '-',
            ])}
            empty="No account transactions in this period"
          />
        </div>
      )}
    </PageShell>
  );
}
