import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { env } from '../../config/env';

// Build the complete archive before returning it. A failed pg_dump must never
// be presented to the browser as a successful, partial backup.
export function postgresCommandConfig(): { database: string; pgEnv: NodeJS.ProcessEnv } {
  const pgEnv: NodeJS.ProcessEnv = { ...process.env, PGSSLMODE: env.PGSSLMODE };
  // These libpq variables can silently override the host selected by the app.
  delete pgEnv.PGHOSTADDR;
  delete pgEnv.PGSERVICE;
  let database = env.PGDATABASE;
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    pgEnv.PGHOST = url.hostname;
    pgEnv.PGPORT = url.port || '5432';
    pgEnv.PGUSER = decodeURIComponent(url.username);
    pgEnv.PGPASSWORD = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } else {
    pgEnv.PGHOST = env.PGHOST;
    pgEnv.PGPORT = String(env.PGPORT);
    pgEnv.PGUSER = env.PGUSER;
    pgEnv.PGPASSWORD = env.PGPASSWORD;
  }
  pgEnv.PGPASSWORD = pgEnv.PGPASSWORD || '';
  return { database, pgEnv };
}

export async function writeDatabaseExport(path: string): Promise<{ database: string; host: string }> {
  const { database, pgEnv } = postgresCommandConfig();
  const dump = spawn('pg_dump', ['--no-owner', '--no-privileges', '--dbname', database], {
    env: pgEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  dump.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
  const completed = new Promise<void>((resolve, reject) => {
    dump.on('error', reject);
    dump.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `pg_dump exited with ${code}`)));
  });
  await Promise.all([pipeline(dump.stdout, createGzip(), createWriteStream(path)), completed]);
  return { database, host: pgEnv.PGHOST || 'localhost' };
}

export async function createDatabaseExport(): Promise<{ filename: string; path: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'jssf-export-'));
  const filename = `jssf_${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`;
  const path = join(directory, filename);

  try {
    await writeDatabaseExport(path);
    return { filename, path, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
