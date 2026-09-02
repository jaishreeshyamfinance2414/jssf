'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpDown, CheckCircle2, Clock, Download, History, MapPin, Phone, Users } from 'lucide-react';
import { downloadCollectionPdf } from '@/lib/collection-pdf';
import { apiGet } from '@/lib/api';
import { date, money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';

interface SheetRow {
  loan_id: string;
  loan_number: string;
  customer_name: string;
  customer_mobile: string;
  area_name: string | null;
  principal: string;
  total_payable: string;
  emi_amount: string;
  emi_frequency: string;
  start_date: string;
  closing_date: string | null;
  next_due_date: string | null;
  missed_count: number;
  due_till_today: string;
  advance_count: number;
  advance_amount: string;
  received: string;
  remaining: string;
  today_type: string | null; // full | partial | advance | missed — null when untouched today
  today_mode: string | null;
  today_amount: string | null;
  today_at: string | null;
}

interface AgentTotal { agent_id: string; agent_name: string; collected: string; cash: string; bank: string; entries: number }

const SORT_OPTIONS = [
  { value: 'pending_first', label: 'Pending First' },
  { value: 'done_first', label: 'Done First' },
  { value: 'name_az', label: 'Name (A → Z)' },
  { value: 'name_za', label: 'Name (Z → A)' },
  { value: 'loan_no', label: 'Loan Number' },
  { value: 'area_az', label: 'Area (A → Z)' },
  { value: 'due_till_high', label: 'Due Till Today (High → Low)' },
  { value: 'missed_high', label: 'Missed EMIs (Most First)' },
  { value: 'emi_high', label: 'EMI (High → Low)' },
  { value: 'remaining_high', label: 'Remaining (High → Low)' },
  { value: 'closing_soon', label: 'Closing Date (Soonest)' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['value'];

const isDone = (r: SheetRow) => r.today_type !== null;

const DAY_MS = 86_400_000;
const startOfDay = (v: string) => { const d = new Date(v); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Whole days from the loan start date until today (0 on the start day). */
const daysCompleted = (r: SheetRow) => Math.max(0, Math.floor((startOfDay(new Date().toISOString()) - startOfDay(r.start_date)) / DAY_MS));
/** Whole days left until the expected closing date (0 when reached/passed). */
const daysRemaining = (r: SheetRow) =>
  r.closing_date ? Math.max(0, Math.ceil((startOfDay(r.closing_date) - startOfDay(new Date().toISOString())) / DAY_MS)) : null;

function sortRows(list: SheetRow[], sort: SortKey): SheetRow[] {
  const byNum = (fn: (r: SheetRow) => number, dir: 1 | -1) => (a: SheetRow, b: SheetRow) => (fn(a) - fn(b)) * dir;
  const byName = (a: SheetRow, b: SheetRow) => a.customer_name.localeCompare(b.customer_name);
  const sorted = [...list];
  switch (sort) {
    case 'pending_first': return sorted.sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || byName(a, b));
    case 'done_first': return sorted.sort((a, b) => Number(isDone(b)) - Number(isDone(a)) || byName(a, b));
    case 'name_az': return sorted.sort(byName);
    case 'name_za': return sorted.sort((a, b) => byName(b, a));
    case 'loan_no': return sorted.sort((a, b) => a.loan_number.localeCompare(b.loan_number, undefined, { numeric: true }));
    case 'area_az': return sorted.sort((a, b) => (a.area_name ?? 'zz').localeCompare(b.area_name ?? 'zz'));
    case 'due_till_high': return sorted.sort(byNum((r) => Number(r.due_till_today), -1));
    case 'missed_high': return sorted.sort(byNum((r) => r.missed_count, -1));
    case 'emi_high': return sorted.sort(byNum((r) => Number(r.emi_amount), -1));
    case 'remaining_high': return sorted.sort(byNum((r) => Number(r.remaining), -1));
    case 'closing_soon': return sorted.sort(byNum((r) => (r.closing_date ? new Date(r.closing_date).getTime() : Infinity), 1));
    default: return sorted;
  }
}

function DoneBadge({ row }: { row: SheetRow }) {
  if (!isDone(row)) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning">
        <Clock className="h-3.5 w-3.5" /> Pending
      </span>
    );
  }
  const detail =
    row.today_type === 'missed'
      ? 'Missed'
      : `${money(row.today_amount ?? 0)} ${row.today_mode === 'cash' ? 'Cash' : 'UPI/Bank'}`;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${row.today_type === 'missed' ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'}`}>
        <CheckCircle2 className="h-3.5 w-3.5" /> Done
      </span>
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">{detail}</span>
    </span>
  );
}

const COLUMNS = [
  'Customer', 'Status', 'EMI', 'EMIs Missed', 'Due Till Today', 'Days Completed', 'Days Remaining',
  'Start Date', 'Closing Date', 'Loan Amount', 'Received', 'Remaining', 'Loan No', 'History',
];

export default function CollectionSheetPage() {
  const [sort, setSort] = useState<SortKey>('pending_first');
  const [area, setArea] = useState('all');
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [pdfDate, setPdfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: rows = [] } = useQuery({
    queryKey: ['collection-sheet'],
    queryFn: () => apiGet<SheetRow[]>('/collections/sheet'),
    // Always refetch on arrival + poll: after collecting on /collections the
    // sheet must never show a stale Pending/Done status.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 30_000,
  });
  const { data: agents = [] } = useQuery({
    queryKey: ['collection-sheet-agents'],
    queryFn: () => apiGet<AgentTotal[]>('/collections/sheet/agents'),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 30_000,
  });

  // Areas present in the sheet (from the loaded rows — no extra API call).
  const areas = [...new Set(rows.map((r) => r.area_name).filter((a): a is string => !!a))].sort();
  const areaFiltered =
    area === 'all' ? rows
    : area === 'none' ? rows.filter((r) => !r.area_name)
    : rows.filter((r) => r.area_name === area);
  const visible = sortRows(areaFiltered, sort);

  const pendingCount = areaFiltered.filter((r) => !isDone(r)).length;
  const totalDueToday = areaFiltered.reduce((sum, r) => sum + Number(r.due_till_today), 0);

  return (
    <PageShell
      title="Collection Sheet"
      description="Today's field sheet — every active loan with its collection status, so no EMI is forgotten."
    >
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Total Due Today" value={money(totalDueToday)} />
        <Metric label="Pending" value={String(pendingCount)} tone="warning" />
      </div>
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
        <select
          className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm sm:flex-none"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        >
          <option value="all">All Areas</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          <option value="none">No Area</option>
        </select>
        <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        <select
          className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm sm:flex-none"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {area !== 'all' && (
          <span className="hidden whitespace-nowrap text-sm text-muted-foreground sm:inline">
            {visible.length} of {rows.length} loans
          </span>
        )}
        <button
          onClick={() => setShowPdfModal(true)}
          className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-md border bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Download className="h-4 w-4" /> Download PDF
        </button>
      </div>
      {showPdfModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPdfModal(false)}>
          <div className="rounded-lg border bg-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold">Select Collection Date</h3>
            <input
              type="date"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={pdfDate}
              onChange={(e) => setPdfDate(e.target.value)}
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  const d = new Date(pdfDate);
                  const formatted = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                  downloadCollectionPdf(visible, formatted);
                  setShowPdfModal(false);
                }}
                className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Download
              </button>
              <button
                onClick={() => setShowPdfModal(false)}
                className="flex-1 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Always a horizontally swipeable table — no stacked-card view on mobile,
          so agents scan the sheet like a physical register. */}
      {visible.length ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  {COLUMNS.map((c, i) => (
                    <th
                      key={c}
                      className={`whitespace-nowrap px-4 py-3 font-semibold ${i === 0 ? 'sticky left-0 z-10 bg-muted' : ''}`}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const remainDays = daysRemaining(r);
                  return (
                    <tr key={r.loan_id} className="border-t">
                      <td className="sticky left-0 z-10 max-w-[180px] bg-card px-4 py-3 align-top shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                        {/* tel: link — tapping opens the phone dialer with the number ready */}
                        <a href={`tel:${r.customer_mobile}`} className="block active:opacity-70">
                          <div className="font-medium text-primary underline-offset-2 hover:underline">{r.customer_name}</div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3" /> {r.customer_mobile}
                          </div>
                        </a>
                      </td>
                      <td className="px-4 py-3 align-top"><DoneBadge row={r} /></td>
                      <td className="whitespace-nowrap px-4 py-3 align-top">
                        {money(r.emi_amount)} <span className="text-xs text-muted-foreground">({r.emi_frequency})</span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {r.missed_count > 0 ? <span className="font-medium text-danger">{r.missed_count}</span>
                          : r.advance_count > 0 ? <span className="font-medium text-success">-{r.advance_count}</span>
                          : '0'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top font-medium">
                        {Number(r.due_till_today) <= 0 && Number(r.advance_amount) > 0
                          ? <span className="text-success">-{money(r.advance_amount)}</span>
                          : money(r.due_till_today)}
                      </td>
                      <td className="px-4 py-3 align-top">{daysCompleted(r)}</td>
                      <td className="px-4 py-3 align-top">{remainDays ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-top">{date(r.start_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-top">{r.closing_date ? date(r.closing_date) : '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-top">{money(r.principal)}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-top">{money(r.received)}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-top">{money(r.remaining)}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-top">{r.loan_number}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top">
                        {/* Deep link — /loans?focus=<id> auto-opens this loan's payment history */}
                        <Link
                          href={`/loans?focus=${r.loan_id}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-muted"
                        >
                          <History className="h-3.5 w-3.5" /> Payments
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No active loans
        </div>
      )}
      {/* Today's collections per agent */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" /> Today&apos;s Collection by Agent
        </div>
        {agents.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {agents.map((a) => (
              <div key={a.agent_id} className="rounded-md border bg-muted/30 p-3">
                <div className="truncate text-sm font-medium">{a.agent_name}</div>
                <div className="mt-1 text-lg font-semibold">{money(a.collected)}</div>
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <div className="flex justify-between"><span>Cash</span><span className="font-medium text-foreground">{money(a.cash)}</span></div>
                  <div className="flex justify-between"><span>UPI/Bank</span><span className="font-medium text-foreground">{money(a.bank)}</span></div>
                  <div>{a.entries} collection{a.entries === 1 ? '' : 's'}</div>
                </div>
              </div>
            ))}
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <div className="text-sm font-medium">Total</div>
              <div className="mt-1 text-lg font-semibold">
                {money(agents.reduce((s, a) => s + Number(a.collected), 0))}
              </div>
              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Cash</span><span className="font-medium text-foreground">{money(agents.reduce((s, a) => s + Number(a.cash), 0))}</span></div>
                <div className="flex justify-between"><span>UPI/Bank</span><span className="font-medium text-foreground">{money(agents.reduce((s, a) => s + Number(a.bank), 0))}</span></div>
                <div>{agents.reduce((s, a) => s + a.entries, 0)} collections</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No collections recorded today yet.</div>
        )}
      </div>
    </PageShell>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : ''}`}>{value}</div>
    </div>
  );
}
