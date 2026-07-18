'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, Users, HandCoins } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { date, money } from '@/lib/format';

interface CustomerHit {
  id: string;
  file_number: number;
  full_name: string;
  mobile: string;
  area_name: string | null;
  active_loan_count: string;
}

interface LoanHit {
  id: string;
  loan_number: string;
  principal: string;
  emi_amount: string;
  customer_name: string;
  customer_mobile: string;
  file_number: number;
  loan_remaining: string;
  next_emi: null | { dueDate: string; remainingAmount: string };
}

export function GlobalSearch() {
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const term = q.trim();
  const enabled = open && term.length >= 2;

  const { data: customers = [], isFetching: fetchingCustomers } = useQuery({
    queryKey: ['global-search', 'customers', term],
    queryFn: () => apiGet<CustomerHit[]>(`/customers?search=${encodeURIComponent(term)}`),
    enabled: enabled && can('customer.view'),
    staleTime: 30_000,
  });
  const { data: loans = [], isFetching: fetchingLoans } = useQuery({
    queryKey: ['global-search', 'loans', term],
    queryFn: () => apiGet<LoanHit[]>(`/loans/search?q=${encodeURIComponent(term)}`),
    enabled: enabled && can('loan.view'),
    staleTime: 30_000,
  });
  const busy = fetchingCustomers || fetchingLoans;

  // Ctrl+K / ⌘K focuses the search; Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click outside closes the dropdown.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };

  const customerHits = customers.slice(0, 6);
  const loanHits = loans.slice(0, 6);

  return (
    <div ref={boxRef} className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search customers, loans, JSSF-2026-…"
        className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 md:pr-12"
      />
      <kbd className="absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:block">
        ⌘K
      </kbd>

      {open && term.length >= 2 && (
        <div className="absolute z-40 mt-2 max-h-[70vh] w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
          {customerHits.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Customers
              </div>
              {customerHits.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="block w-full px-3 py-2.5 text-left text-sm hover:bg-muted"
                  onClick={() => go(`/customers?focus=${c.id}`)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.full_name}</span>
                    <span className="text-xs text-muted-foreground">File #{c.file_number}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {c.mobile}
                    {c.area_name ? ` · ${c.area_name}` : ''} · {Number(c.active_loan_count)} active loan{Number(c.active_loan_count) === 1 ? '' : 's'}
                  </div>
                </button>
              ))}
            </div>
          )}

          {loanHits.length > 0 && (
            <div className={customerHits.length ? 'border-t border-border' : ''}>
              <div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <HandCoins className="h-3.5 w-3.5" /> Active Loans
              </div>
              {loanHits.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="block w-full px-3 py-2.5 text-left text-sm hover:bg-muted"
                  onClick={() => go(`/loans?focus=${l.id}`)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{l.customer_name} · {l.loan_number}</span>
                    <span className="text-xs text-muted-foreground">{money(l.principal)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    File #{l.file_number} · {l.customer_mobile} · Remaining {money(l.loan_remaining)}
                    {l.next_emi ? ` · Next EMI ${date(l.next_emi.dueDate)} (${money(l.next_emi.remainingAmount)})` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!busy && customerHits.length === 0 && loanHits.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No customers or loans found</div>
          )}
          {busy && customerHits.length === 0 && loanHits.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">Searching…</div>
          )}
        </div>
      )}
    </div>
  );
}
