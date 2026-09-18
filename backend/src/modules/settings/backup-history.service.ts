import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, openSync, writeSync } from 'node:fs';
import { mkdir, open, readdir, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, Conflict } from '../../shared/errors';
import { logger } from '../../config/logger';

const BACKUP_DIR = join(homedir(), 'backups');
const MANUAL_SCRIPT = resolve(process.cwd(), '..', 'deploy', 'backup-now.sh');
const RUN_LOG = /^jssf_backup_(?:\d{4}-\d{2}-\d{2}_\d{4}(?:\d{2})?|manual_\d{4}-\d{2}-\d{2}_\d{6}_[a-f0-9-]+)\.log$/;
let manualRunning = false;

export type BackupHistory = {
  state: 'never' | 'running' | 'success' | 'failed' | 'unknown';
  source: 'scheduled' | 'manual' | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

function timestamp(line: string): string | null {
  const value = line.match(/^\d{4}-\d{2}-\d{2}T\S+/)?.[0];
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

async function tail(path: string, size: number): Promise<string> {
  const file = await open(path, 'r');
  try {
    const count = Math.min(size, 64 * 1024);
    const buffer = Buffer.alloc(count);
    await file.read(buffer, 0, count, size - count);
    return buffer.toString('utf8');
  } finally { await file.close(); }
}

export async function backupHistory(): Promise<BackupHistory> {
  try {
    const names = (await readdir(BACKUP_DIR)).filter(name => RUN_LOG.test(name) || name === 'backup.log');
    const files = (await Promise.all(names.map(async name => {
      try {
        const info = await lstat(join(BACKUP_DIR, name));
        return info.isFile() ? { name, info } : null;
      } catch { return null; }
    }))).filter((item): item is NonNullable<typeof item> => item !== null);
    files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    let latest: (typeof files)[number] | undefined;
    let content = '';
    for (const candidate of files) {
      try {
        content = await tail(join(BACKUP_DIR, candidate.name), candidate.info.size);
        latest = candidate;
        break;
      } catch { /* Try the next readable backup log. */ }
    }
    if (!latest) return { state: 'never', source: null, startedAt: null, finishedAt: null, error: null };
    const lines = content.split(/\r?\n/).filter(Boolean);
    const last = lines.at(-1) ?? '';
    const manual = latest.name.startsWith('jssf_backup_manual_');
    const success = manual ? last.includes('BACKUP_NOW_SUCCESS') : last.includes('backup completed successfully');
    const failed = manual ? last.includes('BACKUP_NOW_FAILED') : last.includes('ERROR:');
    const state: BackupHistory['state'] = success ? 'success' : failed ? 'failed'
      : Date.now() - latest.info.mtimeMs < 4 * 60 * 60 * 1000 ? 'running' : 'unknown';
    const errors = lines.filter(line => /error:|failed|denied|fatal:/i.test(line));
    const error = state === 'failed' || state === 'unknown'
      ? (errors.length ? errors.slice(-4) : lines.slice(-4)).join('\n').slice(-2000) || 'No specific error was recorded.'
      : null;
    return { state, source: manual ? 'manual' : 'scheduled',
      startedAt: manual ? timestamp(lines[0] ?? '') : state === 'running' ? latest.info.mtime.toISOString() : null,
      finishedAt: success || failed ? timestamp(last) ?? latest.info.mtime.toISOString() : null,
      error };
  } catch (error) {
    logger.warn({ err: error }, 'Could not read backup history');
    return { state: 'never', source: null, startedAt: null, finishedAt: null, error: null };
  }
}

export const isBackupNowRunning = () => manualRunning;

export async function startBackupNow(): Promise<{ status: 'started'; startedAt: string }> {
  if (manualRunning) throw Conflict('A manual backup is already running.');
  if (!existsSync(MANUAL_SCRIPT) || !existsSync(resolve(process.cwd(), '..', 'deploy', 'backup-db.sh')) || process.platform !== 'linux') {
    throw new AppError(503, 'Server backup script is unavailable.', 'BACKUP_UNAVAILABLE');
  }
  const startedAt = new Date().toISOString();
  const stamp = startedAt.slice(0, 19).replace('T', '_').replaceAll(':', '');
  const path = join(BACKUP_DIR, `jssf_backup_manual_${stamp}_${randomUUID()}.log`);
  manualRunning = true;
  let fd: number;
  try {
    await mkdir(BACKUP_DIR, { recursive: true });
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    manualRunning = false;
    logger.error({ err: error }, 'Backup directory is not writable');
    throw new AppError(503, 'The API user cannot write to the server backup directory.', 'BACKUP_UNAVAILABLE');
  }
  try {
    writeSync(fd, `${startedAt} BACKUP_NOW_STARTED\n`);
    const child = spawn('/usr/bin/bash', [MANUAL_SCRIPT], {
      cwd: homedir(), stdio: ['ignore', fd, fd], detached: true,
    });
    closeSync(fd);
    child.once('close', () => { manualRunning = false; });
    child.once('error', error => {
      manualRunning = false;
      try { appendFileSync(path, `${new Date().toISOString()} ERROR: BACKUP_NOW_FAILED (${error.message})\n`); }
      catch (logError) { logger.error({ err: logError }, 'Could not record Backup Now startup failure'); }
      logger.error({ err: error }, 'Backup Now could not start');
    });
    await new Promise<void>((resolveStart, rejectStart) => {
      child.once('spawn', resolveStart);
      child.once('error', rejectStart);
    });
    child.unref();
    return { status: 'started', startedAt };
  } catch (error) {
    manualRunning = false;
    try { closeSync(fd); } catch { /* already closed */ }
    logger.error({ err: error }, 'Backup Now failed to start');
    throw new AppError(503, 'Could not start the server backup script.', 'BACKUP_UNAVAILABLE');
  }
}
