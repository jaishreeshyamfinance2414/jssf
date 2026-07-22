'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { ArrowUpDown, Eye, Loader2, Plus, Power, PowerOff, Search, Trash2, Upload } from 'lucide-react';
import { api, apiDelete, apiGet, fetchFileUrl } from '@/lib/api';
import { compressFormImages, compressImageFile } from '@/lib/compress-image';
import { useAuth } from '@/lib/auth-context';
import { date, dateTime, money } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { Pagination } from '@/components/app/pagination';
import { DataTable } from '@/components/app/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Customer { id: string; file_number: number; full_name: string; mobile: string; area_name: string | null; active_loan_count: string; total_loan_count: string; is_active: boolean; created_at: string }
interface Area { id: string; name: string }

const STATUS_FILTERS = [
  { value: 'active', label: 'Active Customers' },
  { value: 'closed_loan', label: 'Closed-Loan Customers' },
  { value: 'deactivated', label: 'Deactivated Customers' },
  { value: 'all', label: 'All Customers' },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

const SORT_OPTIONS = [
  { value: 'latest', label: 'Latest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'file_asc', label: 'File # (Low → High)' },
  { value: 'file_desc', label: 'File # (High → Low)' },
  { value: 'name_az', label: 'Name (A → Z)' },
  { value: 'name_za', label: 'Name (Z → A)' },
  { value: 'loans_high', label: 'Active Loans (High → Low)' },
  { value: 'loans_low', label: 'Active Loans (Low → High)' },
  { value: 'area_az', label: 'Area (A → Z)' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['value'];

const PAGE_SIZE = 25;

// The eight uploadable document slots, in display order. Field names match the
// backend (customer.schema.ts DOCUMENT_FIELDS).
const DOC_FIELDS = [
  ['photo', 'Photo'],
  ['aadhaarDoc', 'Aadhaar'],
  ['panDoc', 'PAN'],
  ['signature', 'Signed Cheque'],
  ['guarantorPhoto', 'Guarantor Photo'],
  ['guarantorAadhaarDoc', 'Guarantor Aadhaar'],
  ['guarantorPanDoc', 'Guarantor PAN'],
  ['guarantorSignature', 'Guarantor Signed Cheque'],
] as const;
type DocField = (typeof DOC_FIELDS)[number][0];

// Documents that are mandatory when creating a customer.
const REQUIRED_DOCS = new Set<DocField>(['photo', 'signature']);

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

function sortCustomers(list: Customer[], sort: SortKey): Customer[] {
  const byNum = (fn: (c: Customer) => number, dir: 1 | -1) => (a: Customer, b: Customer) => (fn(a) - fn(b)) * dir;
  const sorted = [...list];
  switch (sort) {
    case 'latest': return sorted.sort(byNum((c) => new Date(c.created_at).getTime(), -1));
    case 'oldest': return sorted.sort(byNum((c) => new Date(c.created_at).getTime(), 1));
    case 'file_asc': return sorted.sort(byNum((c) => Number(c.file_number), 1));
    case 'file_desc': return sorted.sort(byNum((c) => Number(c.file_number), -1));
    case 'name_az': return sorted.sort((a, b) => a.full_name.localeCompare(b.full_name));
    case 'name_za': return sorted.sort((a, b) => b.full_name.localeCompare(a.full_name));
    case 'loans_high': return sorted.sort(byNum((c) => Number(c.active_loan_count), -1));
    case 'loans_low': return sorted.sort(byNum((c) => Number(c.active_loan_count), 1));
    case 'area_az': return sorted.sort((a, b) => (a.area_name ?? 'zz').localeCompare(b.area_name ?? 'zz'));
    default: return sorted;
  }
}
interface CustomerDetail extends Customer {
  guardian_name: string | null;
  alt_mobile: string | null;
  address: string | null;
  photo_path: string | null;
  aadhaar_no: string | null;
  aadhaar_path: string | null;
  pan_no: string | null;
  pan_path: string | null;
  signature_path: string | null;
  guarantor_name: string | null;
  guarantor_mobile: string | null;
  guarantor_photo_path: string | null;
  guarantor_aadhaar_no: string | null;
  guarantor_aadhaar_path: string | null;
  guarantor_pan_no: string | null;
  guarantor_pan_path: string | null;
  guarantor_signature_path: string | null;
  latitude: string | null;
  longitude: string | null;
  location_accuracy: string | null;
  location_captured_at: string | null;
  loans: Array<{ id: string; loan_number: string; principal: string; status: string; emi_frequency: string; tenure_count: number; loan_date: string }>;
}

export default function CustomersPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [show, setShow] = useState(false);
  // Create form: field -> staged R2 key ("staging/<uuid>.<ext>"). Each document
  // uploads the instant it's attached; these keys are committed on submit and
  // discarded if the form is abandoned.
  const [stagedDocs, setStagedDocs] = useState<Partial<Record<DocField, string>>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [location, setLocation] = useState({ latitude: '', longitude: '', accuracy: '', capturedAt: '', status: 'Location not captured yet' });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('latest');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [page, setPage] = useState(1);
  const { data: customers = [] } = useQuery({
    queryKey: ['customers', status],
    queryFn: () => apiGet<Customer[]>(`/customers?status=${status}`),
  });
  const { data: areas = [] } = useQuery({ queryKey: ['areas'], queryFn: () => apiGet<Area[]>('/areas') });
  // Deep-link from the global search: /customers?focus=<id> opens that customer.
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (focus) {
      setSelectedId(focus);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  const { data: selected } = useQuery({
    queryKey: ['customer-detail', selectedId],
    queryFn: () => apiGet<CustomerDetail>(`/customers/${selectedId}`),
    enabled: !!selectedId,
  });
  // The details card renders above the customer list; on mobile the click
  // leaves the viewport far below it, so scroll the card into view once
  // its data arrives (covers both the Details button and ?focus= deep-links).
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selected?.id]);
  const create = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => api.post('/customers', payload),
    onSuccess: () => {
      // Documents are already committed server-side — clear staging state so the
      // cleanup effect doesn't delete them, then close the form.
      setStagedDocs({});
      setError(null);
      setShow(false);
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to create customer.');
    },
  });

  // Discard staged (un-committed) documents from R2. Called when the create
  // form is abandoned — cancelled, closed, or a document is replaced/removed.
  // Fire-and-forget; a failed cleanup is swept by the R2 staging lifecycle rule.
  const discardStaged = (keys: string[]) => {
    for (const key of keys) {
      api.delete('/customers/staging', { data: { key } }).catch(() => {});
    }
  };
  const update = useMutation({
    mutationFn: (form: FormData) => api.put(`/customers/${selectedId}`, form),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer-detail', selectedId] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to update customer.');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<{ status: 'applied' | 'pending' }>(`/customers/${id}`),
    onSuccess: (res) => {
      setError(null);
      setInfo(res.status === 'pending' ? 'Submitted for admin approval — the customer will be removed once approved.' : null);
      if (res.status === 'applied') setSelectedId(null);
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to delete customer.');
    },
  });

  const setActive = useMutation({
    mutationFn: ({ id, activate }: { id: string; activate: boolean }) =>
      api.post(`/customers/${id}/${activate ? 'activate' : 'deactivate'}`),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer-detail', selectedId] });
    },
    onError: (err) => {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Unable to update customer status.');
    },
  });

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Photo and signature aren't native inputs (they're staged uploads), so
    // enforce them here — the text/select fields are enforced natively.
    if (!stagedDocs.photo || !stagedDocs.signature) {
      setError('Customer photo and signature are required.');
      return;
    }
    // Text fields as JSON; documents were already uploaded to staging and are
    // referenced by key. The server commits the staged keys into permanent
    // storage during create.
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {};
    fd.forEach((value, key) => {
      if (typeof value === 'string') payload[key] = value;
    });
    payload.documents = stagedDocs;
    create.mutate(payload);
  };

  // Close the create form and discard anything staged but not yet saved.
  const closeCreateForm = () => {
    discardStaged(Object.values(stagedDocs).filter(Boolean) as string[]);
    setStagedDocs({});
    setError(null);
    setShow(false);
  };

  const captureLocation = () => {
    // Browsers expose geolocation only on secure origins (https:// or
    // localhost). Over plain http on a LAN IP the permission prompt never
    // appears — surface that instead of a generic "denied" message.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setLocation((v) => ({
        ...v,
        status: 'Location needs a secure connection — open the app via https:// (or localhost) to capture it',
      }));
      return;
    }
    if (!navigator.geolocation) {
      setLocation((v) => ({ ...v, status: 'Location is not supported by this browser' }));
      return;
    }
    setLocation((v) => ({ ...v, status: 'Fetching current location...' }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          latitude: String(pos.coords.latitude),
          longitude: String(pos.coords.longitude),
          accuracy: String(Math.round(pos.coords.accuracy)),
          capturedAt: new Date().toISOString(),
          status: 'Location captured',
        });
      },
      (err) => {
        const status =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — allow location access for this site and retry'
            : err.code === err.TIMEOUT
              ? 'Location request timed out — retry'
              : 'Location unavailable — retry';
        setLocation((v) => ({ ...v, status }));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  useEffect(() => {
    if (show) captureLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Discard staged-but-unsaved documents if the user navigates away from the
  // page entirely (SPA route change / component unmount) without submitting.
  // A hard browser/tab close can't authenticate a cleanup call, so those are
  // swept by the R2 lifecycle rule on the staging/ prefix instead.
  const stagedRef = useRef(stagedDocs);
  stagedRef.current = stagedDocs;
  useEffect(() => {
    return () => {
      const keys = Object.values(stagedRef.current).filter(Boolean) as string[];
      for (const key of keys) api.delete('/customers/staging', { data: { key } }).catch(() => {});
    };
  }, []);

  const submitEdit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    update.mutate(await compressFormImages(new FormData(e.currentTarget)));
  };

  // Search by name, mobile, file number, or area — then sort.
  const q = search.trim().toLowerCase();
  const visibleCustomers = sortCustomers(
    q
      ? customers.filter((c) =>
          c.full_name.toLowerCase().includes(q) ||
          c.mobile.includes(q) ||
          String(c.file_number).includes(q) ||
          (c.area_name ?? '').toLowerCase().includes(q),
        )
      : customers,
    sort,
  );
  const pageCount = Math.max(1, Math.ceil(visibleCustomers.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedCustomers = visibleCustomers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  // Jump back to page 1 whenever the filter, sort, or status changes.
  useEffect(() => {
    setPage(1);
  }, [q, sort, status]);

  return (
    <PageShell
      title="Customers"
      description="Customer KYC, guarantor details, documents, and loan history foundation."
      action={<Button onClick={() => (show ? closeCreateForm() : setShow(true))}><Plus className="h-4 w-4" /> New Customer</Button>}
    >
      {show && (
        <Card>
          <CardHeader><CardTitle>Add Customer & Guarantor</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <Input name="fullName" placeholder="Customer full name *" required />
                <Input name="mobile" placeholder="Mobile *" required />
                <select name="areaId" required defaultValue="" className="h-10 rounded-md border bg-background px-3 text-sm">
                  <option value="" disabled>Select area *</option>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <Input name="guardianName" placeholder="Father / guardian *" required />
                <Input name="altMobile" placeholder="Alternate mobile" />
                <Input name="address" placeholder="Address *" required />
                <Input name="aadhaarNo" placeholder="Aadhaar number" />
                <Input name="panNo" placeholder="PAN number" />
              </div>
              <input type="hidden" name="latitude" value={location.latitude} />
              <input type="hidden" name="longitude" value={location.longitude} />
              <input type="hidden" name="locationAccuracy" value={location.accuracy} />
              <input type="hidden" name="locationCapturedAt" value={location.capturedAt} />
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span>
                  {location.status}
                  {location.latitude && <span className="ml-2 text-muted-foreground">({location.latitude}, {location.longitude})</span>}
                </span>
                {!location.latitude && (
                  <button type="button" onClick={captureLocation} className="text-xs font-semibold text-primary hover:underline">
                    Retry location
                  </button>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Input name="guarantorName" placeholder="Guarantor name" />
                <Input name="guarantorMobile" placeholder="Guarantor mobile" />
                <Input name="guarantorAadhaarNo" placeholder="Guarantor Aadhaar" />
                <Input name="guarantorPanNo" placeholder="Guarantor PAN" />
              </div>
              <div>
                <h4 className="mb-2 text-sm font-semibold">Documents (each uploads as soon as you attach it) — Photo & Signature required</h4>
                <div className="grid gap-3 md:grid-cols-4">
                  {DOC_FIELDS.map(([field, label]) => (
                    <StagedDoc
                      key={field}
                      label={REQUIRED_DOCS.has(field) ? `${label} *` : label}
                      stagedKey={stagedDocs[field]}
                      onStaged={(key) => setStagedDocs((prev) => ({ ...prev, [field]: key }))}
                      onRemoved={(key) => {
                        discardStaged([key]);
                        setStagedDocs((prev) => {
                          const next = { ...prev };
                          delete next[field];
                          return next;
                        });
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button disabled={create.isPending}>Save Customer</Button>
                <Button type="button" variant="outline" onClick={closeCreateForm}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {info && <div className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">{info}</div>}
      {selected && (
        <div ref={detailRef} className="scroll-mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{selected.full_name} <span className="text-sm font-normal text-muted-foreground">(File #{selected.file_number})</span></span>
              <div className="flex gap-2">
                {can('customer.delete') && (() => {
                  const loans = selected.loans ?? [];
                  const hasActiveLoan = loans.some((l) => l.status === 'active');
                  if (!selected.is_active) {
                    return (
                      <Button variant="outline" size="sm" onClick={() => setActive.mutate({ id: selected.id, activate: true })}>
                        <Power className="h-4 w-4" /> Activate
                      </Button>
                    );
                  }
                  if (hasActiveLoan) return null; // protected — has an active loan
                  if (loans.length > 0) {
                    return (
                      <Button variant="outline" size="sm" onClick={() => { if (confirm(`Deactivate customer ${selected.full_name}?`)) setActive.mutate({ id: selected.id, activate: false }); }}>
                        <PowerOff className="h-4 w-4" /> Deactivate
                      </Button>
                    );
                  }
                  return (
                    <Button variant="danger" size="sm" onClick={() => { if (confirm(`Delete customer ${selected.full_name}? This permanently removes them and their documents.`)) remove.mutate(selected.id); }}>
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  );
                })()}
                {can('customer.update') && !editing && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => { setSelectedId(null); setEditing(false); }}>Close</Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              <Info label="File Number" value={String(selected.file_number)} />
              <Info label="Mobile" value={selected.mobile} />
              <Info label="Alternate Mobile" value={selected.alt_mobile} />
              <Info label="Area" value={selected.area_name} />
              <Info label="Father / Guardian" value={selected.guardian_name} />
              <Info label="Address" value={selected.address} />
              <Info label="Created" value={dateTime(selected.created_at)} />
              <Info label="Aadhaar" value={selected.aadhaar_no} />
              <Info label="PAN" value={selected.pan_no} />
              <Info label="Latitude" value={selected.latitude} />
              <Info label="Longitude" value={selected.longitude} />
              <Info label="Location Accuracy" value={selected.location_accuracy ? `${selected.location_accuracy} m` : null} />
              <Info label="Location Captured" value={selected.location_captured_at ? dateTime(selected.location_captured_at) : null} />
            </div>
            {selected.latitude && selected.longitude && (
              <a
                className="inline-flex rounded-md border px-3 py-2 text-sm font-medium text-primary underline"
                href={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`}
                target="_blank"
              >
                Open customer location in Maps
              </a>
            )}
            {editing && (
              <Card>
                <CardHeader><CardTitle>Edit Customer, Guarantor & Documents</CardTitle></CardHeader>
                <CardContent>
                  <form key={selected.id} className="space-y-5" onSubmit={submitEdit}>
                    <div className="grid gap-3 md:grid-cols-3">
                      <Input name="fullName" defaultValue={selected.full_name ?? ''} placeholder="Customer full name" required />
                      <Input name="mobile" defaultValue={selected.mobile ?? ''} placeholder="Mobile" required />
                      <select name="areaId" className="h-10 rounded-md border bg-background px-3 text-sm" defaultValue="">
                        <option value="">Keep current area</option>
                        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <Input name="guardianName" defaultValue={selected.guardian_name ?? ''} placeholder="Father / guardian" />
                      <Input name="altMobile" defaultValue={selected.alt_mobile ?? ''} placeholder="Alternate mobile" />
                      <Input name="address" defaultValue={selected.address ?? ''} placeholder="Address" />
                      <Input name="aadhaarNo" defaultValue={selected.aadhaar_no ?? ''} placeholder="Aadhaar number" />
                      <Input name="panNo" defaultValue={selected.pan_no ?? ''} placeholder="PAN number" />
                      <Input name="latitude" defaultValue={selected.latitude ?? ''} placeholder="Latitude" />
                      <Input name="longitude" defaultValue={selected.longitude ?? ''} placeholder="Longitude" />
                    </div>
                    <input type="hidden" name="locationAccuracy" defaultValue={selected.location_accuracy ?? ''} />
                    <input type="hidden" name="locationCapturedAt" defaultValue={selected.location_captured_at ?? ''} />
                    <div className="grid gap-3 md:grid-cols-3">
                      <Input name="guarantorName" defaultValue={selected.guarantor_name ?? ''} placeholder="Guarantor name" />
                      <Input name="guarantorMobile" defaultValue={selected.guarantor_mobile ?? ''} placeholder="Guarantor mobile" />
                      <Input name="guarantorAadhaarNo" defaultValue={selected.guarantor_aadhaar_no ?? ''} placeholder="Guarantor Aadhaar" />
                      <Input name="guarantorPanNo" defaultValue={selected.guarantor_pan_no ?? ''} placeholder="Guarantor PAN" />
                    </div>
                    <div>
                      <h4 className="mb-2 text-sm font-semibold">Documents (leave blank to keep existing)</h4>
                      <div className="grid gap-3 md:grid-cols-4">
                        {([
                          ['photo', 'Photo', selected.photo_path],
                          ['aadhaarDoc', 'Aadhaar', selected.aadhaar_path],
                          ['panDoc', 'PAN', selected.pan_path],
                          ['signature', 'Signature', selected.signature_path],
                          ['guarantorPhoto', 'Guarantor Photo', selected.guarantor_photo_path],
                          ['guarantorAadhaarDoc', 'Guarantor Aadhaar', selected.guarantor_aadhaar_path],
                          ['guarantorPanDoc', 'Guarantor PAN', selected.guarantor_pan_path],
                          ['guarantorSignature', 'Guarantor Signature', selected.guarantor_signature_path],
                        ] as const).map(([field, label, path]) => (
                          <div key={field} className="space-y-2">
                            <Doc label={label} path={path} />
                            <label className="flex items-center gap-2 rounded-md border bg-muted/40 p-2 text-xs font-medium">
                              <Upload className="h-3.5 w-3.5" />
                              <input name={field} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="w-full text-xs" />
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button disabled={update.isPending}>Save Changes</Button>
                      <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Guarantor</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <Info label="Name" value={selected.guarantor_name} />
                <Info label="Mobile" value={selected.guarantor_mobile} />
                <Info label="Aadhaar" value={selected.guarantor_aadhaar_no} />
                <Info label="PAN" value={selected.guarantor_pan_no} />
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Documents</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <Doc label="Photo" path={selected.photo_path} />
                <Doc label="Aadhaar" path={selected.aadhaar_path} />
                <Doc label="PAN" path={selected.pan_path} />
                <Doc label="Signature" path={selected.signature_path} />
                <Doc label="Guarantor Photo" path={selected.guarantor_photo_path} />
                <Doc label="Guarantor Aadhaar" path={selected.guarantor_aadhaar_path} />
                <Doc label="Guarantor PAN" path={selected.guarantor_pan_path} />
                <Doc label="Guarantor Signature" path={selected.guarantor_signature_path} />
              </div>
            </div>
            <DataTable
              columns={['Loan No', 'Amount', 'Frequency', 'Status', 'Date']}
              rows={selected.loans.map((l) => [l.loan_number, money(l.principal), `${l.emi_frequency} x ${l.tenure_count}`, l.status, date(l.loan_date)])}
              empty="No loans for this customer"
            />
          </CardContent>
        </Card>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, mobile, file number, or area..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <select
            className="h-10 flex-1 rounded-md border bg-background px-3 text-sm sm:flex-none"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            {STATUS_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex flex-1 items-center gap-2 sm:flex-none">
            <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-auto"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        {q && (
          <span className="text-sm text-muted-foreground">
            {visibleCustomers.length} of {customers.length} customers
          </span>
        )}
      </div>
      <DataTable
        columns={['File #', 'Customer', 'Mobile', 'Area', 'Active Loans', 'Status', 'Created', 'Action']}
        rows={pagedCustomers.map((c) => {
          const hasLoans = Number(c.total_loan_count) > 0;
          const hasActiveLoan = Number(c.active_loan_count) > 0;
          return [
            c.file_number,
            <span key={c.id} className={c.is_active ? '' : 'text-muted-foreground'}>{c.full_name}</span>,
            c.mobile,
            c.area_name ?? '-',
            c.active_loan_count,
            c.is_active
              ? <span className="text-success">Active</span>
              : <span className="text-muted-foreground">Deactivated</span>,
            dateTime(c.created_at),
            <div key={c.id} className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { setSelectedId(c.id); setEditing(false); }}><Eye className="h-4 w-4" /> Details</Button>
              {can('customer.delete') && (
                !c.is_active ? (
                  // Deactivated → allow reactivation.
                  <Button size="sm" variant="outline" onClick={() => setActive.mutate({ id: c.id, activate: true })}>
                    <Power className="h-4 w-4" /> Activate
                  </Button>
                ) : hasActiveLoan ? null : hasLoans ? (
                  // Loan history but nothing active → deactivate (soft delete).
                  <Button size="sm" variant="outline" onClick={() => { if (confirm(`Deactivate customer ${c.full_name}?`)) setActive.mutate({ id: c.id, activate: false }); }}>
                    <PowerOff className="h-4 w-4" /> Deactivate
                  </Button>
                ) : (
                  // Never had a loan → safe to hard delete.
                  <Button size="sm" variant="danger" onClick={() => { if (confirm(`Delete customer ${c.full_name}? This permanently removes them and their documents.`)) remove.mutate(c.id); }}>
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                )
              )}
            </div>,
          ];
        })}
      />
      <Pagination page={currentPage} pageCount={pageCount} total={visibleCustomers.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </PageShell>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value || '-'}</div>
    </div>
  );
}

/**
 * One document slot on the create form. On file selection it compresses (images
 * only) and uploads immediately to the staging area, showing a spinner then a
 * preview. Remove discards the staged object. The parent holds the staging key.
 */
function StagedDoc({
  label,
  stagedKey,
  onStaged,
  onRemoved,
}: {
  label: string;
  stagedKey: string | undefined;
  onStaged: (key: string) => void;
  onRemoved: (key: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      // Replacing an existing attachment — discard the previous staged object.
      if (stagedKey) onRemoved(stagedKey);
      const prepared = await compressImageFile(file);
      const fd = new FormData();
      fd.append('file', prepared);
      const { data } = await api.post<{ data: { key: string } }>('/customers/staging', fd);
      onStaged(data.data.key);
      setFileName(file.name);
    } catch (err) {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Upload failed');
      if (inputRef.current) inputRef.current.value = '';
    } finally {
      setUploading(false);
    }
  };

  const remove = () => {
    if (stagedKey) onRemoved(stagedKey);
    setFileName(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs font-medium">
      <span className="mb-2 flex items-center gap-2"><Upload className="h-3.5 w-3.5" /> {label}</span>
      {stagedKey ? (
        <div className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5">
          <span className="truncate text-primary" title={fileName ?? undefined}>✓ {fileName ?? 'Uploaded'}</span>
          <button type="button" onClick={remove} className="shrink-0 text-danger hover:underline">Remove</button>
        </div>
      ) : uploading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</div>
      ) : (
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="w-full text-xs"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      )}
      {error && <div className="mt-1 text-danger">{error}</div>}
    </div>
  );
}

function Doc({ label, path }: { label: string; path: string | null | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!path) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchFileUrl(path)
      .then((u) => {
        if (cancelled) URL.revokeObjectURL(u);
        else {
          objectUrl = u;
          setUrl(u);
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!path) {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <div className="font-medium">{label}</div>
        <div className="mt-1 text-muted-foreground">Not uploaded</div>
      </div>
    );
  }
  const isPdf = path.toLowerCase().endsWith('.pdf');
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {url && (
          <a className="text-xs text-primary underline" href={url} target="_blank" rel="noopener noreferrer">
            Open
          </a>
        )}
      </div>
      {failed ? (
        <div className="text-muted-foreground">Failed to load</div>
      ) : !url ? (
        <div className="h-32 w-full animate-pulse rounded border bg-muted" />
      ) : isPdf ? (
        <iframe src={url} className="h-32 w-full rounded border bg-white" title={label} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-32 w-full rounded border object-contain" />
      )}
    </div>
  );
}
