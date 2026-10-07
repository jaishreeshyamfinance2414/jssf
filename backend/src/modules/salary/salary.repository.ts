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
              ms.monthly_salary::text, ms.payment_day, cycle.upcoming_salary_date AS salary_date,
              COALESCE(pending.total, 0)::text AS upcoming_expense_deduct,
              CASE WHEN ms.monthly_salary IS NULL THEN NULL
                   ELSE GREATEST(ms.monthly_salary - COALESCE(pending.total, 0), 0)::text
              END AS upcoming_payable,
              last_pay.paid_at AS last_paid_at
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN member_salaries ms ON ms.user_id = u.id
         LEFT JOIN LATERAL (
           SELECT date_trunc('month', CURRENT_DATE)::date AS month_start
         ) calendar ON true
         LEFT JOIN LATERAL (
           SELECT (
             calendar.month_start
             + (LEAST(ms.payment_day, EXTRACT(day FROM (calendar.month_start + interval '1 month - 1 day'))::int) - 1) * interval '1 day'
           )::date AS current_salary_date
         ) current_schedule ON true
         LEFT JOIN LATERAL (
           SELECT CASE
             WHEN ms.salary_date >= CURRENT_DATE THEN ms.salary_date
             WHEN CURRENT_DATE <= current_schedule.current_salary_date THEN current_schedule.current_salary_date
             ELSE (
               calendar.month_start + interval '1 month'
               + (LEAST(ms.payment_day, EXTRACT(day FROM (calendar.month_start + interval '2 months - 1 day'))::int) - 1) * interval '1 day'
             )::date
           END AS upcoming_salary_date
         ) upcoming ON true
         LEFT JOIN LATERAL (
           SELECT upcoming.upcoming_salary_date,
                  (
                    date_trunc('month', upcoming.upcoming_salary_date) - interval '1 month'
                    + (LEAST(ms.payment_day, EXTRACT(day FROM (date_trunc('month', upcoming.upcoming_salary_date) - interval '1 day'))::int) - 1) * interval '1 day'
                  )::date AS last_salary_date
         ) cycle ON true
         LEFT JOIN LATERAL (
           SELECT sum(item.remaining) AS total
             FROM (
               SELECT e.amount - COALESCE(sum(a.amount), 0) AS remaining
                 FROM expenses e
                LEFT JOIN salary_expense_allocations a ON a.expense_id = e.id
                WHERE e.user_id = u.id
                  AND e.expense_date >= cycle.last_salary_date
                  AND e.expense_date < cycle.upcoming_salary_date
                GROUP BY e.id
               HAVING e.amount - COALESCE(sum(a.amount), 0) > 0
             ) item
         ) pending ON true
         LEFT JOIN LATERAL (
           SELECT s.paid_at
             FROM salaries s WHERE s.user_id = u.id
            ORDER BY s.period_year DESC, s.period_month DESC LIMIT 1
         ) last_pay ON true
        WHERE u.is_active = true
        ORDER BY u.full_name`,
    );
    return rows;
  },

  async userExpenses(month: string) {
    const { rows } = await query(
      `SELECT e.id, u.id AS user_id, u.full_name AS staff_name, r.name AS role_name,
              e.expense_date::text, e.description, e.amount::text
         FROM expenses e
         JOIN users u ON u.id = e.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE e.expense_date >= ($1 || '-01')::date
          AND e.expense_date < (($1 || '-01')::date + interval '1 month')
        ORDER BY e.expense_date DESC, e.created_at DESC, u.full_name
        LIMIT 500`,
      [month],
    );
    return rows;
  },

  async upsertMember(input: { userId: string; monthlySalary: number; salaryDate: string; createdBy: string }) {
    const { rows } = await query(
      `INSERT INTO member_salaries(user_id, monthly_salary, payment_day, salary_date, created_by)
       SELECT u.id, $2, EXTRACT(day FROM $3::date)::int, $3::date, $4
         FROM users u WHERE u.id = $1 AND u.is_active = true
       ON CONFLICT (user_id) DO UPDATE
         SET monthly_salary = EXCLUDED.monthly_salary,
             payment_day = EXCLUDED.payment_day,
             salary_date = EXCLUDED.salary_date
       RETURNING user_id`,
      [input.userId, input.monthlySalary, input.salaryDate, input.createdBy],
    );
    return rows[0] ?? null;
  },

  async advanceSalaryDate(userId: string, salaryDate: string, client: PoolClient) {
    await client.query(
      `UPDATE member_salaries SET salary_date = GREATEST(salary_date, $2::date) WHERE user_id = $1`,
      [userId, salaryDate],
    );
  },

  async member(userId: string, client?: PoolClient) {
    const sql =
      `SELECT ms.monthly_salary::text, ms.payment_day, u.full_name,
              (SELECT count(*)::int FROM salaries s WHERE s.user_id = ms.user_id) AS salary_count
         FROM member_salaries ms JOIN users u ON u.id = ms.user_id
        WHERE ms.user_id = $1 AND u.is_active = true
        ${client ? 'FOR UPDATE OF ms' : ''}`;
    const { rows } = client
      ? await client.query<{ monthly_salary: string; payment_day: number; full_name: string; salary_count: number }>(sql, [userId])
      : await query<{ monthly_salary: string; payment_day: number; full_name: string; salary_count: number }>(sql, [userId]);
    return rows[0] ?? null;
  },

  async pendingExpenses(userId: string, afterDate: string, throughDate: string, client?: PoolClient) {
    const sql =
      `SELECT e.id, (e.amount - COALESCE(sum(a.amount), 0))::text AS remaining
         FROM expenses e
        LEFT JOIN salary_expense_allocations a ON a.expense_id = e.id
        WHERE e.user_id = $1
          AND e.expense_date >= $2::date
          AND e.expense_date < $3::date
        GROUP BY e.id
       HAVING e.amount - COALESCE(sum(a.amount), 0) > 0
        ORDER BY e.expense_date, e.created_at`;
    const { rows } = client
      ? await client.query<{ id: string; remaining: string }>(sql, [userId, afterDate, throughDate])
      : await query<{ id: string; remaining: string }>(sql, [userId, afterDate, throughDate]);
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
