import { PoolClient } from 'pg';
import { query } from '../../db/pool';

export interface BorrowedLoanRow {
  id: string;
  lender_name: string;
  loan_type: 'reducing_balance' | 'interest_only';
  receiving_account_id: string;
  original_principal: string;
  installment_count: number | null;
  installment_amount: string | null;
  total_payable: string | null;
  total_interest: string;
  periodic_interest: string | null;
  received_date: string;
  first_payment_date: string;
  status: 'active' | 'closed';
}

export const borrowedLoanRepository = {
  async create(input: {
    lenderName: string; loanType: string; receivingAccountId: string; loanAmount: number;
    installmentCount?: number; installmentAmount?: number; totalPayable?: number;
    totalInterest: number; periodicInterest?: number; receivedDate: string;
    firstPaymentDate: string; note?: string | null; createdBy: string;
  }, client: PoolClient): Promise<{ id: string }> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO borrowed_loans(
         lender_name, loan_type, receiving_account_id, original_principal,
         installment_count, installment_amount, total_payable, total_interest,
         periodic_interest, received_date, first_payment_date, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [input.lenderName, input.loanType, input.receivingAccountId, input.loanAmount,
       input.installmentCount ?? null, input.installmentAmount ?? null, input.totalPayable ?? null,
       input.totalInterest, input.periodicInterest ?? null, input.receivedDate,
       input.firstPaymentDate, input.note ?? null, input.createdBy],
    );
    return rows[0];
  },

  async createSchedule(loanId: string, rows: Array<{ installmentNo: number; dueDate: string; principal: number; interest: number; total: number }>, client: PoolClient) {
    for (const row of rows) {
      await client.query(
        `INSERT INTO borrowed_loan_schedule(loan_id, installment_no, due_date, principal_due, interest_due, total_due)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [loanId, row.installmentNo, row.dueDate, row.principal, row.interest, row.total],
      );
    }
  },

  async list() {
    const { rows } = await query(
      `SELECT bl.*, a.name AS receiving_account_name,
              COALESCE(p.principal_paid,0)::text AS principal_paid,
              COALESCE(p.interest_paid,0)::text AS interest_paid,
              (bl.original_principal - COALESCE(p.principal_paid,0))::text AS outstanding_principal,
              CASE WHEN bl.status='closed' THEN NULL
                   WHEN bl.loan_type='reducing_balance' THEN ns.due_date
                   ELSE (bl.first_payment_date + (COALESCE(p.payment_count,0)::int * interval '1 month'))::date END AS next_payment_date,
              CASE WHEN bl.status='closed' THEN NULL
                   WHEN bl.loan_type='reducing_balance' THEN ns.total_due ELSE bl.periodic_interest END::text AS next_payment_amount,
              COALESCE(ov.overdue_count,0)::int AS overdue_payments
         FROM borrowed_loans bl
         JOIN accounts a ON a.id=bl.receiving_account_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(sum(principal_amount),0) principal_paid,
                  COALESCE(sum(interest_amount),0) interest_paid, count(*) payment_count
             FROM borrowed_loan_payments WHERE loan_id=bl.id
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT due_date,total_due FROM borrowed_loan_schedule
            WHERE loan_id=bl.id AND paid_at IS NULL ORDER BY installment_no LIMIT 1
         ) ns ON true
         LEFT JOIN LATERAL (
           SELECT count(*)::int due_count FROM generate_series(0,1200) n
            WHERE (bl.first_payment_date + (n * interval '1 month'))::date < CURRENT_DATE
         ) io ON bl.loan_type='interest_only'
         LEFT JOIN LATERAL (
           SELECT CASE WHEN bl.status='closed' THEN 0
                  WHEN bl.loan_type='reducing_balance' THEN
                    count(*) FILTER (WHERE s.paid_at IS NULL AND s.due_date < CURRENT_DATE)
                  WHEN CURRENT_DATE <= bl.first_payment_date THEN 0
                  ELSE GREATEST(0, COALESCE(io.due_count,0) - COALESCE(p.payment_count,0)::int)
                  END AS overdue_count
             FROM borrowed_loan_schedule s WHERE s.loan_id=bl.id
         ) ov ON true
        ORDER BY (bl.status='active') DESC, bl.received_date DESC, bl.created_at DESC`,
    );
    return rows;
  },

  async payments(loanId: string) {
    const { rows } = await query(
      `SELECT p.*, a.name AS account_name, s.installment_no
         FROM borrowed_loan_payments p
         JOIN accounts a ON a.id=p.account_id
         LEFT JOIN borrowed_loan_schedule s ON s.id=p.schedule_id
        WHERE p.loan_id=$1 ORDER BY p.payment_date DESC,p.created_at DESC`, [loanId],
    );
    return rows;
  },

  async lockById(id: string, client: PoolClient): Promise<BorrowedLoanRow | null> {
    const { rows } = await client.query<BorrowedLoanRow>(`SELECT * FROM borrowed_loans WHERE id=$1 FOR UPDATE`, [id]);
    return rows[0] ?? null;
  },

  async totalsPaid(id: string, client: PoolClient): Promise<{ principal: number; count: number }> {
    const { rows } = await client.query<{ principal: string; count: string }>(
      `SELECT COALESCE(sum(principal_amount),0)::text principal,count(*)::text count
         FROM borrowed_loan_payments WHERE loan_id=$1`, [id]);
    return { principal: Number(rows[0].principal), count: Number(rows[0].count) };
  },

  async nextSchedule(id: string, client: PoolClient) {
    const { rows } = await client.query<{ id: string; principal_due: string; interest_due: string; total_due: string; installment_no: number }>(
      `SELECT id,principal_due,interest_due,total_due,installment_no FROM borrowed_loan_schedule
        WHERE loan_id=$1 AND paid_at IS NULL ORDER BY installment_no LIMIT 1 FOR UPDATE`, [id]);
    return rows[0] ?? null;
  },

  async createPayment(input: { loanId: string; accountId: string; scheduleId?: string; paymentDate: string; principal: number; interest: number; total: number; createdBy: string }, client: PoolClient) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO borrowed_loan_payments(loan_id,account_id,schedule_id,payment_date,principal_amount,interest_amount,total_amount,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [input.loanId,input.accountId,input.scheduleId ?? null,input.paymentDate,input.principal,input.interest,input.total,input.createdBy]);
    if (input.scheduleId) await client.query(`UPDATE borrowed_loan_schedule SET paid_at=$2 WHERE id=$1`, [input.scheduleId,input.paymentDate]);
    return rows[0];
  },

  async close(id: string, client: PoolClient) {
    await client.query(`UPDATE borrowed_loans SET status='closed' WHERE id=$1`, [id]);
  },
};
