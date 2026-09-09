'use client';

import { useEffect, useState } from 'react';
import { Settings, Zap, Pencil, Check, X } from 'lucide-react';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PageShell } from '@/components/app/page-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SweepResult {
  missedMarked: number;
  penalized: number;
  advancesMatured: number;
}

interface SettingRow {
  key: string;
  value: Record<string, unknown>;
  description: string;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // ── Settings data ──
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // ── Penalty editing ──
  const [editing, setEditing] = useState(false);
  const [penaltyDraft, setPenaltyDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // ── Sweep ──
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [sweepError, setSweepError] = useState('');

  // ── Fetch settings on mount ──
  useEffect(() => {
    if (!isAdmin) { setLoadingSettings(false); return; }
    (async () => {
      try {
        const rows = await apiGet<SettingRow[]>('/settings');
        setSettings(rows);
      } catch { /* fallback to static display */ }
      finally { setLoadingSettings(false); }
    })();
  }, [isAdmin]);

  // ── Derived values ──
  const penaltySetting = settings.find(s => s.key === 'penalty');
  const currentPct = penaltySetting ? Number((penaltySetting.value as { per_day_pct: number }).per_day_pct) : null;
  const interestSetting = settings.find(s => s.key === 'default_interest_rate');
  const currentInterest = interestSetting ? Number((interestSetting.value as { pct: number }).pct) : 10;

  const startEdit = () => {
    setPenaltyDraft(currentPct != null ? String(currentPct) : '0.2');
    setEditing(true);
    setSaveMsg(null);
  };
  const cancelEdit = () => { setEditing(false); setSaveMsg(null); };

  const savePenalty = async () => {
    const val = parseFloat(penaltyDraft);
    if (isNaN(val) || val < 0.01 || val > 5) {
      setSaveMsg({ type: 'err', text: 'Enter a value between 0.01 and 5.' });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      await apiPut('/settings/penalty', { per_day_pct: val });
      // Update local state
      setSettings(prev => prev.map(s =>
        s.key === 'penalty' ? { ...s, value: { per_day_pct: val } } : s,
      ));
      setEditing(false);
      setSaveMsg({ type: 'ok', text: 'Penalty rate updated successfully.' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Failed to update. Please try again.';
      setSaveMsg({ type: 'err', text: msg });
    } finally {
      setSaving(false);
    }
  };

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

  const penaltyDisplay = currentPct != null ? `${currentPct}%` : '0.2%';

  return (
    <PageShell title="Settings" description="Business rules for penalty, interest, and loan number format.">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4" /> Business Rules</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          {/* ── Penalty ── */}
          <div className="rounded-md border p-3">
            {editing ? (
              <div className="space-y-2">
                <label className="font-medium text-foreground">Penalty % per missed day</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.1"
                    min="0.01"
                    max="5"
                    value={penaltyDraft}
                    onChange={e => setPenaltyDraft(e.target.value)}
                    className="w-24"
                    disabled={saving}
                    autoFocus
                  />
                  <span className="text-xs">%</span>
                  <Button size="sm" onClick={savePenalty} disabled={saving} className="h-8 px-2">
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving} className="h-8 px-2">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {saveMsg && (
                  <p className={`text-xs ${saveMsg.type === 'err' ? 'text-danger' : 'text-success'}`}>{saveMsg.text}</p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span>
                  Penalty: {loadingSettings ? '…' : <span className="font-medium text-foreground">{penaltyDisplay}</span>} per missed day
                </span>
                {isAdmin && (
                  <button onClick={startEdit} className="text-muted-foreground hover:text-foreground transition-colors" title="Edit penalty rate">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            {!editing && saveMsg && (
              <p className={`text-xs mt-1 ${saveMsg.type === 'err' ? 'text-danger' : 'text-success'}`}>{saveMsg.text}</p>
            )}
          </div>
          <div className="rounded-md border p-3">Default flat interest: {loadingSettings ? '…' : `${currentInterest}%`}</div>
          <div className="rounded-md border p-3">Loan format: JSSF-year-sequence</div>
        </CardContent>
      </Card>

      {isAdmin && (
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
