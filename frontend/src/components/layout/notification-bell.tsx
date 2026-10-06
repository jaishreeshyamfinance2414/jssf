'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell, CalendarClock, CreditCard, X } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';

interface NotificationItem {
  id: string;
  type: 'manual' | 'payment';
  title: string;
  description: string;
  due_date: string;
  amount: string;
  customer_id: string | null;
  borrowed_loan_id: string | null;
}

interface Notifications {
  manual: NotificationItem[];
  payments: NotificationItem[];
  total: number;
}

export function NotificationBell() {
  const { user } = useAuth();
  const enabled = user?.role === 'admin' || user?.role === 'manager';
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiGet<Notifications>('/reminders/notifications'),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!enabled) return null;
  const items = [...(data?.manual ?? []), ...(data?.payments ?? [])]
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white/85 backdrop-blur-sm transition-colors hover:text-white md:h-10 md:w-10 md:border-border md:bg-card md:text-muted-foreground md:hover:text-foreground"
        title="Notifications"
        aria-label={`Notifications${data?.total ? ` (${data.total})` : ''}`}
        aria-expanded={open}
      >
        <Bell className="h-[18px] w-[18px]" />
        {!!data?.total && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {data.total > 99 ? '99+' : data.total}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-[76px] z-50 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[390px]">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="font-semibold">Notifications</p>
              <p className="text-xs text-muted-foreground">All reminders · payments due within 7 days or overdue</p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close notifications">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {!items.length ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">No reminders or upcoming payments.</div>
            ) : items.map((item) => (
              <Link
                key={`${item.type}-${item.id}`}
                href={item.type === 'manual' ? '/reminders' : '/borrowed-loans'}
                onClick={() => setOpen(false)}
                className="flex gap-3 border-b px-4 py-3 transition-colors last:border-0 hover:bg-muted/60"
              >
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.type === 'manual' ? 'bg-primary/10 text-primary' : 'bg-warning/10 text-warning'}`}>
                  {item.type === 'manual' ? <CalendarClock className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{item.title}</span>
                    <span className="shrink-0 text-xs font-semibold">{money(item.amount)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
                  <span className="mt-1 block text-[11px] font-medium text-danger">Due {date(item.due_date)}</span>
                </span>
              </Link>
            ))}
          </div>
          <Link href="/reminders" onClick={() => setOpen(false)} className="block border-t px-4 py-3 text-center text-sm font-semibold text-primary hover:bg-muted/60">
            Manage reminders
          </Link>
        </div>
      )}
    </div>
  );
}
