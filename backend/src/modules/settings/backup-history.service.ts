import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, openSync } from 'node:fs';
import { mkdir, open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AppError, Conflict } from '../../shared/errors';
import { logger } from '../../config/logger';

const BACKUP_DIR = join(homedir(), 'backups');
const BACKUP_LOG = join(BACKUP_DIR, 'backup.log');
const MANUAL_SCRIPT = resolve(process.cwd(), '..', 'deploy', 'backup-now.sh');
const RUN_MARKER = /BACKUP_RUN_(STARTED|SUCCESS|FAILED) id=(\S+) source=(scheduled|manual)/;
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
    const count = Math.min(size, 128 * 1024);
    const buffer = Buffer.alloc(count);
    await file.read(buffer, 0, count, size - count);
    return buffer.toString('utf8');
  } finally { await file.close(); }
}

export async function backupHistory(): Promise<BackupHistory> {
  try {
    const info = await stat(BACKUP_LOG);
    const content = await tail(BACKUP_LOG, info.size);
    const lines = content.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return { state: 'never', source: null, startedAt: null, finishedAt: null, error: null };

    // New runs have a unique ID so concurrent cron and manual attempts cannot
    // make the UI attribute one run's result to another.
    for (let i = lines.length - 1; i >= 0; i--) {
      const marker = lines[i].match(RUN_MARKER);
      if (!marker) continue;
      const [, event, id, source] = marker;
      let startIndex = i;
      for (let j = i; j >= 0; j--) {
        const candidate = lines[j].match(RUN_MARKER);
        if (candidate?.[1] === 'STARTED' && candidate[2] === id) { startIndex = j; break; }
      }
      const startedAt = timestamp(lines[startIndex]) ?? null;
      const finishedAt = event === 'STARTED' ? null : timestamp(lines[i]) ?? info.mtime.toISOString();
      const state: BackupHistory['state'] = event === 'SUCCESS' ? 'success' : event === 'FAILED' ? 'failed'
        : Date.now() - Date.parse(startedAt ?? info.mtime.toISOString()) < 4 * 60 * 60 * 1000 ? 'running' : 'unknown';
      const runLines = lines.slice(startIndex, i + 1);
      const errors = runLines.filter(line => /error:|denied|fatal:/i.test(line));
      return {
        state, source: source as BackupHistory['source'], startedAt, finishedAt,
        error: state === 'failed' || state === 'unknown'
          ? (errors.length ? errors.slice(-4) : runLines.slice(-4)).join('\n').slice(-2000)
          : null,
      };
    }

    // Read the existing cron log until the first run with explicit markers.
    const last = lines.at(-1) ?? '';
    const success = last.includes('backup completed successfully');
    const failed = /ERROR:|fatal:/i.test(last);
    const state: BackupHistory['state'] = success ? 'success' : failed ? 'failed'
      : Date.now() - info.mtimeMs < 4 * 60 * 60 * 1000 ? 'running' : 'unknown';
    const errors = lines.filter(line => /error:|denied|fatal:/i.test(line));
    return { state, source: 'scheduled', startedAt: state === 'running' ? info.mtime.toISOString() : null,
      finishedAt: success || failed ? timestamp(last) ?? info.mtime.toISOString() : null,
      error: state === 'failed' || state === 'unknown'
        ? (errors.length ? errors.slice(-4) : lines.slice(-4)).join('\n').slice(-2000)
        : null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: 'never', source: null, startedAt: null, finishedAt: null, error: null };
    }
    logger.warn({ err: error }, 'Could not read backup history');
    return { state: 'unknown', source: null, startedAt: null, finishedAt: null,
      error: 'The server could not read backup.log.' };
  }
}

export const isBackupNowRunning = () => manualRunning;

export async function startBackupNow(): Promise<{ status: 'started'; startedAt: string }> {
  if (manualRunning) throw Conflict('A manual backup is already running.');
  if (!existsSync(MANUAL_SCRIPT) || !existsSync(resolve(process.cwd(), '..', 'deploy', 'backup-db.sh')) || process.platform !== 'linux') {
    throw new AppError(503, 'Server backup script is unavailable.', 'BACKUP_UNAVAILABLE');
  }
  const startedAt = new Date().toISOString();
  manualRunning = true;
  let fd: number;
  try {
    await mkdir(BACKUP_DIR, { recursive: true });
    fd = openSync(BACKUP_LOG, 'a', 0o664);
  } catch (error) {
    manualRunning = false;
    logger.error({ err: error }, 'Backup directory is not writable');
    throw new AppError(503, 'The API user cannot write to the server backup directory.', 'BACKUP_UNAVAILABLE');
  }
  try {
    const child = spawn('/usr/bin/bash', [MANUAL_SCRIPT], {
      cwd: homedir(), stdio: ['ignore', fd, fd], detached: true,
    });
    closeSync(fd);
    child.once('close', () => { manualRunning = false; });
    child.once('error', error => {
      manualRunning = false;
      try {
        const at = new Date().toISOString();
        appendFileSync(BACKUP_LOG, `${at} ERROR: Backup Now failed to start (${error.message})\n${at} BACKUP_RUN_FAILED id=api-${Date.now()} source=manual exit=spawn\n`);
      }
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
