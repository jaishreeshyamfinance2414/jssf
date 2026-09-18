import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '../../shared/errors';
import { logger } from '../../config/logger';

const run = promisify(execFile);
const HELPER = '/usr/local/sbin/jssf-backup-cron';
type BackupRunState = 'running' | 'success' | 'failed' | 'unknown' | 'never';
type LastRun = NonNullable<BackupCronStatus['lastRun']>;

async function helper(args: string[]) {
  return run('sudo', ['-n', HELPER, ...args], { timeout: 5000, maxBuffer: 64 * 1024 });
}

export interface BackupCronStatus {
  available: boolean;
  enabled: boolean;
  time: string;
  scriptPath: string | null;
  timezone: string | null;
  lastRun: {
    state: BackupRunState;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
  } | null;
  message?: string;
}

async function latestReadableBackupLog(): Promise<LastRun | null> {
  // The older cron writes per-run logs here. Read only named backup logs from
  // the PM2 user's backup directory; root-only logs still require the helper.
  const directory = join(homedir(), 'backups');
  try {
    const names = (await readdir(directory)).filter(name => /^jssf_backup_\d{4}-\d{2}-\d{2}_\d{4}\.log$/.test(name));
    const files = await Promise.all(names.map(async name => ({ name, info: await stat(join(directory, name)) })));
    files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    const latest = files[0];
    if (!latest) return null;
    const data = await readFile(join(directory, latest.name), 'utf8');
    const lines = data.slice(-64 * 1024).split(/\r?\n/).filter(Boolean);
    const last = lines.at(-1) ?? '';
    const timestamp = last.match(/^\d{4}-\d{2}-\d{2}T\S+/)?.[0];
    const finishedAt = timestamp && !Number.isNaN(Date.parse(timestamp))
      ? new Date(timestamp).toISOString() : latest.info.mtime.toISOString();
    const state: BackupRunState = last.includes('backup completed successfully') ? 'success'
      : last.includes('ERROR:') ? 'failed' : 'unknown';
    const error = state === 'failed'
      ? lines.filter(line => line.includes('ERROR:')).slice(-4).join('\n').slice(0, 2000) : null;
    return { state, startedAt: null, finishedAt, error };
  } catch (error) {
    logger.debug({ err: error }, 'No readable legacy backup log');
    return null;
  }
}

export async function backupCronStatus(): Promise<BackupCronStatus> {
  try {
    const { stdout } = await helper(['status']);
    const match = /^(enabled|disabled)\t([0-2]\d:[0-5]\d)\t(\/[^\r\n\t]+)\t([^\r\n\t]+)$/.exec(stdout.trim());
    if (!match) throw new Error('Unexpected backup cron helper output');
    const { stdout: lastOutput } = await helper(['last-run']);
    const fields = lastOutput.trim().split('\t');
    if (fields.length !== 4 || !['running', 'success', 'failed', 'unknown', 'never'].includes(fields[0])) {
      throw new Error('Unexpected backup run status');
    }
    return { available: true, enabled: match[1] === 'enabled', time: match[2], scriptPath: match[3], timezone: match[4],
      lastRun: { state: fields[0] as BackupRunState,
        startedAt: fields[1] === '-' ? null : fields[1],
        finishedAt: fields[2] === '-' ? null : fields[2],
        error: fields[3] === '-' ? null : Buffer.from(fields[3], 'base64').toString('utf8').slice(0, 2000) } };
  } catch (error) {
    logger.warn({ err: error }, 'Backup cron helper unavailable');
    const installed = existsSync(HELPER);
    return { available: false, enabled: false, time: '02:17', scriptPath: null, timezone: null,
      lastRun: await latestReadableBackupLog(),
      message: installed
        ? 'Cron helper exists, but the API cannot access root crontab. Check the PM2 user and sudoers setup.'
        : 'Root cron access has not been installed for the app. Run the one-time server setup command shown below.' };
  }
}

export async function setBackupCron(enabled: boolean, time: string): Promise<BackupCronStatus> {
  const [hour, minute] = time.split(':');
  try {
    await helper(['set', enabled ? 'enabled' : 'disabled', hour, minute]);
  } catch (error) {
    logger.error({ err: error }, 'Could not update root backup cron');
    throw new AppError(503, 'Could not update root crontab. Check the server cron helper setup.', 'CRON_UNAVAILABLE');
  }
  const status = await backupCronStatus();
  if (!status.available || status.enabled !== enabled) {
    throw new AppError(503, 'Root crontab change could not be verified.', 'CRON_UNAVAILABLE');
  }
  return status;
}
