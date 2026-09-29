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

  async members() {
    const { rows } = await query(
      `SELECT u.id AS user_id, u.full_name AS staff_name, r.name AS role_name,
              ms.monthly_salary::text, ms.payment_day,
              last_pay.paid_at AS last_paid_at, last_pay.final_salary::text AS last_paid_amount,
              last_pay.period_year AS last_paid_year, last_pay.period_month AS last_paid_month
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN member_salaries ms ON ms.user_id = u.id
         LEFT JOIN LATERAL (
           SELECT s.paid_at, s.final_salary, s.period_year, s.period_month
             FROM salaries s WHERE s.user_id = u.id
            ORDER BY s.period_year DESC, s.period_month DESC LIMIT 1
         ) last_pay ON true
        WHERE u.is_active = true
        ORDER BY u.full_name`,
    );
    return rows;
  },

  async upsertMember(input: { userId: string; monthlySalary: number; paymentDay: number; createdBy: string }) {
    const { rows } = await query(
      `INSERT INTO member_salaries(user_id, monthly_salary, payment_day, created_by)
       SELECT u.id, $2, $3, $4 FROM users u WHERE u.id = $1 AND u.is_active = true
       ON CONFLICT (user_id) DO UPDATE
         SET monthly_salary = EXCLUDED.monthly_salary, payment_day = EXCLUDED.payment_day
       RETURNING user_id`,
      [input.userId, input.monthlySalary, input.paymentDay, input.createdBy],
    );
    return rows[0] ?? null;
  },

  async member(userId: string, client?: PoolClient) {
    const sql =
      `SELECT ms.monthly_salary::text, ms.payment_day
         FROM member_salaries ms JOIN users u ON u.id = ms.user_id
        WHERE ms.user_id = $1 AND u.is_active = true
        ${client ? 'FOR UPDATE OF ms' : ''}`;
    const { rows } = client
      ? await client.query<{ monthly_salary: string; payment_day: number }>(sql, [userId])
      : await query<{ monthly_salary: string; payment_day: number }>(sql, [userId]);
    return rows[0] ?? null;
  },

  async pendingExpenses(userId: string, year: number, month: number, client?: PoolClient) {
    const sql =
      `SELECT e.id, (e.amount - COALESCE(sum(a.amount), 0))::text AS remaining
         FROM expenses e
         LEFT JOIN salary_expense_allocations a ON a.expense_id = e.id
        WHERE e.user_id = $1
          AND e.expense_date < make_date($2, $3, 1)
        GROUP BY e.id
       HAVING e.amount - COALESCE(sum(a.amount), 0) > 0
        ORDER BY e.expense_date, e.created_at`;
    const { rows } = client
      ? await client.query<{ id: string; remaining: string }>(sql, [userId, year, month])
      : await query<{ id: string; remaining: string }>(sql, [userId, year, month]);
    return rows;
  },

  async findForPeriod(userId: string, year: number, month: number, client: PoolClient) {
    const { rows } = await client.query(
      `SELECT id FROM salaries WHERE user_id = $1 AND period_year = $2 AND period_month = $3`,
      [userId, year, month],
    );
    return rows[0] ?? null;
  },

  async create(input: CreateSalaryBody & { baseSalary: number; expenseDeduct: number; finalSalary: number; createdBy: string }, client: PoolClient) {
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

  async allocateExpenses(salaryId: string, expenses: Array<{ id: string; remaining: string }>, amount: number, client: PoolClient) {
    let left = amount;
    for (const expense of expenses) {
      const allocated = Math.min(left, Number(expense.remaining));
      if (allocated <= 0) break;
      await client.query(
        `INSERT INTO salary_expense_allocations(salary_id, expense_id, amount) VALUES ($1,$2,$3)`,
        [salaryId, expense.id, allocated],
      );
      left = Number((left - allocated).toFixed(2));
    }
  },

  async remove(id: string, client: PoolClient) {
    const { rows } = await client.query(`DELETE FROM salaries WHERE id = $1 RETURNING *`, [id]);
    return rows[0] ?? null;
  },
};
