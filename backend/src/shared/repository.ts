import { PoolClient, QueryResultRow } from 'pg';
import { pool, query } from '../db/pool';

/**
 * Base repository — the only place that talks SQL for its table.
 * Services depend on repositories, never on `pg` directly (Repository Pattern).
 * Accepts an optional PoolClient so calls can participate in an outer transaction.
 */
export abstract class BaseRepository<T extends QueryResultRow> {
  protected abstract table: string;

  protected exec<R extends QueryResultRow = T>(
    text: string,
    params?: unknown[],
    client?: PoolClient,
  ) {
    if (client) return client.query<R>(text, params as any[]);
    return query<R>(text, params);
  }

  async findById(id: string, client?: PoolClient): Promise<T | null> {
    const { rows } = await this.exec<T>(`SELECT * FROM ${this.table} WHERE id = $1`, [id], client);
    return rows[0] ?? null;
  }

  async all(client?: PoolClient): Promise<T[]> {
    const { rows } = await this.exec<T>(`SELECT * FROM ${this.table} ORDER BY created_at DESC`, [], client);
    return rows;
  }

  async deleteById(id: string, client?: PoolClient): Promise<void> {
    await this.exec(`DELETE FROM ${this.table} WHERE id = $1`, [id], client);
  }
}

export { pool };
