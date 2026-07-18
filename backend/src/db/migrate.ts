import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './pool';
import { logger } from '../config/logger';

/**
 * Minimal, dependency-free migration runner.
 * Applies every *.sql in migrations/ in filename order, once, tracked in _migrations.
 */
async function run() {
  const dir = join(__dirname, 'migrations');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM _migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      logger.info(`↷ skip ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info(`✔ applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err }, `x failed ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
  logger.info('Migrations complete.');
  await pool.end();
}

run().catch((err) => {
  logger.error({ err }, 'Migration run failed');
  process.exit(1);
});
