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
      `SELECT * FROM (
         SELECT e.id, ec.name AS category_name, e.amount::text, e.mode::text,
                e.expense_date, e.description, u.full_name AS created_by_name, e.created_at
           FROM expenses e
           LEFT JOIN expense_categories ec ON ec.id = e.category_id
           LEFT JOIN users u ON u.id = e.created_by
         UNION ALL
         SELECT p.id, 'Borrowed Loan Interest' AS category_name, p.interest_amount::text,
                CASE WHEN a.type='cash' THEN 'cash' ELSE 'bank_transfer' END AS mode,
                p.payment_date AS expense_date,
                ('Interest paid to ' || bl.lender_name) AS description,
                u.full_name AS created_by_name, p.created_at
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
