'use client';

import { useState } from 'react';
import { Settings, Zap } from 'lucide-react';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PageShell } from '@/components/app/page-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface SweepResult {
  missedMarked: number;
  penalized: number;
  advancesMatured: number;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [sweepError, setSweepError] = useState('');

  const runSweep = async () => {
    setSweeping(true);
    setSweepResult(null);
    setSweepError('');
    try {
      const res = await apiPost<SweepResult>('/collections/sweep');
      setSweepResult(res);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Sweep failed. Please try again.';
      setSweepError(msg);
    } finally {
      setSweeping(false);
    }
  };

  return (
    <PageShell title="Settings" description="Business rules for penalty, interest, and loan number format.">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4" /> Business Rules</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          <div className="rounded-md border p-3">Penalty: 0.5% per missed day</div>
          <div className="rounded-md border p-3">Default flat interest: 10%</div>
          <div className="rounded-md border p-3">Loan format: JSSF-year-sequence</div>
        </CardContent>
      </Card>

      {user?.role === 'admin' && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Zap className="h-4 w-4" /> Penalty Sweep</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The penalty sweep runs automatically every hour. Use this button to trigger it instantly — it will mark
              overdue EMIs as missed, apply penalties (from 2nd consecutive miss onwards), and mature advance payments.
            </p>
            <Button onClick={runSweep} disabled={sweeping}>
              {sweeping ? 'Running Sweep…' : 'Run Penalty Sweep Now'}
            </Button>
            {sweepResult && (
              <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm space-y-1">
                <p className="font-medium text-success">✓ Sweep completed successfully</p>
                <ul className="list-disc list-inside text-muted-foreground">
                  <li>EMIs marked missed: <span className="font-semibold text-foreground">{sweepResult.missedMarked}</span></li>
                  <li>Penalties applied: <span className="font-semibold text-foreground">{sweepResult.penalized}</span></li>
                  <li>Advances matured: <span className="font-semibold text-foreground">{sweepResult.advancesMatured}</span></li>
                </ul>
              </div>
            )}
            {sweepError && (
              <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{sweepError}</div>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
