import { PoolClient } from 'pg';
import { query } from '../../db/pool';
import { CreateSalaryBody } from './salary.schema';

export const salaryRepository = {
  async list() {
    const { rows } = await query(
      `SELECT s.*, u.full_name AS staff_name, r.name AS role_name, cb.full_name AS created_by_name
         FROM salaries s
         JOIN users u ON u.id = s.user_id
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN users cb ON cb.id = s.created_by
        ORDER BY s.period_year DESC, s.period_month DESC, s.created_at DESC
        LIMIT 300`,
    );
    return rows;
  },

  async findForPeriod(userId: string, year: number, month: number, client: PoolClient) {
    const { rows } = await client.query(
      `SELECT id FROM salaries WHERE user_id = $1 AND period_year = $2 AND period_month = $3`,
      [userId, year, month],
    );
    return rows[0] ?? null;
  },

  async create(input: CreateSalaryBody & { finalSalary: number; createdBy: string }, client: PoolClient) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO salaries(user_id, period_year, period_month, base_salary, cash_short_deduct,
                            advance_deduct, expense_deduct, final_salary, mode, paid_at, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        input.userId,
        input.periodYear,
        input.periodMonth,
        input.baseSalary,
        input.cashShortDeduct,
        input.advanceDeduct,
        input.expenseDeduct,
        input.finalSalary,
        input.mode,
        input.paidDate,
        input.note ?? null,
        input.createdBy,
      ],
    );
    return rows[0];
  },

  async remove(id: string, client: PoolClient) {
    const { rows } = await client.query(`DELETE FROM salaries WHERE id = $1 RETURNING *`, [id]);
    return rows[0] ?? null;
  },
};
