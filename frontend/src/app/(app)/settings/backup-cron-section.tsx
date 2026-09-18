'use client';

import { useEffect, useState } from 'react';
import { Clock3, RefreshCw } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CronStatus {
  available: boolean;
  enabled: boolean;
  time: string;
  scriptPath: string | null;
  timezone: string | null;
  lastRun: { state: 'running' | 'success' | 'failed' | 'unknown' | 'never'; startedAt: string | null; finishedAt: string | null; error: string | null } | null;
  message?: string;
}

export function BackupCronSection() {
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState('02:17');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await apiGet<CronStatus>('/settings/backup/cron');
      setStatus(next);
      if (next.available) {
        setEnabled(next.enabled);
        setTime(next.time);
      }
    } catch {
      setMessage('Could not read the server cron job. Please try again.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const save = async () => {
    setSaving(true); setMessage('');
    try {
      const next = await apiPut<CronStatus>('/settings/backup/cron', { enabled, time });
      setStatus(next);
      setEnabled(next.enabled);
      setTime(next.time);
      setMessage(next.enabled ? 'Nightly database backup scheduled in root crontab.' : 'Scheduled database backup disabled.');
    } catch (error: unknown) {
      setMessage((error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
        ?? 'Could not save the cron job.');
    } finally { setSaving(false); }
  };

  return <div className="rounded-md border p-4 space-y-3">
    <div className="flex items-center gap-2"><Clock3 className="h-4 w-4" /><h3 className="text-sm font-semibold">Scheduled Database Backup</h3></div>
    <p className="text-xs text-muted-foreground">Manage the daily backup job in the server&apos;s root crontab. This runs the installed database backup script; other root cron jobs are preserved.</p>
    {loading ? <p className="text-sm text-muted-foreground">Checking server cron…</p> : <>
      {status?.available
        ? <p className="text-xs">Current root job: <strong>{status.enabled ? 'Enabled' : 'Disabled'}</strong>{status.enabled ? ` at ${status.time} ${status.timezone ?? ''}` : ''}</p>
        : <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm space-y-2" role="alert">
          <p>{status?.message ?? 'Root cron status cannot be read yet.'}</p>
          <p>The existing root backup can still run. The app needs one server setup step before it can read or change that crontab.</p>
          <code className="block break-all rounded bg-background p-2 text-xs">cd ~/jssf &amp;&amp; bash deploy/install-backup-cron-helper.sh</code>
          <p className="text-xs">Run this once on the server as the same user who runs PM2, then select Refresh status below.</p>
        </div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={saving} /> Enable daily backup</label>
        <div><label htmlFor="backup-cron-time" className="mb-1 block text-xs font-medium">Server time ({status?.timezone ?? 'local'})</label><Input id="backup-cron-time" type="time" value={time} onChange={event => setTime(event.target.value)} disabled={saving} /></div>
      </div>
      <div><p className="text-xs font-medium">Installed script path</p><code className="break-all text-xs text-muted-foreground">{status?.scriptPath ?? 'Available after server setup'}</code></div>
      <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
          <p className="font-medium">Last backup</p>
          {status?.lastRun?.state === 'success' && <p className="text-success">Completed successfully {status.lastRun.finishedAt ? new Date(status.lastRun.finishedAt).toLocaleString() : ''}.</p>}
          {status?.lastRun?.state === 'failed' && <><p className="text-danger">Failed {status.lastRun.finishedAt ? new Date(status.lastRun.finishedAt).toLocaleString() : ''}.</p><pre className="whitespace-pre-wrap break-words text-xs text-danger">{status.lastRun.error ?? 'The backup script did not report a specific error. Check the server backup log.'}</pre></>}
          {status?.lastRun?.state === 'running' && <p>Running since {status.lastRun.startedAt ? new Date(status.lastRun.startedAt).toLocaleString() : 'recently'}.</p>}
          {status?.lastRun?.state === 'unknown' && <p>Log found from {status.lastRun.finishedAt ? new Date(status.lastRun.finishedAt).toLocaleString() : 'an earlier run'}, but its result is unclear.</p>}
          {(!status?.lastRun || status.lastRun.state === 'never') && <p className="text-muted-foreground">No readable backup run log is available to the app yet.</p>}
      </div>
      <Button size="sm" onClick={() => void save()} disabled={saving || !time || !status?.available}>{saving ? 'Saving…' : 'Save cron job'}</Button>
      <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={saving}><RefreshCw className="h-3.5 w-3.5" /> Refresh status</Button>
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
