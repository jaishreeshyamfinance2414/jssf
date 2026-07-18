'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Download, Plus, Menu, Search, X } from 'lucide-react';
import { GlobalSearch } from './global-search';

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/customers': 'Customers',
  '/loans': 'Loans',
  '/approvals': 'Loan Approval',
  '/approval-requests': 'Approval Requests',
  '/collections': 'Collections',
  '/collection-sheet': 'Collection Sheet',
  '/areas': 'Areas',
  '/capital': 'Capital',
  '/accounts': 'Cash & Bank',
  '/expenses': 'Expenses',
  '/salary': 'Salary',
  '/reports': 'Reports',
  '/audit': 'Audit Logs',
  '/users': 'Users',
  '/roles': 'Roles & Access',
  '/settings': 'Settings',
};

const BRANCH = 'Sangam Vihar Branch';

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const key = Object.keys(TITLES).find((k) => pathname === k || pathname.startsWith(k + '/'));
  const title = key ? TITLES[key] : 'JSSF';

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    // On mobile the bar floats: inset from the edges, pine→emerald gradient,
    // soft emerald glow. From `md` up it reverts to the flat desktop header.
    <header className="z-30 px-3 pt-3 md:px-0 md:pt-0">
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-sidebar via-sidebar to-primary/90 shadow-lg shadow-primary/25 md:rounded-none md:border-0 md:bg-none md:shadow-none">
        <div className="flex h-[60px] items-center gap-2.5 px-3.5 sm:gap-4 md:h-[72px] md:px-6">
          {/* Mobile menu */}
          <button
            onClick={onMenu}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white backdrop-blur-sm md:h-10 md:w-10 md:border-border md:bg-card md:text-foreground lg:hidden"
            title="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Page title */}
          <div className="min-w-0">
            <h1 className="truncate font-serif text-lg font-semibold leading-tight text-white md:text-2xl md:text-foreground">
              {title}
            </h1>
            <p className="truncate text-[11px] text-white/65 md:text-xs md:text-muted-foreground">
              {today} · {BRANCH}
            </p>
          </div>

          {/* Search (inline on ≥md) */}
          <div className="mx-auto hidden w-full max-w-md items-center md:flex">
            <GlobalSearch />
          </div>

          {/* Actions */}
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            {/* Search toggle (mobile only) */}
            <button
              onClick={() => setSearchOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white/85 backdrop-blur-sm transition-colors hover:text-white md:hidden"
              title="Search"
            >
              {searchOpen ? <X className="h-[18px] w-[18px]" /> : <Search className="h-[18px] w-[18px]" />}
            </button>
            <button
              className="hidden h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white/85 backdrop-blur-sm transition-colors hover:text-white sm:flex md:h-10 md:w-10 md:border-border md:bg-card md:text-muted-foreground md:hover:text-foreground"
              title="Notifications"
            >
              <Bell className="h-[18px] w-[18px]" />
            </button>
            <button
              className="hidden h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white/85 backdrop-blur-sm transition-colors hover:text-white sm:flex md:h-10 md:w-10 md:border-border md:bg-card md:text-muted-foreground md:hover:text-foreground"
              title="Export"
            >
              <Download className="h-[18px] w-[18px]" />
            </button>
            <Link
              href="/loans"
              className="flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-white/90 md:h-10 md:bg-primary md:px-4 md:text-primary-foreground md:hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Loan</span>
            </Link>
          </div>
        </div>

        {/* Search row (mobile only, toggled) */}
        {searchOpen && (
          <div className="px-3.5 pb-3.5 md:hidden">
            <GlobalSearch />
          </div>
        )}
      </div>
    </header>
  );
}
