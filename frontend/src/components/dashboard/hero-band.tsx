'use client';

import Link from 'next/link';
import { HandCoins, Landmark, AlertTriangle, TrendingUp, TrendingDown, Coins, Smartphone, ArrowRight } from 'lucide-react';
import { inr } from '@/lib/utils';
import type { DashboardData } from './types';

export function HeroBand({ kpis, showCash = true }: { kpis: DashboardData['kpis']; showCash?: boolean }) {
  const collected = kpis.todaysCollection.total;
  const remainingDue = kpis.todaysDue;
  const scheduled = collected + remainingDue;
  const collectedPct = scheduled > 0 ? Math.round((collected / scheduled) * 100) : 0;

  const prev = kpis.todaysCollection.previousTotal ?? 0;
  const delta = prev > 0 ? ((collected - prev) / prev) * 100 : null;
  const up = (delta ?? 0) >= 0;

  const split = kpis.cashSplit;

  return (
    <div className={`grid grid-cols-1 divide-y divide-border rounded-2xl border border-border bg-card shadow-sm lg:divide-x lg:divide-y-0 ${showCash ? 'lg:grid-cols-[1.4fr_1fr_1fr]' : 'lg:grid-cols-[1.4fr_1fr]'}`}>
      {/* Today's Collection */}
      <div className="p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <HandCoins className="h-[18px] w-[18px] text-primary" />
          Today&apos;s Collection
        </div>
        <div className="flex items-end justify-between">
          <p className="font-serif text-[28px] font-semibold leading-none text-foreground sm:text-[34px]">{inr(collected)}</p>
          <p className="text-xs text-muted-foreground">of {inr(scheduled)} due</p>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(collectedPct, 100)}%` }} />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Collected <b className="text-foreground">{collectedPct}%</b>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full border border-muted-foreground/40" />
              Pending <b className="text-foreground">{inr(remainingDue)}</b>
            </span>
          </div>
          {delta !== null && (
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${
                up ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
              }`}
            >
              {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {Math.abs(delta).toFixed(1)}% <span className="font-normal text-muted-foreground">vs yesterday</span>
            </span>
          )}
        </div>
      </div>

      {/* Available Cash */}
      {showCash && (
      <div className="p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Landmark className="h-[18px] w-[18px] text-primary" />
          Available Cash
        </div>
        <p className="font-serif text-[26px] font-semibold leading-none text-foreground sm:text-[32px]">{inr(kpis.availableCash)}</p>
        <div className="mt-4 space-y-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Coins className="h-4 w-4" /> Cash in hand
            </span>
            <span className="font-semibold text-foreground">{split ? inr(split.cashInHand) : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Smartphone className="h-4 w-4" /> UPI / Bank
            </span>
            <span className="font-semibold text-foreground">{split ? inr(split.bankUpi) : '—'}</span>
          </div>
        </div>
      </div>
      )}

      {/* Missed EMI */}
      <div className="p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <AlertTriangle className="h-[18px] w-[18px] text-danger" />
          Today&apos;s Missed EMI
        </div>
        <p className="font-serif text-[26px] font-semibold leading-none text-danger sm:text-[32px]">
          {kpis.missedEmiAmount != null ? inr(kpis.missedEmiAmount) : String(kpis.todaysMissed)}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          <b className="text-foreground">{kpis.todaysMissed}</b> EMIs unpaid
          {kpis.missedEmiAreas != null && <> across {kpis.missedEmiAreas} areas</>}
        </p>
        <Link
          href="/collections"
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          Review missed collections <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
