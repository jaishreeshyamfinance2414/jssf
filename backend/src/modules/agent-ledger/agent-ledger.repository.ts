import { PoolClient } from 'pg';
import { query } from '../../db/pool';

export const agentLedgerRepository = {
  /** Pending (unreconciled cash) for ONE agent. */
  async pendingForAgent(agentId: string, client?: PoolClient): Promise<number> {
    const sql = `
      SELECT COALESCE(SUM(amount + penalty), 0)::text AS s
        FROM collections
       WHERE agent_id = $1 AND mode = 'cash' AND reconciled_at IS NULL`;
    const { rows } = client
      ? await client.query<{ s: string }>(sql, [agentId])
      : await query<{ s: string }>(sql, [agentId]);
    return Number(rows[0].s);
  },

  /** Pending (unreconciled cash) for ALL collection agents — one query, admin dashboard. */
  async pendingByAgent(): Promise<Array<{ agentId: string; agentName: string; pendingAmount: number }>> {
    const { rows } = await query<{ agent_id: string; agent_name: string; amount: string }>(
      `SELECT u.id AS agent_id, u.full_name AS agent_name,
              COALESCE(SUM(co.amount + co.penalty), 0)::text AS amount
         FROM users u
         JOIN roles r ON r.id = u.role_id AND r.name IN ('collection_agent', 'accounts_dept')
         LEFT JOIN collections co
                ON co.agent_id = u.id AND co.mode = 'cash' AND co.reconciled_at IS NULL
        WHERE u.is_active = true
        GROUP BY u.id, u.full_name
        ORDER BY u.full_name`,
    );
    return rows.map((r) => ({ agentId: r.agent_id, agentName: r.agent_name, pendingAmount: Number(r.amount) }));
  },

  /**
   * Lifetime shortfall total for one agent. NOTE (future salary module): sums
   * every shortfall ever recorded with no concept of "already deducted". When
   * salary payment is built, add an `agent_ledger.resolved_at` column and
   * filter `WHERE resolved_at IS NULL` here — do not build that now.
   */
  async lifetimeDue(agentId: string): Promise<number> {
    const { rows } = await query<{ s: string }>(
      `SELECT COALESCE(SUM(short_amount), 0)::text AS s FROM agent_ledger WHERE agent_id = $1`,
      [agentId],
    );
    return Number(rows[0].s);
  },

  /** Lifetime shortfall for ALL agents — one query, admin dashboard. */
  async lifetimeDueByAgent(): Promise<Array<{ agentId: string; dueAmount: number }>> {
    const { rows } = await query<{ agent_id: string; s: string }>(
      `SELECT agent_id, COALESCE(SUM(short_amount), 0)::text AS s
         FROM agent_ledger GROUP BY agent_id`,
    );
    return rows.map((r) => ({ agentId: r.agent_id, dueAmount: Number(r.s) }));
  },

  /** Lock + fetch the unreconciled cash collection rows for an agent, inside a handover transaction. */
  async unreconciledCollectionIds(agentId: string, client: PoolClient): Promise<{ ids: string[]; expected: number }> {
    const { rows } = await client.query<{ id: string; amount: string; penalty: string }>(
      `SELECT id, amount, penalty FROM collections
        WHERE agent_id = $1 AND mode = 'cash' AND reconciled_at IS NULL
        FOR UPDATE`,
      [agentId],
    );
    const expected = rows.reduce((sum, r) => sum + Number(r.amount) + Number(r.penalty), 0);
    return { ids: rows.map((r) => r.id), expected };
  },

  /** Agent's display name, inside a handover transaction. */
  async agentName(agentId: string, client: PoolClient): Promise<string | null> {
    const { rows } = await client.query<{ full_name: string }>(
      `SELECT full_name FROM users WHERE id = $1`,
      [agentId],
    );
    return rows[0]?.full_name ?? null;
  },

  async insertLedgerEntry(
    input: { agentId: string; expected: number; submitted: number; short: number; note?: string | null; createdBy: string },
    client: PoolClient,
  ): Promise<{ id: string }> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO agent_ledger(agent_id, expected_amount, submitted_amount, short_amount, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [input.agentId, input.expected, input.submitted, input.short, input.note ?? null, input.createdBy],
    );
    return rows[0];
  },

  /**
   * A collection reconciled under this handover was deleted (admin correction):
   * shrink the expected total and recompute the shortfall against what was
   * actually submitted. Submitted amount never changes — that cash was
   * physically received.
   */
  async reduceExpected(ledgerId: string, amount: number, client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE agent_ledger
          SET expected_amount = GREATEST(expected_amount - $2, 0),
              short_amount = GREATEST(GREATEST(expected_amount - $2, 0) - submitted_amount, 0)
        WHERE id = $1`,
      [ledgerId, amount],
    );
  },

  async markReconciled(collectionIds: string[], ledgerId: string, client: PoolClient): Promise<void> {
    if (!collectionIds.length) return;
    await client.query(
      `UPDATE collections SET reconciled_at = now(), agent_ledger_id = $2 WHERE id = ANY($1)`,
      [collectionIds, ledgerId],
    );
  },

  async history(agentId: string) {
    const { rows } = await query(
      `SELECT al.*, u.full_name AS created_by_name
         FROM agent_ledger al LEFT JOIN users u ON u.id = al.created_by
        WHERE al.agent_id = $1
        ORDER BY al.created_at DESC LIMIT 100`,
      [agentId],
    );
    return rows;
  },
};
