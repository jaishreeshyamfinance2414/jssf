'use client';

import { useCallback, useEffect, useState } from 'react';
import { DatabaseBackup, RefreshCw } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';

type History = {
  state: 'never' | 'running' | 'success' | 'failed' | 'unknown';
  source: 'scheduled' | 'manual' | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

const displayTime = (value: string | null) => value ? new Date(value).toLocaleString() : 'time unavailable';

export function BackupHistorySection() {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try {
      setHistory(await apiGet<History>('/settings/backup/history'));
      setMessage('');
    } catch {
      setMessage('Could not read backup logs. Please try again.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, history?.state === 'running' ? 3000 : 30000);
    return () => window.clearInterval(timer);
  }, [history?.state, refresh]);

  const backupNow = async () => {
    setStarting(true); setMessage('');
    try {
      await apiPost('/settings/backup/now');
      await refresh();
    } catch (error: unknown) {
      setMessage((error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
        ?? 'Could not start the backup.');
    } finally { setStarting(false); }
  };

  return <div className="rounded-md border p-4 space-y-3">
    <div className="flex items-center gap-2"><DatabaseBackup className="h-4 w-4" /><h3 className="text-sm font-semibold">Server Backup</h3></div>
    <p className="text-xs text-muted-foreground">Shows the latest run from the server backup logs. The existing root cron schedule remains configured on the server. Backup Now runs the same backup script immediately.</p>
    <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1" aria-live="polite">
      <p className="font-medium">Last backup</p>
      {loading && <p className="text-muted-foreground">Reading backup logs…</p>}
      {!loading && history?.state === 'success' && <p className="text-success">Successful {displayTime(history.finishedAt)} ({history.source}).</p>}
      {!loading && history?.state === 'failed' && <><p className="text-danger">Failed {displayTime(history.finishedAt)} ({history.source}).</p><pre className="whitespace-pre-wrap break-words text-xs text-danger">{history.error ?? 'No specific error was recorded.'}</pre></>}
      {!loading && history?.state === 'running' && <p>Running since {displayTime(history.startedAt)} ({history.source}).</p>}
      {!loading && history?.state === 'unknown' && <><p>The last log has no clear completion result.</p>{history.error && <pre className="whitespace-pre-wrap break-words text-xs">{history.error}</pre>}</>}
      {!loading && (!history || history.state === 'never') && <p className="text-muted-foreground">No readable backup run has been recorded yet.</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => void backupNow()} disabled={starting || history?.state === 'running'}>{starting ? 'Starting…' : 'Backup Now'}</Button>
      <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={starting}><RefreshCw className="h-3.5 w-3.5" /> Refresh status</Button>
    </div>
    {message && <p role="alert" className="text-sm text-danger">{message}</p>}
  </div>;
}
