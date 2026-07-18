import { PoolClient } from 'pg';
import { query } from '../../db/pool';

export interface AccountRow {
  id: string;
  branch_id: string;
  name: string;
  type: 'cash' | 'bank';
  is_active: boolean;
}

export const accountsRepository = {
  /** Fetch the single active account of a type for a branch (or the only branch, for now). */
  async getByType(type: 'cash' | 'bank', client?: PoolClient): Promise<AccountRow> {
    const sql = `SELECT * FROM accounts WHERE type = $1 AND is_active = true ORDER BY created_at LIMIT 1`;
    const { rows } = client ? await client.query<AccountRow>(sql, [type]) : await query<AccountRow>(sql, [type]);
    if (!rows[0]) throw new Error(`No active '${type}' account configured`);
    return rows[0];
  },

  /** Lock the account row for the duration of the caller's transaction. */
  async lockForUpdate(accountId: string, client: PoolClient): Promise<AccountRow> {
    const { rows } = await client.query<AccountRow>(
      `SELECT * FROM accounts WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    if (!rows[0]) throw new Error('Account not found');
    return rows[0];
  },

  /** Current balance = SUM(credit) - SUM(debit). Pass the tx client to read within a lock. */
  async getBalance(accountId: string, client?: PoolClient): Promise<number> {
    const sql = `
      SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::text AS balance
      FROM account_transactions WHERE account_id = $1`;
    const { rows } = client
      ? await client.query<{ balance: string }>(sql, [accountId])
      : await query<{ balance: string }>(sql, [accountId]);
    return Number(rows[0].balance);
  },

  async listWithBalances(): Promise<Array<AccountRow & { balance: number }>> {
    const { rows } = await query<AccountRow & { balance: string }>(
      `SELECT a.*, COALESCE(SUM(CASE WHEN t.direction='credit' THEN t.amount ELSE -t.amount END), 0)::text AS balance
         FROM accounts a
         LEFT JOIN account_transactions t ON t.account_id = a.id
        WHERE a.is_active = true
        GROUP BY a.id
        ORDER BY a.type`,
    );
    return rows.map((r) => ({ ...r, balance: Number(r.balance) }));
  },

  async totalAvailableBalance(client?: PoolClient): Promise<number> {
    const sql = `
      SELECT COALESCE(SUM(CASE WHEN t.direction='credit' THEN t.amount ELSE -t.amount END), 0)::text AS balance
        FROM accounts a
        LEFT JOIN account_transactions t ON t.account_id = a.id
       WHERE a.is_active = true`;
    const { rows } = client
      ? await client.query<{ balance: string }>(sql)
      : await query<{ balance: string }>(sql);
    return Number(rows[0].balance);
  },

  /** Remove the ledger rows posted for a source record that is being deleted (e.g. a reversed collection). */
  async deleteBySourceRef(source: string, referenceId: string, client: PoolClient): Promise<void> {
    await client.query(
      `DELETE FROM account_transactions WHERE source = $1 AND reference_id = $2`,
      [source, referenceId],
    );
  },

  /** Mirror an admin edit of the source record into its ledger row (no-op when none was posted). */
  async updateBySourceRef(
    source: string,
    referenceId: string,
    input: { amount: number; txnDate: string | null },
    client: PoolClient,
  ): Promise<void> {
    await client.query(
      `UPDATE account_transactions
          SET amount = $3, txn_date = COALESCE($4::date, txn_date)
        WHERE source = $1 AND reference_id = $2`,
      [source, referenceId, input.amount, input.txnDate],
    );
  },

  async transactionsFor(accountId: string) {
    const { rows } = await query(
      `SELECT *, SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END)
                 OVER (ORDER BY txn_date, created_at
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::text AS running_balance
         FROM account_transactions
        WHERE account_id = $1
        ORDER BY txn_date DESC, created_at DESC
        LIMIT 200`,
      [accountId],
    );
    return rows;
  },
};
