import { PoolClient } from 'pg';
import { query } from '../../db/pool';

export interface CapitalEntryInput {
  accountId: string;
  sourceType: 'owner_capital' | 'external_loan' | 'other';
  contributorName: string;
  amount: number;
  entryDate: string;
  note?: string | null;
  createdBy: string;
}

export interface CapitalWithdrawalInput {
  accountId: string;
  amount: number;
  withdrawalDate: string;
  note?: string | null;
  createdBy: string;
}

export const capitalRepository = {
  async create(input: CapitalEntryInput, client: PoolClient): Promise<{ id: string }> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO capital_entries(account_id, source_type, contributor_name, amount, entry_date, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        input.accountId,
        input.sourceType,
        input.contributorName,
        input.amount,
        input.entryDate,
        input.note ?? null,
        input.createdBy,
      ],
    );
    return rows[0];
  },

  async list() {
    const { rows } = await query(
      `SELECT ce.*, a.name AS account_name, a.type AS account_type
         FROM capital_entries ce JOIN accounts a ON a.id = ce.account_id
        ORDER BY ce.entry_date DESC, ce.created_at DESC`,
    );
    return rows;
  },

  async totalIntroduced(): Promise<number> {
    const { rows } = await query<{ s: string }>(`SELECT COALESCE(sum(amount),0)::text AS s FROM capital_entries`);
    return Number(rows[0].s);
  },

  async createWithdrawal(input: CapitalWithdrawalInput, client: PoolClient): Promise<{ id: string }> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO capital_withdrawals(account_id, amount, withdrawal_date, note, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.accountId, input.amount, input.withdrawalDate, input.note ?? null, input.createdBy],
    );
    return rows[0];
  },

  async listWithdrawals() {
    const { rows } = await query(
      `SELECT cw.*, a.name AS account_name, a.type AS account_type
         FROM capital_withdrawals cw JOIN accounts a ON a.id = cw.account_id
        ORDER BY cw.withdrawal_date DESC, cw.created_at DESC`,
    );
    return rows;
  },

  async totalWithdrawn(): Promise<number> {
    const { rows } = await query<{ s: string }>(
      `SELECT COALESCE(sum(amount),0)::text AS s FROM capital_withdrawals`,
    );
    return Number(rows[0].s);
  },
};
