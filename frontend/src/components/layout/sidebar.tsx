'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  MapPin,
  UserSquare2,
  Banknote,
  CheckSquare,
  ClipboardList,
  HandCoins,
  Receipt,
  Wallet,
  CircleDollarSign,
  BarChart3,
  Settings,
  ScrollText,
  LogOut,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string; // required permission to see the item
  roles?: string[]; // OR'd with permission — visible if either matches
  badgeKey?: 'pendingApprovals'; // optional numeric badge from dashboard summary
}

interface NavSection {
  title?: string; // omitted for the top-level items
  items: NavItem[];
}

// Grouped module map — items appear only if the user holds the permission/role.
const SECTIONS: NavSection[] = [
  {
    items: [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' }],
  },
  {
    title: 'Lending',
    items: [
      { label: 'Customers', href: '/customers', icon: UserSquare2, permission: 'customer.view' },
      { label: 'Loans', href: '/loans', icon: Banknote, permission: 'loan.view' },
      { label: 'Loan Approval', href: '/approvals', icon: CheckSquare, permission: 'loan.approve', badgeKey: 'pendingApprovals' },
      { label: 'Approval Requests', href: '/approval-requests', icon: CheckSquare, roles: ['admin', 'manager'] },
      { label: 'Collections', href: '/collections', icon: HandCoins, permission: 'collection.view' },
      { label: 'Collection Sheet', href: '/collection-sheet', icon: ClipboardList, permission: 'collection.view' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Areas', href: '/areas', icon: MapPin, permission: 'area.view' },
      { label: 'Capital', href: '/capital', icon: CircleDollarSign, permission: 'capital.view' },
      { label: 'Cash & Bank', href: '/accounts', icon: Wallet, permission: 'capital.view' },
      { label: 'Expenses', href: '/expenses', icon: Receipt, permission: 'expense.view' },
      { label: 'Salary', href: '/salary', icon: Wallet, permission: 'salary.view' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { label: 'Reports', href: '/reports', icon: BarChart3, permission: 'report.view' },
      { label: 'Audit Logs', href: '/audit', icon: ScrollText, permission: 'audit.view' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Users', href: '/users', icon: Users, permission: 'user.view' },
      { label: 'Roles & Access', href: '/roles', icon: ShieldCheck, permission: 'role.manage' },
      { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.manage' },
    ],
  },
];

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  collection_agent: 'Collection Agent',
  accounts_dept: 'Accounts Dept',
};

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { can, user, logout } = useAuth();

  // Light shared query (cached across pages) purely to surface the approvals badge.
  const { data: badges } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiGet<{ kpis: { pendingApprovals: number } }>('/dashboard/summary'),
    enabled: can('dashboard.view'),
    staleTime: 60_000,
  });

  const visible = (i: NavItem) => {
    if (!i.permission && !i.roles) return true;
    const permOk = i.permission ? can(i.permission) : false;
    const roleOk = i.roles ? !!user && i.roles.includes(user.role) : false;
    return permOk || roleOk;
  };

  const initials = user?.fullName
    ?.split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-screen w-[80%] max-w-[16rem] shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 ease-out lg:static lg:z-auto lg:w-64 lg:translate-x-0',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5">
        <Logo size={40} />
        <div className="leading-tight">
          <p className="font-serif text-[15px] font-semibold text-white">Jai Shree Shyam</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/70">
            Finance ERP
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {SECTIONS.map((section, si) => {
          const items = section.items.filter(visible);
          if (!items.length) return null;
          return (
            <div key={si} className="space-y-1">
              {section.title && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
                  {section.title}
                </p>
              )}
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                const badge = item.badgeKey ? badges?.kpis?.[item.badgeKey] : undefined;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors',
                      active
                        ? 'bg-sidebar-active text-white shadow-sm'
                        : 'text-sidebar-foreground hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {!!badge && badge > 0 && (
                      <span className="rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold text-white">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* User card */}
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold text-white">{user?.fullName}</p>
            <p className="truncate text-[11px] text-sidebar-foreground/70">
              {user?.role ? ROLE_LABEL[user.role] ?? user.role : ''}
            </p>
          </div>
          <button
            onClick={() => logout()}
            className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-white/10 hover:text-white"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
      </aside>
    </>
  );
}
