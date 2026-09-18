'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cloud, DatabaseBackup, Download, RefreshCw, Upload } from 'lucide-react';
import { api, apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { BackupCronSection } from './backup-cron-section';

type Provider = 'b2' | 'r2';
type Status = { connected: boolean; checkedAt: string; message: string };

const providers: { key: Provider; title: string; description: string; icon: typeof Cloud }[] = [
  { key: 'b2', title: 'Backblaze B2 backup', description: 'Offsite storage for scheduled database backups', icon: DatabaseBackup },
  { key: 'r2', title: 'Cloudflare R2 live storage', description: 'Primary storage for customer documents', icon: Cloud },
];

export function BackupSection() {
  const [statuses, setStatuses] = useState<Partial<Record<Provider, Status>>>({});
  const [checking, setChecking] = useState<Partial<Record<Provider, boolean>>>({});
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState('');

  const check = useCallback(async (provider: Provider) => {
    setChecking(previous => ({ ...previous, [provider]: true }));
    try {
      const status = await apiGet<Status>(`/settings/backup/check/${provider}`);
      setStatuses(previous => ({ ...previous, [provider]: status }));
    } catch {
      setStatuses(previous => ({ ...previous, [provider]: {
        connected: false,
        checkedAt: new Date().toISOString(),
        message: 'Connection check failed. Please try again.',
      } }));
    } finally {
      setChecking(previous => ({ ...previous, [provider]: false }));
    }
  }, []);

  useEffect(() => { void check('b2'); void check('r2'); }, [check]);

  const download = async () => {
    setDownloading(true);
    setDownloadMessage(null);
    try {
      const response = await api.post('/settings/backup/download', undefined, { responseType: 'blob', timeout: 0 });
      const blob = response.data as Blob;
      const disposition = String(response.headers['content-disposition'] || '');
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `jssf_${new Date().toISOString().slice(0, 10)}.sql.gz`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDownloadMessage({ error: false, text: 'Fresh database backup downloaded.' });
    } catch (error) {
      const data = (error as { response?: { data?: unknown } })?.response?.data;
      let message = 'Could not create the backup. Please try again.';
      if (data instanceof Blob && data.type.includes('json')) {
        try { message = (JSON.parse(await data.text()) as { error?: { message?: string } }).error?.message || message; } catch { /* keep default */ }
      }
      setDownloadMessage({ error: true, text: message });
    } finally {
      setDownloading(false);
    }
  };

  const restore = async () => {
    if (!restoreFile || restoreConfirmation !== 'RESTORE') return;
    setRestoring(true);
    setRestoreError('');
    setRestoreProgress(null);
    try {
      const { data: start } = await api.post<{ data: { uploadId: string; chunkSize: number } }>(
        '/settings/backup/restore/uploads',
        { filename: restoreFile.name, size: restoreFile.size },
      );
      const { uploadId, chunkSize } = start.data;
      for (let offset = 0, index = 0; offset < restoreFile.size; offset += chunkSize, index++) {
        const chunk = restoreFile.slice(offset, offset + chunkSize);
        await api.put(`/settings/backup/restore/uploads/${uploadId}/chunks/${index}`, chunk, {
          headers: { 'Content-Type': 'application/octet-stream' },
          timeout: 0,
        });
        setRestoreProgress(Math.round(Math.min(offset + chunkSize, restoreFile.size) / restoreFile.size * 100));
      }
      await api.post(`/settings/backup/restore/uploads/${uploadId}/complete`, undefined, {
        headers: { 'x-restore-confirmation': 'RESTORE' },
        timeout: 0,
      });
      for (;;) {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        const status = await apiGet<{ status: 'uploading' | 'restoring' | 'complete' | 'failed'; error: string | null }>(
          `/settings/backup/restore/uploads/${uploadId}/status`,
        );
        if (status.status === 'complete') break;
        if (status.status === 'failed') throw new Error(status.error || 'Restore failed. Check the server logs.');
      }
      window.location.assign('/login');
    } catch (error) {
      const message = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setRestoreError(message || (error instanceof Error && error.name === 'Error' ? error.message : 'Restore could not be confirmed. Check the new server before trying again.'));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader><CardTitle className="flex items-center gap-2"><DatabaseBackup className="h-4 w-4" /> Backup &amp; Storage</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map(({ key, title, description, icon: Icon }) => {
            const status = statuses[key];
            return (
              <div key={key} className="rounded-md border p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span role="status" className={`rounded-md px-2 py-1 text-xs font-semibold ${status?.connected ? 'bg-success/10 text-success' : status ? 'bg-danger/10 text-danger' : 'bg-muted text-muted-foreground'}`}>
                    {status?.connected ? 'Connected' : status ? 'Not connected' : 'Checking…'}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => void check(key)} disabled={!!checking[key]}>
                    <RefreshCw className={`h-3.5 w-3.5 ${checking[key] ? 'animate-spin' : ''}`} />
                    {checking[key] ? 'Checking…' : 'Check connection'}
                  </Button>
                </div>
                {status && <p className="text-xs text-muted-foreground">{status.message} Checked {new Date(status.checkedAt).toLocaleString()}.</p>}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Connection checks confirm bucket access. Scheduled B2 backups run from the server cron job below.</p>
        <BackupCronSection />
        <div className="rounded-md border p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Download a new database backup</h3>
            <p className="text-xs text-muted-foreground">Creates a fresh PostgreSQL export and saves it to this device. Customer documents remain in Cloudflare R2 and are not included.</p>
          </div>
          <Button onClick={() => void download()} disabled={downloading}>
            <Download className="h-4 w-4" /> {downloading ? 'Creating backup…' : 'Create & download backup'}
          </Button>
          {downloadMessage && <p role="status" className={`text-sm ${downloadMessage.error ? 'text-danger' : 'text-success'}`}>{downloadMessage.text}</p>}
        </div>
        <div className="rounded-md border border-danger/30 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Restore Backup</h3>
            <p className="text-xs text-muted-foreground">Use this immediately after installing the app on a new server, before entering business data. Upload a JSSF .sql.gz database backup. Successful restore replaces the new database and takes you to login with the restored admin account.</p>
            <p className="mt-1 text-xs text-muted-foreground">Customer documents are stored separately in R2. Configure this server to use the original R2 bucket to access them.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="restore-file" className="mb-1 block text-xs font-medium text-foreground">Backup file</label>
              <Input id="restore-file" type="file" accept=".sql.gz,application/gzip" disabled={restoring} onChange={event => {
                setRestoreFile(event.target.files?.[0] || null);
                setRestoreError('');
              }} />
            </div>
            <div>
              <label htmlFor="restore-confirmation" className="mb-1 block text-xs font-medium text-foreground">Type RESTORE to confirm replacement</label>
              <Input id="restore-confirmation" value={restoreConfirmation} onChange={event => setRestoreConfirmation(event.target.value)} disabled={restoring} autoComplete="off" />
            </div>
          </div>
          <Button variant="danger" onClick={() => void restore()} disabled={!restoreFile || restoreConfirmation !== 'RESTORE' || restoring || downloading}>
            <Upload className="h-4 w-4" /> {restoring ? (restoreProgress == null ? 'Starting upload…' : restoreProgress < 100 ? `Uploading… ${restoreProgress}%` : 'Restoring database…') : 'Restore Backup'}
          </Button>
          {restoreError && <p role="alert" className="text-sm text-danger">{restoreError}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
