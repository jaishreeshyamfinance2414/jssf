import { PoolClient } from 'pg';
import { query } from '../../db/pool';

export type EmiFrequency = 'daily' | 'weekly' | 'monthly';
export type LoanStatus = 'pending' | 'approved' | 'rejected' | 'active' | 'closed';

export interface CreateLoanInput {
  customerId: string;
  principal: number;
  interestRate: number;
  interestAmount: number;
  totalPayable: number;
  emiAmount: number;
  emiFrequency: EmiFrequency;
  tenureCount: number;
  durationDays: number;
  sequenceNo: number;
  loanNumber: string;
  createdBy: string;
}

export interface UpdateLoanTermsInput {
  principal: number;
  interestRate: number;
  interestAmount: number;
  totalPayable: number;
  emiAmount: number;
  emiFrequency: EmiFrequency;
  tenureCount: number;
  durationDays: number;
}

const FREQUENCY_UNIT: Record<EmiFrequency, string> = {
  daily: 'days',
  weekly: 'weeks',
  monthly: 'months',
};

export const loanRepository = {
  /** Atomically bump the per-year loan number sequence and return the new number. */
  async nextSequenceNo(year: number): Promise<number> {
    const { rows } = await query<{ last_no: number }>(
      `INSERT INTO loan_number_seq(year, last_no) VALUES ($1, 1)
       ON CONFLICT (year) DO UPDATE SET last_no = loan_number_seq.last_no + 1
       RETURNING last_no`,
      [year],
    );
    return rows[0].last_no;
  },

  async create(input: CreateLoanInput) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO loans(
         loan_number, customer_id, principal, interest_rate, interest_amount,
         duration_days, emi_amount, total_payable,
         emi_frequency, tenure_count, sequence_no, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)
       RETURNING id`,
      [
        input.loanNumber,
        input.customerId,
        input.principal,
        input.interestRate,
        input.interestAmount,
        input.durationDays,
        input.emiAmount,
        input.totalPayable,
        input.emiFrequency,
        input.tenureCount,
        input.sequenceNo,
        input.createdBy,
      ],
    );
    return rows[0];
  },

  async findById(id: string) {
    const { rows } = await query(
      `SELECT l.*, c.full_name AS customer_name, c.mobile AS customer_mobile, c.area_id,
              a.name AS area_name
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN areas a ON a.id = c.area_id
        WHERE l.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Lock the loan row for the duration of an approval/disbursement transaction. */
  async lockForUpdate(id: string, client: PoolClient) {
    const { rows } = await client.query(`SELECT * FROM loans WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0] ?? null;
  },

  async list(status?: LoanStatus) {
    const { rows } = await query(
      `SELECT l.id, l.loan_number, l.principal, l.interest_rate, l.status, l.emi_frequency, l.tenure_count,
              l.emi_amount, l.total_payable, l.loan_date, l.closed_at, l.waiver_amount, l.created_at,
              c.full_name AS customer_name, c.mobile AS customer_mobile,
              GREATEST(0, l.total_payable - COALESCE((
                SELECT sum(amount) FROM collections WHERE loan_id = l.id
              ), 0))::text AS remaining,
              (SELECT max(due_date) FROM emi_schedule WHERE loan_id = l.id)::text AS closing_date
         FROM loans l JOIN customers c ON c.id = l.customer_id
        WHERE ($1::loan_status IS NULL OR l.status = $1)
        ORDER BY l.created_at DESC
        LIMIT 300`,
      [status ?? null],
    );
    return rows;
  },

  async searchActive(term: string) {
    const normalized = term.trim();
    if (normalized.length < 2) return [];
    const numeric = Number(normalized.replace(/,/g, ''));
    const { rows } = await query(
      `SELECT l.id, l.loan_number, l.principal, l.emi_amount, l.emi_frequency, l.tenure_count,
              l.status, c.full_name AS customer_name, c.mobile AS customer_mobile, c.file_number,
              c.guarantor_name, c.guarantor_mobile,
              GREATEST(0, l.total_payable - COALESCE((
                SELECT sum(amount) FROM collections WHERE loan_id = l.id
              ), 0))::text AS loan_remaining,
              COALESCE((
                SELECT jsonb_build_object(
                  'id', e.id,
                  'dueDate', e.due_date,
                  'dueAmount', e.due_amount,
                  'paidAmount', e.paid_amount,
                  'remainingAmount', e.due_amount - e.paid_amount,
                  'status', e.status
                )
                FROM emi_schedule e
                WHERE e.loan_id = l.id
                  AND e.status IN ('pending','partial','missed')
                ORDER BY e.due_date ASC, e.installment_no ASC
                LIMIT 1
              ), NULL) AS next_emi
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
        WHERE l.status = 'active'
          AND (
            c.full_name ILIKE '%' || $1 || '%'
            OR c.mobile ILIKE '%' || $1 || '%'
            OR l.loan_number ILIKE '%' || $1 || '%'
            OR c.guarantor_name ILIKE '%' || $1 || '%'
            OR c.guarantor_mobile ILIKE '%' || $1 || '%'
            OR c.file_number::text = $1
            OR ($2::numeric IS NOT NULL AND l.principal = $2)
          )
        ORDER BY l.created_at DESC
        LIMIT 20`,
      [normalized, Number.isFinite(numeric) ? numeric : null],
    );
    return rows;
  },

  async approve(id: string, approvedBy: string, client: PoolClient) {
    await client.query(
      `UPDATE loans SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`,
      [id, approvedBy],
    );
  },

  /** Revert an approved loan back to pending (admin undo of a mistaken approval). */
  async unapprove(id: string, client: PoolClient) {
    await client.query(
      `UPDATE loans SET status = 'pending', approved_by = NULL, approved_at = NULL WHERE id = $1`,
      [id],
    );
  },

  async updateTerms(id: string, input: UpdateLoanTermsInput, client: PoolClient) {
    await client.query(
      `UPDATE loans
          SET principal = $2,
              interest_rate = $3,
              interest_amount = $4,
              total_payable = $5,
              emi_amount = $6,
              emi_frequency = $7,
              tenure_count = $8,
              duration_days = $9
        WHERE id = $1`,
      [
        id,
        input.principal,
        input.interestRate,
        input.interestAmount,
        input.totalPayable,
        input.emiAmount,
        input.emiFrequency,
        input.tenureCount,
        input.durationDays,
      ],
    );
  },

  async rescheduleOpenEmis(
    loanId: string,
    loanDate: string,
    frequency: EmiFrequency,
    emiAmount: number,
    totalPayable: number,
    client: PoolClient,
  ) {
    const { rows: paidRows } = await client.query<{ paid: string; closed_count: string }>(
      `SELECT COALESCE(sum(paid_amount),0)::text AS paid,
              count(*) FILTER (WHERE status = 'paid')::text AS closed_count
         FROM emi_schedule
        WHERE loan_id = $1`,
      [loanId],
    );
    const paid = Number(paidRows[0].paid);

    const { rows: openRows } = await client.query<{ id: string; installment_no: number }>(
      `SELECT id, installment_no
         FROM emi_schedule
        WHERE loan_id = $1
          AND status IN ('pending','partial','missed')
        ORDER BY installment_no`,
      [loanId],
    );
    if (!openRows.length) return;

    const remainingPayable = Math.max(0, Number((totalPayable - paid).toFixed(2)));
    const normalAmount = Math.min(emiAmount, remainingPayable);
    const unit = FREQUENCY_UNIT[frequency];

    for (let i = 0; i < openRows.length; i += 1) {
      const row = openRows[i];
      const isLast = i === openRows.length - 1;
      const amountBeforeLast = normalAmount * (openRows.length - 1);
      const dueAmount = isLast
        ? Math.max(0, Number((remainingPayable - amountBeforeLast).toFixed(2)))
        : normalAmount;
      await client.query(
        `UPDATE emi_schedule
            SET due_amount = GREATEST($2::numeric, paid_amount),
                due_date = ($3::date + (($4::int - 1) || ' ${unit}')::interval)::date,
                status = CASE
                  WHEN paid_amount >= GREATEST($2::numeric, paid_amount) THEN 'paid'::emi_status
                  WHEN paid_amount > 0 THEN 'partial'::emi_status
                  ELSE 'pending'::emi_status
                END
          WHERE id = $1`,
        [row.id, dueAmount, loanDate, row.installment_no],
      );
    }
  },

  async reject(id: string, reason: string, client: PoolClient) {
    await client.query(
      `UPDATE loans SET status = 'rejected', rejected_reason = $2 WHERE id = $1`,
      [id, reason],
    );
  },

  async markDisbursed(
    id: string,
    mode: 'cash' | 'upi' | 'bank_transfer',
    disbursedBy: string,
    loanDate: string,
    durationDays: number,
    client: PoolClient,
  ) {
    await client.query(
      `UPDATE loans
          SET status = 'active', disbursed_mode = $2, disbursed_at = now(), disbursed_by = $3,
              loan_date = $4, duration_days = $5
        WHERE id = $1`,
      [id, mode, disbursedBy, loanDate, durationDays],
    );
  },

  /** Manual admin closure — optionally with a waiver of whatever balance remains. */
  async close(
    id: string,
    input: { closedBy: string; waiverAmount: number; waiverReason: string | null },
    client: PoolClient,
  ) {
    await client.query(
      `UPDATE loans
          SET status = 'closed', closed_at = now(), closed_by = $2,
              waiver_amount = $3, waiver_reason = $4
        WHERE id = $1`,
      [id, input.closedBy, input.waiverAmount, input.waiverReason],
    );
  },

  /** Waived EMIs are considered settled — mark any still-open rows paid so schedules/dashboards stay consistent. */
  async closeRemainingEmis(loanId: string, client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE emi_schedule SET status = 'paid' WHERE loan_id = $1 AND status <> 'paid'`,
      [loanId],
    );
  },

  async markClosedIfFullyPaid(loanId: string, client: PoolClient): Promise<boolean> {
    // Compare amounts, not status — 'advance' rows are fully funded but not
    // yet 'paid', and must count toward closure. Missed-day penalties live on
    // total_payable but NOT on EMI due_amounts, so closure additionally
    // requires the collected total to cover total_payable (base + penalties).
    const { rows } = await client.query<{ remaining: string; shortfall: string }>(
      `SELECT (SELECT count(*) FROM emi_schedule WHERE loan_id = $1 AND paid_amount < due_amount)::text AS remaining,
              (SELECT l.total_payable - COALESCE((SELECT sum(c.amount) FROM collections c WHERE c.loan_id = l.id), 0)
                 FROM loans l WHERE l.id = $1)::text AS shortfall`,
      [loanId],
    );
    if (Number(rows[0].remaining) > 0 || Number(rows[0].shortfall) > 0.01) return false;
    await client.query(`UPDATE loans SET status = 'closed', closed_at = now() WHERE id = $1`, [loanId]);
    return true;
  },

  /** Reverse an automatic full-payment closure (e.g. after deleting the collection that closed it). */
  async reopen(loanId: string, client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE loans SET status = 'active', closed_at = NULL WHERE id = $1`,
      [loanId],
    );
  },

  /** Hard delete — callers must guard on status (only rejected loans are deletable). */
  async deleteById(id: string, client: PoolClient): Promise<void> {
    await client.query(`DELETE FROM loans WHERE id = $1`, [id]);
  },

  /**
   * Generate the EMI schedule for a loan. Due dates are computed in Postgres
   * (interval arithmetic) to avoid JS Date month-overflow bugs; amounts floor
   * the per-installment value so the last installment absorbs the rounding
   * remainder and is never smaller than the others.
   */
  async generateSchedule(
    loanId: string,
    loanDate: string,
    frequency: EmiFrequency,
    tenureCount: number,
    totalPayable: number,
    client: PoolClient,
  ) {
    const unit = FREQUENCY_UNIT[frequency];
    const { rows: dates } = await client.query<{ n: number; due_date: string }>(
      `SELECT n::int AS n, ($1::date + ((n - 1) || ' ${unit}')::interval)::date::text AS due_date
         FROM generate_series(1, $2) AS n
        ORDER BY n`,
      [loanDate, tenureCount],
    );

    const perInstallment = Math.floor((totalPayable / tenureCount) * 100) / 100;
    const installmentNos = dates.map((d) => d.n);
    const dueDates = dates.map((d) => d.due_date);
    const dueAmounts = dates.map((_d, idx) =>
      idx === dates.length - 1
        ? Number((totalPayable - perInstallment * (tenureCount - 1)).toFixed(2))
        : perInstallment,
    );

    await client.query(
      `INSERT INTO emi_schedule(loan_id, installment_no, due_date, due_amount)
       SELECT $1, t.n, t.due_date, t.due_amount
       FROM unnest($2::int[], $3::date[], $4::numeric[]) AS t(n, due_date, due_amount)`,
      [loanId, installmentNos, dueDates, dueAmounts],
    );
  },

  async emiSchedule(loanId: string) {
    const { rows } = await query(
      `SELECT * FROM emi_schedule WHERE loan_id = $1 ORDER BY installment_no`,
      [loanId],
    );
    return rows;
  },

  async collectionsFor(loanId: string) {
    const { rows } = await query(
      `SELECT co.*, u.full_name AS agent_name,
              e.installment_no, e.due_date, e.due_amount, e.status AS emi_status, e.missed_penalty
         FROM collections co
         LEFT JOIN users u ON u.id = co.agent_id
         LEFT JOIN emi_schedule e ON e.id = co.emi_id
        WHERE co.loan_id = $1 ORDER BY co.collected_at DESC`,
      [loanId],
    );
    return rows;
  },
};
