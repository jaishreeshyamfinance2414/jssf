import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error('Usage: node dist/scripts/backup-dump.js <archive-path>|--show-target');
  // Cron and the API process can inherit different PG* variables. The backup
  // must follow the server's backend/.env in both cases.
  for (const key of ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE']) {
    delete process.env[key];
  }
  const loaded = config({ path: resolve(process.cwd(), '.env'), override: true });
  if (loaded.error) throw loaded.error;
  if (!loaded.parsed?.DATABASE_URL && !loaded.parsed?.PGDATABASE) {
    throw new Error('backend/.env must set DATABASE_URL or PGDATABASE for backups');
  }
  const { postgresCommandConfig, writeDatabaseExport } = require('../modules/settings/database-export') as typeof import('../modules/settings/database-export');
  if (target === '--show-target') {
    const { database, pgEnv } = postgresCommandConfig();
    process.stdout.write(`configured database ${database} on ${pgEnv.PGHOST || 'localhost'}\n`);
    return;
  }
  const path = resolve(target);
  try {
    const { database, host } = await writeDatabaseExport(path);
    // Log the selected target, but never its password or connection URL.
    process.stdout.write(`dumped configured database ${database} on ${host}\n`);
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
