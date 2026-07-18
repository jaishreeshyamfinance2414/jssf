import { PoolClient } from 'pg';
import { query } from '../../db/pool';
import { CreateExpenseBody } from './expense.schema';

export const expenseRepository = {
  async categories() {
    const { rows } = await query(`SELECT * FROM expense_categories ORDER BY name`);
    return rows;
  },

  async list() {
    const { rows } = await query(
      `SELECT e.*, ec.name AS category_name, u.full_name AS created_by_name
         FROM expenses e
         LEFT JOIN expense_categories ec ON ec.id = e.category_id
         LEFT JOIN users u ON u.id = e.created_by
        ORDER BY e.expense_date DESC, e.created_at DESC
        LIMIT 300`,
    );
    return rows;
  },

  async create(input: CreateExpenseBody & { createdBy: string }, client: PoolClient) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO expenses(category_id, amount, mode, expense_date, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [
        input.categoryId ?? null,
        input.amount,
        input.mode,
        input.expenseDate,
        input.description,
        input.createdBy,
      ],
    );
    return rows[0];
  },
};
