import { PoolClient } from 'pg';
import { query } from '../../db/pool';
import { CreateExpenseBody } from './expense.schema';

export const expenseRepository = {
  async categories() {
    const { rows } = await query(`SELECT * FROM expense_categories ORDER BY name`);
    return rows;
  },

  async activeUsers() {
    const { rows } = await query(
      `SELECT u.id, u.full_name, r.name AS role_name
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.is_active = true
        ORDER BY u.full_name`,
    );
    return rows;
  },

  async categoryName(categoryId: string | null | undefined, client: PoolClient) {
    if (!categoryId) return null;
    const { rows } = await client.query<{ name: string }>(
      `SELECT name FROM expense_categories WHERE id = $1`,
      [categoryId],
    );
    return rows[0]?.name ?? null;
  },

  async activeUser(userId: string, client: PoolClient) {
    const { rows } = await client.query(`SELECT id FROM users WHERE id = $1 AND is_active = true`, [userId]);
    return rows[0] ?? null;
  },

  async list() {
    const { rows } = await query(
      `SELECT * FROM (
         SELECT e.id, ec.name AS category_name, e.amount::text, e.mode::text,
                e.expense_date, e.description, u.full_name AS created_by_name,
                beneficiary.full_name AS user_name, e.created_at
           FROM expenses e
           LEFT JOIN expense_categories ec ON ec.id = e.category_id
           LEFT JOIN users u ON u.id = e.created_by
           LEFT JOIN users beneficiary ON beneficiary.id = e.user_id
         UNION ALL
         SELECT p.id, 'Borrowed Loan Interest' AS category_name, p.interest_amount::text,
                CASE WHEN a.type='cash' THEN 'cash' ELSE 'bank_transfer' END AS mode,
                p.payment_date AS expense_date,
                ('Interest paid to ' || bl.lender_name) AS description,
                u.full_name AS created_by_name, NULL::text AS user_name, p.created_at
           FROM borrowed_loan_payments p
           JOIN borrowed_loans bl ON bl.id=p.loan_id
           JOIN accounts a ON a.id=p.account_id
           LEFT JOIN users u ON u.id=p.created_by
          WHERE p.interest_amount > 0
       ) expense_rows
        ORDER BY expense_date DESC, created_at DESC
        LIMIT 300`,
    );
    return rows;
  },

  async create(input: CreateExpenseBody & { createdBy: string }, client: PoolClient) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO expenses(category_id, user_id, amount, mode, expense_date, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        input.categoryId ?? null,
        input.userId ?? null,
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
