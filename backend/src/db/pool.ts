import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Single shared connection pool. All DB access flows through here so we get
 * consistent logging, pooling limits, and a single place to add read-replicas later.
 */
export const pool = new Pool(
  env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL, max: env.PG_POOL_MAX }
    : {
        host: env.PGHOST,
        port: env.PGPORT,
        user: env.PGUSER,
        password: env.PGPASSWORD,
        database: env.PGDATABASE,
        max: env.PG_POOL_MAX,
      },
);

pool.on('error', (err) => logger.error({ err }, 'Unexpected idle PG client error'));

/** Convenience typed query helper. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  const res = await pool.query<T>(text, params as any[]);
  logger.debug({ ms: Date.now() - start, rows: res.rowCount }, text.split('\n')[0]?.trim());
  return res;
}

/**
 * Run a set of statements inside a single transaction. Any thrown error rolls back.
 * Used by money-moving flows (disbursement, collection, salary) for atomicity.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
