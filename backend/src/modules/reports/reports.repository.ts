import { query } from '../../db/pool';

/**
 * Read-only reporting queries. Every report takes a from/to date range
 * (inclusive) and returns plain rows the frontend renders + exports as CSV.
 */
export const reportsRepository = {
  /** Income (collections, penalty) vs outgo (expenses, salaries) for the period. */
  async profitLoss(from: string, to: string) {
    const { rows } = await query<{
      collected: string;
      penalty_income: string;
      disbursed: string;
      interest_booked: string;
      expenses: string;
      salaries: string;
      capital_in: string;
    }>(
      `SELECT
         COALESCE((SELECT sum(amount) FROM collections
                    WHERE collected_at::date BETWEEN $1 AND $2), 0)::text AS collected,
         COALESCE((SELECT sum(penalty) FROM collections
                    WHERE collected_at::date BETWEEN $1 AND $2), 0)::text AS penalty_income,
         COALESCE((SELECT sum(principal) FROM loans
                    WHERE disbursed_at::date BETWEEN $1 AND $2), 0)::text AS disbursed,
         COALESCE((SELECT sum(interest_amount) FROM loans
                    WHERE disbursed_at::date BETWEEN $1 AND $2), 0)::text AS interest_booked,
         COALESCE((SELECT sum(amount) FROM expenses
                    WHERE expense_date BETWEEN $1 AND $2), 0)::text AS expenses,
         COALESCE((SELECT sum(final_salary) FROM salaries
                    WHERE paid_at::date BETWEEN $1 AND $2), 0)::text AS salaries,
         COALESCE((SELECT sum(amount) FROM capital_entries
                    WHERE entry_date BETWEEN $1 AND $2), 0)::text AS capital_in`,
      [from, to],
    );
    const r = rows[0];
    return {
      collected: Number(r.collected),
      penaltyIncome: Number(r.penalty_income),
      disbursed: Number(r.disbursed),
      interestBooked: Number(r.interest_booked),
      expenses: Number(r.expenses),
      salaries: Number(r.salaries),
      capitalIn: Number(r.capital_in),
    };
  },

  /** Day-by-day collection detail: cash vs digital, penalty, entry count. */
  async dailyCollection(from: string, to: string) {
    const { rows } = await query(
      `SELECT c.collected_at::date::text AS date,
              count(*) FILTER (WHERE c.type != 'missed') AS entries,
              count(*) FILTER (WHERE c.type = 'missed') AS missed_entries,
              COALESCE(sum(c.amount) FILTER (WHERE c.mode = 'cash'), 0)::text AS cash,
              COALESCE(sum(c.amount) FILTER (WHERE c.mode != 'cash'), 0)::text AS digital,
              COALESCE(sum(c.penalty), 0)::text AS penalty,
              COALESCE(sum(c.amount), 0)::text AS total
         FROM collections c
        WHERE c.collected_at::date BETWEEN $1 AND $2
        GROUP BY c.collected_at::date
        ORDER BY c.collected_at::date DESC`,
      [from, to],
    );
    return rows;
  },

  /** Loans carrying overdue EMIs as of today, worst first. */
  async missedEmi() {
    const { rows } = await query(
      `SELECT l.loan_number, cu.full_name AS customer_name, cu.mobile,
              COALESCE(a.name, 'Unassigned') AS area,
              count(*) AS missed_count,
              min(e.due_date)::text AS oldest_due,
              COALESCE(sum(e.due_amount - e.paid_amount), 0)::text AS overdue_amount,
              COALESCE(sum(e.missed_penalty), 0)::text AS penalty,
              GREATEST(0, l.total_payable - COALESCE((SELECT sum(amount) FROM collections WHERE loan_id = l.id), 0))::text AS loan_remaining
         FROM emi_schedule e
         JOIN loans l ON l.id = e.loan_id
         JOIN customers cu ON cu.id = l.customer_id
         LEFT JOIN areas a ON a.id = cu.area_id
        WHERE l.status = 'active'
          AND e.due_date < CURRENT_DATE
          AND e.status IN ('pending','partial','missed')
        GROUP BY l.id, l.loan_number, cu.full_name, cu.mobile, a.name
        ORDER BY count(*) DESC, sum(e.due_amount - e.paid_amount) DESC`,
    );
    return rows;
  },

  /** Full payment ledger for one customer across all their loans. */
  async customerLedger(customerId: string) {
    const { rows: customer } = await query(
      `SELECT c.id, c.file_number, c.full_name, c.mobile, COALESCE(a.name,'Unassigned') AS area
         FROM customers c LEFT JOIN areas a ON a.id = c.area_id
        WHERE c.id = $1`,
      [customerId],
    );
    const { rows: loans } = await query(
      `SELECT l.id, l.loan_number, l.principal::text, l.total_payable::text, l.status,
              l.loan_date::text, l.emi_amount::text, l.emi_frequency, l.tenure_count,
              COALESCE((SELECT sum(amount) FROM collections WHERE loan_id = l.id), 0)::text AS paid,
              GREATEST(0, l.total_payable - COALESCE((SELECT sum(amount) FROM collections WHERE loan_id = l.id), 0))::text AS remaining
         FROM loans l
        WHERE l.customer_id = $1
        ORDER BY l.created_at DESC`,
      [customerId],
    );
    const { rows: entries } = await query(
      `SELECT co.collected_at, l.loan_number, co.amount::text, co.penalty::text,
              co.type, co.mode, u.full_name AS agent_name
         FROM collections co
         JOIN loans l ON l.id = co.loan_id
         LEFT JOIN users u ON u.id = co.agent_id
        WHERE l.customer_id = $1
        ORDER BY co.collected_at DESC
        LIMIT 500`,
      [customerId],
    );
    return { customer: customer[0] ?? null, loans, entries };
  },

  /** Per-agent collection totals, entry counts and handover shortages. */
  async agentPerformance(from: string, to: string) {
    const { rows } = await query(
      `SELECT u.id AS agent_id, u.full_name AS agent,
              count(*) FILTER (WHERE c.type != 'missed') AS entries,
              count(DISTINCT c.loan_id) AS loans_touched,
              count(*) FILTER (WHERE c.type = 'missed') AS missed_marked,
              COALESCE(sum(c.amount) FILTER (WHERE c.mode = 'cash'), 0)::text AS cash,
              COALESCE(sum(c.amount) FILTER (WHERE c.mode != 'cash'), 0)::text AS digital,
              COALESCE(sum(c.amount), 0)::text AS total,
              COALESCE((SELECT sum(al.short_amount) FROM agent_ledger al
                         WHERE al.agent_id = u.id AND al.ledger_date BETWEEN $1 AND $2), 0)::text AS short_amount
         FROM collections c
         JOIN users u ON u.id = c.agent_id
        WHERE c.collected_at::date BETWEEN $1 AND $2
        GROUP BY u.id, u.full_name
        ORDER BY sum(c.amount) DESC`,
      [from, to],
    );
    return rows;
  },

  /** Cash & bank account transactions with running context. */
  async accountLedger(from: string, to: string) {
    const { rows } = await query(
      `SELECT t.txn_date::text AS date, t.created_at, a.name AS account, a.type AS account_type,
              t.direction, t.amount::text, t.source, t.description,
              u.full_name AS created_by
         FROM account_transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN users u ON u.id = t.created_by
        WHERE t.txn_date BETWEEN $1 AND $2
        ORDER BY t.txn_date DESC, t.created_at DESC
        LIMIT 1000`,
      [from, to],
    );
    const { rows: balances } = await query(
      `SELECT a.name, a.type,
              COALESCE(SUM(CASE WHEN t.direction='credit' THEN t.amount ELSE -t.amount END), 0)::text AS balance
         FROM accounts a
         LEFT JOIN account_transactions t ON t.account_id = a.id
        WHERE a.is_active = true
        GROUP BY a.id, a.name, a.type`,
    );
    return { transactions: rows, balances };
  },
};
