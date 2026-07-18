'use client';

import { useState, Fragment } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { StatusPill } from '@/components/app/status-pill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
  actor_name: string | null;
  actor_mobile: string | null;
}
interface AuditPage { rows: AuditRow[]; total: number; page: number; pageSize: number }
interface Filters { entities: string[]; actions: string[]; actors: Array<{ id: string; full_name: string }> }

const ENTITY_LABEL: Record<string, string> = {
  collection: 'Collection', loan: 'Loan', customer: 'Customer', user: 'User',
  agent_ledger: 'Agent Ledger', emi_schedule: 'EMI Schedule', expense: 'Expense',
  capital: 'Capital', account: 'Account', salary: 'Salary', auth: 'Auth', approval_request: 'Approval Request',
};
const ACTION_TONE: Record<string, string> = {
  DELETE: 'text-danger', REJECT: 'text-danger', UNAPPROVE: 'text-warning',
  APPROVE: 'text-success', CREATE: 'text-success', DISBURSE: 'text-success',
  LOGIN: 'text-muted-foreground', LOGOUT: 'text-muted-foreground',
};

// Meta keys worth showing as a friendly summary line, in priority order.
const META_MONEY = ['amount', 'principal', 'netDisbursal', 'submitted', 'penalty', 'waiverAmount', 'remaining'];
function metaSummary(meta: Record<string, unknown> | null): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (typeof meta.loanNumber === 'string') parts.push(meta.loanNumber);
  for (const k of META_MONEY) {
    const n = Number(meta[k]);
    if (meta[k] != null && Number.isFinite(n) && n !== 0) {
      parts.push(`${k}: ${money(n)}`);
      break; // one money figure is enough for the summary
    }
  }
  if (typeof meta.mode === 'string') parts.push(meta.mode === 'cash' ? 'Cash' : meta.mode === 'bank_transfer' ? 'UPI/Bank' : String(meta.mode));
  if (typeof meta.reason === 'string' && meta.reason) parts.push(`reason: ${meta.reason}`);
  return parts.join(' · ');
}

const EMPTY_FILTERS = { entity: '', action: '', actorId: '', search: '', from: '', to: '' };

export default function AuditPage() {
  const [f, setF] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const qs = new URLSearchParams({ page: String(page) });
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);

  const { data, isFetching } = useQuery({
    queryKey: ['audit', f, page],
    queryFn: () => apiGet<AuditPage>(`/audit?${qs.toString()}`),
    placeholderData: keepPreviousData,
  });
  const { data: filters } = useQuery({
    queryKey: ['audit-filters'],
    queryFn: () => apiGet<Filters>('/audit/filters'),
    staleTime: 60_000,
  });

  const setFilter = (patch: Partial<typeof EMPTY_FILTERS>) => {
    setF((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const selectCls = 'h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-auto';

  return (
    <PageShell title="Audit Logs" description="Trace login, create, approval, disbursement, and collection events.">
      {/* Filters */}
      <div className="grid grid-cols-2 items-end gap-2.5 sm:flex sm:flex-wrap sm:gap-3">
        <label className="col-span-2 text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Search</span>
          <Input
            placeholder="Loan no, name, meta…"
            value={f.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            className="w-full sm:w-52"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Module</span>
          <select className={selectCls} value={f.entity} onChange={(e) => setFilter({ entity: e.target.value })}>
            <option value="">All modules</option>
            {filters?.entities.map((en) => <option key={en} value={en}>{ENTITY_LABEL[en] ?? en}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Action</span>
          <select className={selectCls} value={f.action} onChange={(e) => setFilter({ action: e.target.value })}>
            <option value="">All actions</option>
            {filters?.actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">User</span>
          <select className={selectCls} value={f.actorId} onChange={(e) => setFilter({ actorId: e.target.value })}>
            <option value="">All users</option>
            {filters?.actors.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">From</span>
          <Input type="date" value={f.from} max={f.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} className="w-full sm:w-40" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">To</span>
          <Input type="date" value={f.to} min={f.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} className="w-full sm:w-40" />
        </label>
        <Button variant="outline" onClick={() => { setF(EMPTY_FILTERS); setPage(1); }}>
          <RotateCcw className="h-4 w-4" /> Reset
        </Button>
      </div>

      {/* Mobile: event cards */}
      <div className={`space-y-3 md:hidden ${isFetching ? 'opacity-70' : ''}`}>
        {data?.rows.length ? data.rows.map((r) => (
          <div key={r.id} className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className={`text-sm font-semibold ${ACTION_TONE[r.action] ?? 'text-foreground'}`}>{r.action}</span>
                <span className="ml-2 align-middle"><StatusPill value={ENTITY_LABEL[r.entity] ?? r.entity} /></span>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">{dateTime(r.created_at)}</span>
            </div>
            <div className="mt-2 text-[13px]">
              <span className="font-medium text-foreground">{r.actor_name ?? 'System'}</span>
              {r.actor_mobile && <span className="text-muted-foreground"> · {r.actor_mobile}</span>}
              {r.ip && <span className="text-muted-foreground"> · {r.ip}</span>}
            </div>
            {metaSummary(r.meta) && (
              <p className="mt-1.5 text-xs text-muted-foreground">{metaSummary(r.meta)}</p>
            )}
            {r.meta && (
              <button
                className="mt-2 flex items-center gap-1 text-xs font-medium text-primary"
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              >
                {expanded === r.id ? <>Hide details <ChevronUp className="h-3 w-3" /></> : <>Show details <ChevronDown className="h-3 w-3" /></>}
              </button>
            )}
            {expanded === r.id && r.meta && (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-[11px] text-muted-foreground">
                {JSON.stringify({ entityId: r.entity_id, ...r.meta }, null, 2)}
              </pre>
            )}
          </div>
        )) : (
          <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            No audit events match these filters
          </div>
        )}
      </div>

      {/* Desktop: table */}
      <div className={`hidden overflow-hidden rounded-lg border bg-card md:block ${isFetching ? 'opacity-70' : ''}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Date &amp; Time</th>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Module</th>
                <th className="px-4 py-3 font-semibold">Details</th>
                <th className="px-4 py-3 font-semibold">IP</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {data?.rows.length ? data.rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="border-t">
                    <td className="whitespace-nowrap px-4 py-3">{dateTime(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.actor_name ?? 'System'}</div>
                      {r.actor_mobile && <div className="text-xs text-muted-foreground">{r.actor_mobile}</div>}
                    </td>
                    <td className={`px-4 py-3 font-semibold ${ACTION_TONE[r.action] ?? 'text-foreground'}`}>{r.action}</td>
                    <td className="px-4 py-3"><StatusPill value={ENTITY_LABEL[r.entity] ?? r.entity} /></td>
                    <td className="max-w-[320px] px-4 py-3 text-muted-foreground">
                      <span className="line-clamp-2">{metaSummary(r.meta) || '-'}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{r.ip ?? '-'}</td>
                    <td className="px-4 py-3">
                      {r.meta && (
                        <button
                          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                        >
                          {expanded === r.id ? <>Hide <ChevronUp className="h-3 w-3" /></> : <>Raw <ChevronDown className="h-3 w-3" /></>}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && r.meta && (
                    <tr className="border-t bg-muted/40">
                      <td colSpan={7} className="px-4 py-3">
                        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs text-muted-foreground">
                          {JSON.stringify({ entityId: r.entity_id, ...r.meta }, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )) : (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No audit events match these filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex flex-col items-center justify-between gap-2 text-sm text-muted-foreground sm:flex-row">
          <span>
            Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total} events
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span>Page {data.page} / {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
