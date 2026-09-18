import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { query } from '../../db/pool';
import { BadRequest, Conflict } from '../../shared/errors';
import { postgresCommandConfig } from './database-export';

const DISK_RESERVE_BYTES = 512 * 1024 * 1024;

async function assertFreshInstall() {
  const { rows } = await query<{ has_data: boolean }>(`
    SELECT EXISTS(SELECT 1 FROM customers) OR EXISTS(SELECT 1 FROM loans)
      OR EXISTS(SELECT 1 FROM collections) OR EXISTS(SELECT 1 FROM expenses)
      OR EXISTS(SELECT 1 FROM salaries) OR EXISTS(SELECT 1 FROM capital_entries)
      OR EXISTS(SELECT 1 FROM account_transactions) OR EXISTS(SELECT 1 FROM agent_ledger)
      OR EXISTS(SELECT 1 FROM approval_requests)
      OR (SELECT count(*) FROM users) > 1 AS has_data
  `);
  if (rows[0]?.has_data) {
    throw Conflict('Restore is available only on a new installation before business data is entered.');
  }
}

async function runPsql(sqlPath: string, createPublicSchema: boolean): Promise<void> {
  const { database, pgEnv } = postgresCommandConfig();
  const resetSchema = 'DROP SCHEMA IF EXISTS public CASCADE;' +
    (createPublicSchema ? ' CREATE SCHEMA public;' : '');
  const args = ['--no-psqlrc', '--single-transaction', '--set', 'ON_ERROR_STOP=1',
    '--dbname', database, '--command', resetSchema, '--file', sqlPath];
  const child = spawn('psql', args, { env: pgEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `psql exited with ${code}`)));
  });
}

export async function restoreDatabase(uploadPath: string): Promise<void> {
  await assertFreshInstall();
  const disk = await statfs(tmpdir());
  const maxSqlBytes = Number(disk.bavail) * Number(disk.bsize) - DISK_RESERVE_BYTES;
  if (maxSqlBytes <= 0) throw Conflict('The server does not have enough temporary disk space to restore this backup.');
  const directory = await mkdtemp(join(tmpdir(), 'jssf-restore-'));
  const sqlPath = join(directory, 'restore.sql');
  let bytes = 0;
  try {
    await pipeline(
      createReadStream(uploadPath),
      createGunzip(),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          callback(bytes > maxSqlBytes ? Conflict('The server does not have enough temporary disk space to restore this backup.') : null, chunk);
        },
      }),
      createWriteStream(sqlPath),
    );
    const file = await open(sqlPath, 'r');
    const prefix = Buffer.alloc(256_000);
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    await file.close();
    const header = prefix.toString('utf8', 0, bytesRead);
    if (!header.startsWith('--\n-- PostgreSQL database dump') || !header.includes('-- Dumped by pg_dump version')) {
      throw BadRequest('Select a PostgreSQL .sql.gz backup created by this application.');
    }
    // pg_dump can include psql meta commands. Only its data terminator and
    // version-specific restricted-mode markers are needed for this format.
    let inCopyData = false;
    let createsPublicSchema = false;
    for await (const line of createInterface({ input: createReadStream(sqlPath), crlfDelay: Infinity })) {
      if (inCopyData) {
        if (line === '\\.') inCopyData = false;
        continue;
      }
      if (/^COPY\s+.+\s+FROM stdin;$/i.test(line)) {
        inCopyData = true;
        continue;
      }
      if (/^CREATE SCHEMA (?:IF NOT EXISTS )?(?:"public"|public)\s*;/i.test(line)) createsPublicSchema = true;
      if (line.startsWith('\\') && !/^\\(?:restrict|unrestrict)(?:\s|$)/.test(line)) {
        throw BadRequest('Backup contains unsupported psql commands.');
      }
    }
    if (inCopyData) throw BadRequest('Backup has an incomplete COPY data section.');
    await assertFreshInstall();
    await runPsql(sqlPath, !createsPublicSchema);
  } catch (error) {
    if (error instanceof Error && ['Z_DATA_ERROR', 'Z_BUF_ERROR'].includes((error as NodeJS.ErrnoException).code || '')) {
      throw BadRequest('Backup file is not a valid gzip archive.');
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
