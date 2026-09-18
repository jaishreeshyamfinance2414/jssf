'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { Settings, Zap, Pencil, Check, X } from 'lucide-react';
import { api, apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PageShell } from '@/components/app/page-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BackupSection } from './backup-section';
import { useBranding } from '@/lib/branding-context';
import { brandingQueryKey } from '@/lib/branding-context';
import { useQueryClient } from '@tanstack/react-query';

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
  const branding = useBranding();
  const queryClient = useQueryClient();
  const refreshBranding = () => queryClient.invalidateQueries({ queryKey: brandingQueryKey });
  const isAdmin = user?.role === 'admin';

  // ── Settings data ──
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // ── Penalty editing ──
  const [editing, setEditing] = useState(false);
  const [penaltyDraft, setPenaltyDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [prefixDraft, setPrefixDraft] = useState('');
  const [editingPrefix, setEditingPrefix] = useState(false);
  const [prefixSaving, setPrefixSaving] = useState(false);
  const [prefixMessage, setPrefixMessage] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [brandingBusy, setBrandingBusy] = useState(false);
  const [brandingMessage, setBrandingMessage] = useState('');

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
  const loanSetting = settings.find(s => s.key === 'loan_number');
  const loanValue = loanSetting?.value as { prefix?: string; pad?: number } | undefined;
  const prefix = loanValue?.prefix ?? 'JSSF';
  const pad = loanValue?.pad ?? 7;

  useEffect(() => { setBusinessName(branding.businessName); }, [branding.businessName]);

  const savePrefix = async () => {
    const proposed = prefixDraft.trim().toUpperCase();
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(proposed) || proposed.length > 20) {
      setPrefixMessage('Use 1–20 letters, numbers, or single hyphens.'); return;
    }
    setPrefixSaving(true); setPrefixMessage('');
    try {
      const next = await apiPut<{ prefix: string; pad: number }>('/settings/loan-number', { prefix: proposed });
      setSettings(prev => prev.map(s => s.key === 'loan_number' ? { ...s, value: next } : s));
      setEditingPrefix(false);
      setPrefixMessage('Loan prefix saved. Existing loan numbers are unchanged.');
    } catch (err: unknown) {
      setPrefixMessage((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Could not save loan prefix.');
    } finally { setPrefixSaving(false); }
  };

  const saveBusinessName = async () => {
    const name = businessName.trim();
    if (name.length < 2 || name.length > 100) { setBrandingMessage('Business name must be 2–100 characters.'); return; }
    setBrandingBusy(true); setBrandingMessage('');
    try {
      await apiPut('/settings/branding', { businessName: name });
      await refreshBranding();
      setBrandingMessage('Business name saved.');
    } catch (err: unknown) {
      setBrandingMessage((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Could not save business name.');
    } finally { setBrandingBusy(false); }
  };

  const uploadBranding = async (kind: 'logo' | 'favicon', file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setBrandingMessage('Image must be 2 MB or smaller.'); return; }
    const allowed = kind === 'favicon' ? ['image/png'] : ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) { setBrandingMessage(kind === 'favicon' ? 'Choose a PNG favicon.' : 'Choose a PNG, JPEG, or WebP logo.'); return; }
    setBrandingBusy(true); setBrandingMessage('');
    try {
      const body = new FormData(); body.append('image', file);
      await api.put(`/settings/branding/assets/${kind}`, body);
      await refreshBranding();
      setBrandingMessage(`${kind === 'logo' ? 'Logo' : 'Favicon'} uploaded.`);
    } catch (err: unknown) {
      setBrandingMessage((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Upload failed.');
    } finally { setBrandingBusy(false); }
  };

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
    <PageShell title="Settings" description="Business rules, backups, and storage status.">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4" /> Business Rules</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          {/* ── Penalty ── */}
          <div className="rounded-md border p-3">
            {editing ? (
              <div className="space-y-2">
                <label className="font-medium text-foreground">Daily penalty % when shortfall exceeds 3 EMIs</label>
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
                  Penalty: {loadingSettings ? '…' : <span className="font-medium text-foreground">{penaltyDisplay}</span>} per day when shortfall exceeds 3 EMIs
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
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span>Loan format: <span className="font-medium text-foreground">{prefix}-{new Date().getFullYear()}-{String(1).padStart(pad, '0')}</span></span>
              {isAdmin && !editingPrefix && <button title="Edit loan prefix" onClick={() => { setPrefixDraft(prefix); setEditingPrefix(true); setPrefixMessage(''); }}><Pencil className="h-3.5 w-3.5" /></button>}
            </div>
            {editingPrefix && <div className="mt-3 flex items-center gap-2"><Input aria-label="Loan number prefix" maxLength={20} value={prefixDraft} onChange={e => setPrefixDraft(e.target.value)} disabled={prefixSaving} /><Button size="sm" onClick={savePrefix} disabled={prefixSaving}>Save</Button><Button size="sm" variant="outline" onClick={() => setEditingPrefix(false)} disabled={prefixSaving}>Cancel</Button></div>}
            <p className="mt-1 text-xs">Change the starting characters for new loans. Year and sequence stay automatic.</p>
            {prefixMessage && <p className="mt-1 text-xs">{prefixMessage}</p>}
          </div>
        </CardContent>
      </Card>

      {isAdmin && <Card className="mt-6">
        <CardHeader><CardTitle>Business Identity</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-2"><label htmlFor="business-name" className="font-medium">Business Name</label><div className="flex gap-2"><Input id="business-name" value={businessName} maxLength={100} onChange={e => setBusinessName(e.target.value)} disabled={brandingBusy} /><Button onClick={saveBusinessName} disabled={brandingBusy || businessName.trim() === branding.businessName}>Save</Button></div></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><label htmlFor="brand-logo" className="font-medium">Logo upload</label><div className="flex h-16 w-16 items-center justify-center rounded-lg border bg-white">{branding.logoUrl ? <img src={branding.logoUrl} alt="Current business logo" className="h-full w-full object-contain" /> : <span className="text-[9px]">Upcoming</span>}</div><Input id="brand-logo" type="file" accept="image/png,image/jpeg,image/webp" disabled={brandingBusy} onChange={e => { void uploadBranding('logo', e.target.files?.[0]); e.target.value = ''; }} /><p className="text-xs text-muted-foreground">PNG, JPEG, or WebP, up to 2 MB. Shown on login and in the sidebar.</p></div>
            <div className="space-y-2"><label htmlFor="brand-favicon" className="font-medium">Favicon upload</label><div className="flex h-16 w-16 items-center justify-center rounded-lg border bg-white">{branding.faviconVersion ? <img src={branding.faviconUrl!} alt="Current favicon" className="h-full w-full object-contain" /> : <span className="text-[9px]">Upcoming</span>}</div><Input id="brand-favicon" type="file" accept="image/png" disabled={brandingBusy} onChange={e => { void uploadBranding('favicon', e.target.files?.[0]); e.target.value = ''; }} /><p className="text-xs text-muted-foreground">Square PNG, up to 2 MB. Shown in browser tabs and the app icon.</p></div>
          </div>
          {brandingMessage && <p role="status">{brandingMessage}</p>}
        </CardContent>
      </Card>}

      {isAdmin && (
        <BackupSection />
      )}

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Zap className="h-4 w-4" /> Penalty Sweep</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The penalty sweep runs automatically every hour. Use this button to trigger it instantly — it will mark
              completed uncovered days as missed and apply one daily penalty only after the collection day ends, when scheduled EMI dues plus previously accrued penalties minus all receipts through that date exceeds 3 EMIs. Today's open day is never charged. Daily checks continue after maturity until full settlement or manual closure; no extra EMI debt is added.
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
