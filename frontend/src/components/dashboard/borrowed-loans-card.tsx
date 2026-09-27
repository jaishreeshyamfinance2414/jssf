import Link from 'next/link';
import { AlertTriangle, ArrowRight, Landmark } from 'lucide-react';
import { date, money } from '@/lib/format';
import type { DashboardData } from './types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function BorrowedLoansCard({ summary, reminders }: {
  summary: NonNullable<DashboardData['borrowedLoans']>;
  reminders: NonNullable<DashboardData['borrowedLoanReminders']>;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5" /> Borrowed Loans</CardTitle>
        <Link href="/borrowed-loans" className="flex items-center gap-1 text-sm font-medium text-primary">Manage <ArrowRight className="h-4 w-4" /></Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ['Original borrowed', summary.originalBorrowed],
            ['Outstanding principal', summary.outstandingPrincipal],
            ['Principal repaid', summary.principalRepaid],
            ['Interest paid (expense)', summary.interestPaid],
          ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{money(value as number)}</p></div>)}
          <div className="rounded-lg bg-danger/10 p-3"><p className="text-xs text-danger">Overdue payments</p><p className="mt-1 font-semibold text-danger">{summary.overduePayments}</p></div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Upcoming payment dates</p>
          {reminders.length ? <div className="grid gap-2 md:grid-cols-2">
            {reminders.map((item) => <div key={item.loanId} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${item.overdue ? 'border-danger/40 bg-danger/5' : ''}`}>
              <div><p className="font-medium">{item.lenderName}</p><p className="text-xs text-muted-foreground">{item.loanType === 'reducing_balance' ? 'EMI' : 'Interest'} · {date(item.paymentDate)}</p></div>
              <div className="text-right"><p className="font-semibold">{money(item.amount)}</p>{item.overdue && <p className="flex items-center gap-1 text-xs text-danger"><AlertTriangle className="h-3 w-3" /> Overdue</p>}</div>
            </div>)}
          </div> : <p className="text-sm text-muted-foreground">No active borrowed-loan payments due.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
