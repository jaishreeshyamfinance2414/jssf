'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { DashboardData } from '@/components/dashboard/types';
import { HeroBand } from '@/components/dashboard/hero-band';
import { KpiStrip } from '@/components/dashboard/kpi-strip';
import { CollectionTrend } from '@/components/dashboard/collection-trend';
import { AgentCollection } from '@/components/dashboard/agent-collection';
import { AreaCollection } from '@/components/dashboard/area-collection';
import { PendingApprovals } from '@/components/dashboard/pending-approvals';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { HandoverCard } from '@/components/dashboard/handover-card';

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiGet<DashboardData>('/dashboard/summary'),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl bg-danger/10 p-4 text-danger">
        Failed to load dashboard. Is the API running?
      </div>
    );
  }

  const isAdminLike = user?.role === 'admin' || user?.role === 'manager';

  return (
    <div className="space-y-5">
      {/* Hero band */}
      <HeroBand kpis={data.kpis} showCash={isAdminLike} />

      {/* KPI strip */}
      <KpiStrip kpis={data.kpis} />

      {/* Trend + agent reconciliation */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <CollectionTrend data={data.collectionTrend} />
        <AgentCollection rows={data.agentWiseCollection} />
      </div>

      {/* Area breakdown + pending approvals */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.5fr]">
        <AreaCollection rows={data.areaWiseCollection} />
        <PendingApprovals
          rows={data.pendingLoanApprovals ?? []}
          totalPending={data.kpis.pendingApprovals}
        />
      </div>

      {/* Recent activity */}
      <RecentActivity rows={data.recentActivity ?? []} />

      {/* Admin/manager cash-handover reconciliation */}
      {isAdminLike && data.pendingHandoverByAgent && <HandoverCard rows={data.pendingHandoverByAgent} />}
    </div>
  );
}
