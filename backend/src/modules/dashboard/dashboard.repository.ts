import { query } from '../../db/pool';
import { loanBalanceJoin } from '../loans/loan-balance';

/**
 * Read-only aggregation queries powering the dashboard KPIs and breakdowns.
 * Each is a single indexed query; the controller runs them concurrently.
 */
export const dashboardRepository = {
  async totalCustomers(): Promise<number> {
    const { rows } = await query<{ c: string }>(
      `SELECT count(*)::text AS c FROM customers WHERE is_active = true`,
    );
    return Number(rows[0].c);
  },

  async activeLoans(): Promise<number> {
    const { rows } = await query<{ c: string }>(
      `SELECT count(*)::text AS c FROM loans WHERE status = 'active'`,
    );
    return Number(rows[0].c);
  },

  async todaysCollection(): Promise<{ cash: number; digital: number; total: number; previousTotal: number }> {
    const { rows } = await query<{ cash: string; digital: string; prev: string }>(
      `SELECT
         COALESCE(sum(amount) FILTER (WHERE mode = 'cash' AND (entry_date AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)::text AS cash,
         COALESCE(sum(amount) FILTER (WHERE mode != 'cash' AND (entry_date AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)::text AS digital,
         COALESCE(sum(amount) FILTER (WHERE (entry_date AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date - 1), 0)::text AS prev
         FROM collections
        WHERE (entry_date AT TIME ZONE 'Asia/Kolkata')::date IN ((now() AT TIME ZONE 'Asia/Kolkata')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1)`,
    );
    const cash = Number(rows[0].cash);
    const digital = Number(rows[0].digital);
    return { cash, digital, total: cash + digital, previousTotal: Number(rows[0].prev) };
  },

  /** Cash-in-hand vs bank/UPI, from the ledger balances of the active cash & bank accounts. */
  async cashSplit(): Promise<{ cashInHand: number; bankUpi: number }> {
    const { rows } = await query<{ type: string; bal: string }>(
      `SELECT a.type,
              COALESCE(SUM(CASE WHEN t.direction='credit' THEN t.amount ELSE -t.amount END), 0)::text AS bal
         FROM accounts a
         LEFT JOIN account_transactions t ON t.account_id = a.id
        WHERE a.is_active = true AND a.type IN ('cash','bank')
        GROUP BY a.type`,
    );
    const map = new Map(rows.map((r) => [r.type, Number(r.bal)]));
    return { cashInHand: map.get('cash') ?? 0, bankUpi: map.get('bank') ?? 0 };
  },

  /** Overdue installments: total unpaid amount + how many distinct areas they span. */
  async missedEmiSummary(): Promise<{ amount: number; areas: number }> {
    const { rows } = await query<{ amount: string; areas: string }>(
      `SELECT COALESCE(sum(balance.overdue), 0)::text AS amount,
              count(DISTINCT c.area_id)::text AS areas
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
         ${loanBalanceJoin}
        WHERE l.status = 'active' AND balance.overdue > 0`,
    );
    return { amount: Number(rows[0].amount), areas: Number(rows[0].areas) };
  },

  /** Remaining principal-plus-interest across all active loans. */
  async outstandingPrincipal(): Promise<number> {
    const { rows } = await query<{ s: string }>(
      `SELECT COALESCE(sum(balance.remaining), 0)::text AS s
         FROM loans l
         ${loanBalanceJoin}
        WHERE l.status = 'active'`,
    );
    return Number(rows[0].s);
  },

  async newCustomersThisMonth(): Promise<number> {
    const { rows } = await query<{ c: string }>(
      `SELECT count(*)::text AS c FROM customers
        WHERE is_active = true
          AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)`,
    );
    return Number(rows[0].c);
  },

  async pendingApprovalsValue(): Promise<number> {
    const { rows } = await query<{ s: string }>(
      `SELECT COALESCE(sum(principal), 0)::text AS s FROM loans WHERE status = 'pending'`,
    );
    return Number(rows[0].s);
  },

  /** Distinct loans carrying an overdue EMI, and the penalty accrued on them. */
  async overdueLoans(): Promise<{ count: number; penalty: number }> {
    const { rows } = await query<{ c: string; penalty: string }>(
      `SELECT count(*)::text AS c, COALESCE(sum(dues.penalty),0)::text AS penalty
         FROM loans l ${loanBalanceJoin}
        WHERE l.status = 'active' AND balance.overdue > 0`,
    );
    return { count: Number(rows[0].c), penalty: Number(rows[0].penalty) };
  },

  async disbursedThisMonth(): Promise<{ amount: number; count: number }> {
    const { rows } = await query<{ amount: string; c: string }>(
      `SELECT COALESCE(sum(principal), 0)::text AS amount, count(*)::text AS c
         FROM loans
        WHERE disbursed_at IS NOT NULL
          AND date_trunc('month', disbursed_at) = date_trunc('month', CURRENT_DATE)`,
    );
    return { amount: Number(rows[0].amount), count: Number(rows[0].c) };
  },

  /** Salary portion of this month's expenses (category name matched loosely). */
  async salaryExpenseThisMonth(): Promise<number> {
    const { rows } = await query<{ s: string }>(
      `SELECT COALESCE(sum(e.amount), 0)::text AS s
         FROM expenses e
         LEFT JOIN expense_categories cat ON cat.id = e.category_id
        WHERE date_trunc('month', e.expense_date) = date_trunc('month', CURRENT_DATE)
          AND lower(cat.name) LIKE '%salary%'`,
    );
    return Number(rows[0].s);
  },

  /** Top pending loan applications for the dashboard approvals table. */
  async pendingLoanApprovals(): Promise<
    Array<{ id: string; loanNumber: string; customerName: string; area: string; amount: number; sequenceNo: number }>
  > {
    const { rows } = await query<{
      id: string;
      loan_number: string;
      customer_name: string;
      area: string | null;
      principal: string;
      sequence_no: number | null;
    }>(
      `SELECT l.id, l.loan_number, c.full_name AS customer_name, a.name AS area,
              l.principal, l.sequence_no
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN areas a ON a.id = c.area_id
        WHERE l.status = 'pending'
        ORDER BY l.created_at DESC
        LIMIT 5`,
    );
    return rows.map((r) => ({
      id: r.id,
      loanNumber: r.loan_number,
      customerName: r.customer_name,
      area: r.area ?? 'Unassigned',
      amount: Number(r.principal),
      sequenceNo: r.sequence_no ?? 1,
    }));
  },

  /** Recent audit events for the activity feed. */
  async recentActivity(): Promise<
    Array<{ id: string; action: string; entity: string; actorName: string; meta: Record<string, unknown> | null; createdAt: string }>
  > {
    const { rows } = await query<{
      id: string;
      action: string;
      entity: string;
      actor_name: string | null;
      meta: Record<string, unknown> | null;
      created_at: string;
    }>(
      `SELECT al.id, al.action, al.entity, u.full_name AS actor_name, al.meta, al.created_at
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_id
        ORDER BY al.created_at DESC
        LIMIT 6`,
    );
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entity: r.entity,
      actorName: r.actor_name ?? 'System',
      meta: r.meta,
      createdAt: r.created_at,
    }));
  },

  async todaysDue(): Promise<number> {
    const { rows } = await query<{ s: string }>(
      `SELECT COALESCE(sum(balance.shortfall - balance.overdue),0)::text AS s
         FROM loans l ${loanBalanceJoin} WHERE l.status = 'active'`,
    );
    return Number(rows[0].s);
  },

  async todaysMissed(): Promise<number> {
    const { rows } = await query<{ c: string }>(
      `SELECT COALESCE(sum(coverage.missed_count),0)::text AS c
         FROM loans l ${loanBalanceJoin} WHERE l.status = 'active'`,
    );
    return Number(rows[0].c);
  },

  async pendingApprovals(): Promise<number> {
    const { rows } = await query<{ c: string }>(
      `SELECT count(*)::text AS c FROM loans WHERE status = 'pending'`,
    );
    return Number(rows[0].c);
  },

  /**
   * Available cash = the cash account's ledger balance (capital introduced +
   * collections received - disbursements - expenses, all posted via
   * ledgerService.post — see accounts/ledger.service.ts). Reads directly from
   * account_transactions so it can never drift from the real ledger.
   */
  async availableCash(): Promise<number> {
    const { rows } = await query<{ s: string }>(
      `SELECT COALESCE(SUM(CASE WHEN t.direction='credit' THEN t.amount ELSE -t.amount END), 0)::text AS s
         FROM accounts a
         LEFT JOIN account_transactions t ON t.account_id = a.id
        WHERE a.is_active = true AND a.type IN ('cash','bank')`,
    );
    return Number(rows[0].s);
  },

  async totalExpenses(): Promise<number> {
    const { rows } = await query<{ s: string }>(
      `SELECT (
         COALESCE((SELECT sum(amount) FROM expenses
                    WHERE date_trunc('month', expense_date) = date_trunc('month', CURRENT_DATE)),0) +
         COALESCE((SELECT sum(interest_amount) FROM borrowed_loan_payments
                    WHERE date_trunc('month', payment_date) = date_trunc('month', CURRENT_DATE)),0)
       )::text AS s`,
    );
    return Number(rows[0].s);
  },

  async borrowedLoanSummary(): Promise<{
    originalBorrowed: number; outstandingPrincipal: number; principalRepaid: number;
    interestPaid: number; overduePayments: number;
  }> {
    const { rows } = await query<{
      original: string; outstanding: string; principal_paid: string; interest_paid: string; overdue: string;
    }>(
      `SELECT COALESCE(sum(bl.original_principal),0)::text original,
              COALESCE(sum(GREATEST(bl.original_principal-COALESCE(p.principal_paid,0),0)),0)::text outstanding,
              COALESCE(sum(COALESCE(p.principal_paid,0)),0)::text principal_paid,
              COALESCE(sum(COALESCE(p.interest_paid,0)),0)::text interest_paid,
              COALESCE(sum(CASE WHEN bl.status='closed' THEN 0
                                WHEN bl.loan_type='reducing_balance' THEN COALESCE(s.overdue,0)
                                WHEN CURRENT_DATE <= bl.first_payment_date THEN 0
                                ELSE GREATEST(0,COALESCE(io.due_count,0)-COALESCE(p.payment_count,0)::int)
                           END),0)::text overdue
         FROM borrowed_loans bl
         LEFT JOIN LATERAL (
           SELECT sum(principal_amount) principal_paid,sum(interest_amount) interest_paid,count(*) payment_count
             FROM borrowed_loan_payments WHERE loan_id=bl.id
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT count(*)::int due_count FROM generate_series(0,1200) n
            WHERE (bl.first_payment_date + (n * interval '1 month'))::date < CURRENT_DATE
         ) io ON bl.loan_type='interest_only'
         LEFT JOIN LATERAL (
           SELECT count(*) overdue FROM borrowed_loan_schedule
            WHERE loan_id=bl.id AND paid_at IS NULL AND due_date<CURRENT_DATE
         ) s ON true`,
    );
    return {
      originalBorrowed: Number(rows[0].original),
      outstandingPrincipal: Number(rows[0].outstanding),
      principalRepaid: Number(rows[0].principal_paid),
      interestPaid: Number(rows[0].interest_paid),
      overduePayments: Number(rows[0].overdue),
    };
  },

  async borrowedLoanReminders(): Promise<Array<{
    loanId: string; lenderName: string; loanType: string; paymentDate: string; amount: number; overdue: boolean;
  }>> {
    const { rows } = await query<{
      id: string; lender_name: string; loan_type: string; payment_date: string; amount: string;
    }>(
      `SELECT bl.id,bl.lender_name,bl.loan_type,
              CASE WHEN bl.loan_type='reducing_balance' THEN ns.due_date
                   ELSE (bl.first_payment_date + (COALESCE(p.payment_count,0)::int * interval '1 month'))::date
               END::text payment_date,
              CASE WHEN bl.loan_type='reducing_balance' THEN ns.total_due ELSE bl.periodic_interest END::text amount
         FROM borrowed_loans bl
         LEFT JOIN LATERAL (
           SELECT count(*) payment_count FROM borrowed_loan_payments WHERE loan_id=bl.id
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT due_date,total_due FROM borrowed_loan_schedule
            WHERE loan_id=bl.id AND paid_at IS NULL ORDER BY installment_no LIMIT 1
         ) ns ON true
        WHERE bl.status='active'
          AND (bl.loan_type='interest_only' OR ns.due_date IS NOT NULL)
        ORDER BY payment_date
        LIMIT 8`,
    );
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    return rows.map((row) => ({
      loanId: row.id,
      lenderName: row.lender_name,
      loanType: row.loan_type,
      paymentDate: row.payment_date,
      amount: Number(row.amount),
      overdue: row.payment_date < today,
    }));
  },

  async areaWiseCollection(): Promise<Array<{ area: string; amount: number }>> {
    const { rows } = await query<{ area: string; amount: string }>(
      `SELECT COALESCE(a.name,'Unassigned') AS area, sum(c.amount)::text AS amount
         FROM collections c
         JOIN loans l ON l.id = c.loan_id
         JOIN customers cu ON cu.id = l.customer_id
         LEFT JOIN areas a ON a.id = COALESCE(c.area_id, cu.area_id)
        WHERE (c.entry_date AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
        GROUP BY a.name ORDER BY sum(c.amount) DESC`,
    );
    return rows.map((r) => ({ area: r.area, amount: Number(r.amount) }));
  },

  async agentWiseCollection(): Promise<
    Array<{ agentId: string | null; agent: string; area: string; amount: number; shortAmount: number }>
  > {
    const { rows } = await query<{
      agent_id: string | null;
      agent: string;
      area: string | null;
      amount: string;
      short_amount: string;
    }>(
      `SELECT c.agent_id,
              COALESCE(u.full_name,'Unassigned') AS agent,
              (SELECT a.name FROM areas a
                WHERE a.id = (SELECT area_id FROM collections c2
                               WHERE c2.agent_id = c.agent_id AND (c2.entry_date AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
                               GROUP BY area_id ORDER BY sum(amount) DESC LIMIT 1)) AS area,
              sum(c.amount)::text AS amount,
              COALESCE((SELECT sum(short_amount) FROM agent_ledger al
                         WHERE al.agent_id = c.agent_id AND al.ledger_date = CURRENT_DATE), 0)::text AS short_amount
         FROM collections c LEFT JOIN users u ON u.id = c.agent_id
        WHERE (c.entry_date AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
        GROUP BY c.agent_id, u.full_name
        ORDER BY sum(c.amount) DESC`,
    );
    return rows.map((r) => ({
      agentId: r.agent_id,
      agent: r.agent,
      area: r.area ?? '',
      amount: Number(r.amount),
      shortAmount: Number(r.short_amount),
    }));
  },

  /** Last 30 days of collected vs due, for the dashboard trend chart (client slices 7/14/30). */
  async collectionTrend(): Promise<Array<{ date: string; amount: number; due: number }>> {
    const { rows } = await query<{ date: string; amount: string; due: string }>(
      `SELECT d::date::text AS date,
              COALESCE((SELECT sum(amount) FROM collections
                         WHERE (entry_date AT TIME ZONE 'Asia/Kolkata')::date = d::date),0)::text AS amount,
              COALESCE((SELECT sum(due_amount) FROM emi_schedule
                         WHERE due_date = d::date),0)::text AS due
         FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') d
        ORDER BY d`,
    );
    return rows.map((r) => ({ date: r.date, amount: Number(r.amount), due: Number(r.due) }));
  },
};
