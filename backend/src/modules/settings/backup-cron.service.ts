import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from '../../shared/errors';
import { logger } from '../../config/logger';

const run = promisify(execFile);
const HELPER = '/usr/local/sbin/jssf-backup-cron';
type BackupRunState = 'running' | 'success' | 'failed' | 'unknown' | 'never';

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
    return { available: false, enabled: false, time: '02:17', scriptPath: null, timezone: null, lastRun: null,
      message: 'Server cron setup is missing. Run deploy/install-backup-cron-helper.sh on the server once.' };
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
