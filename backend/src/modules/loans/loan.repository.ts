import { PoolClient } from 'pg';
import { query } from '../../db/pool';
import { historyCtes } from '../collections/statement-history';
import { loanBalanceJoin } from './loan-balance';

export type EmiFrequency = 'daily' | 'meter';
type StoredEmiFrequency = EmiFrequency | 'weekly' | 'monthly';
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
  loanDate: string;
  createdBy: string;
  createdAt?: string;
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
  loanDate: string;
}

const FREQUENCY_UNIT: Record<StoredEmiFrequency, string> = {
  daily: 'days',
  meter: 'days',
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

  async create(input: CreateLoanInput, client?: PoolClient) {
    const sql = `INSERT INTO loans(
         loan_number, customer_id, principal, interest_rate, interest_amount,
         duration_days, emi_amount, total_payable,
         emi_frequency, tenure_count, sequence_no, status, loan_date, created_by, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13, COALESCE($14::timestamptz, now()))
       RETURNING id`;
    const params = [
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
        input.loanDate,
        input.createdBy,
        input.createdAt ?? null,
    ];
    const { rows } = client
      ? await client.query<{ id: string }>(sql, params)
      : await query<{ id: string }>(sql, params);
    return rows[0];
  },

  async findById(id: string, client?: PoolClient) {
    const sql =
      `SELECT l.*, c.full_name AS customer_name, c.mobile AS customer_mobile, c.area_id,
              a.name AS area_name, receipts.received AS received_till_today,
              dues.total_payable AS total_payable,
              dues.expected AS expected_till_today, balance.signed_shortfall AS due_till_today,
              balance.advance AS advance_balance, balance.remaining AS remaining,
              dues.penalty AS total_penalty, CURRENT_DATE::text AS business_date
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN areas a ON a.id = c.area_id
         ${loanBalanceJoin}
        WHERE l.id = $1`;
    const { rows } = client ? await client.query(sql, [id]) : await query(sql, [id]);
    return rows[0] ?? null;
  },

  /** Lock the loan row for the duration of an approval/disbursement transaction. */
  async lockForUpdate(id: string, client: PoolClient) {
    const { rows } = await client.query(`SELECT *, loan_date::text AS loan_date FROM loans WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0] ?? null;
  },

  async list(status?: LoanStatus) {
    const { rows } = await query(
      `SELECT l.id, l.loan_number, l.principal, l.interest_rate, l.status, l.emi_frequency, l.tenure_count,
              l.emi_amount, dues.total_payable, l.loan_date, l.closed_at, l.waiver_amount, l.created_at,
              c.full_name AS customer_name, c.mobile AS customer_mobile,
              balance.remaining::text, dues.closing_date::text
         FROM loans l JOIN customers c ON c.id = l.customer_id
         ${loanBalanceJoin}
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
              balance.remaining::text AS loan_remaining,
              dues.expected::text AS expected_till_today, balance.shortfall::text AS due_till_today,
              COALESCE((
                SELECT jsonb_build_object(
                  'id', e.id,
                  'dueDate', e.due_date,
                  'dueAmount', e.due_amount,
                  'paidAmount', e.paid_amount,
                  'remainingAmount', LEAST(l.emi_amount,CASE WHEN balance.shortfall > 0
                    THEN balance.shortfall ELSE balance.remaining END),
                  'status', e.status
                )
                FROM emi_schedule e
                WHERE e.loan_id = l.id
                  AND e.due_date = COALESCE(coverage.next_due_date,
                    CASE WHEN balance.shortfall > 0 THEN dues.closing_date END)
                ORDER BY e.due_date ASC, e.installment_no ASC
                LIMIT 1
              ), NULL) AS next_emi
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
         ${loanBalanceJoin}
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

  async approve(id: string, approvedBy: string, client: PoolClient, approvedAt?: string) {
    await client.query(
      `UPDATE loans SET status = 'approved', approved_by = $2, approved_at = COALESCE($3::timestamptz, now()) WHERE id = $1`,
      [id, approvedBy, approvedAt ?? null],
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
              duration_days = $9,
              loan_date = $10::date,
              disbursed_at = CASE WHEN disbursed_at IS NULL THEN NULL
                ELSE ($10::date + disbursed_at::time)::timestamptz END
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
        input.loanDate,
      ],
    );
  },

  async rescheduleOpenEmis(
    loanId: string,
    loanDate: string,
    frequency: StoredEmiFrequency,
    tenureCount: number,
    emiAmount: number,
    totalPayable: number,
    client: PoolClient,
  ) {
    // The schedule is the contract used by balances and penalties. Rebuild all
    // installments, including paid/advance rows, before reallocating receipts.
    const unit = FREQUENCY_UNIT[frequency];
    await client.query(
      `WITH installments AS (
         SELECT n::int AS installment_no,
                ($2::date + ((n - 1) || ' ${unit}')::interval)::date AS due_date,
                CASE WHEN n = $3::int THEN $5::numeric - ($3::int - 1) * $4::numeric
                     ELSE $4::numeric END AS due_amount
           FROM generate_series(1, $3::int) AS n
       )
       INSERT INTO emi_schedule(loan_id, installment_no, due_date, due_amount)
       SELECT $1, installment_no, due_date, due_amount FROM installments
       ON CONFLICT (loan_id, installment_no) DO UPDATE
         SET due_date = EXCLUDED.due_date, due_amount = EXCLUDED.due_amount`,
      [loanId, loanDate, tenureCount, emiAmount, totalPayable],
    );
    // A collection is historical evidence even when its old installment is
    // removed. Attach it to the final valid installment before deleting rows.
    await client.query(
      `UPDATE collections c SET emi_id =
           (SELECT id FROM emi_schedule WHERE loan_id = $1 AND installment_no = $2)
         FROM emi_schedule old_emi
        WHERE old_emi.id = c.emi_id AND old_emi.loan_id = $1
          AND old_emi.installment_no > $2`,
      [loanId, tenureCount],
    );
    await client.query(
      `DELETE FROM emi_schedule WHERE loan_id = $1 AND installment_no > $2`,
      [loanId, tenureCount],
    );
    await client.query(
      `UPDATE collections c SET emi_id = (
         SELECT e.id FROM emi_schedule e
          WHERE e.loan_id = c.loan_id AND e.due_date = c.collected_at::date
          ORDER BY e.installment_no LIMIT 1)
        WHERE c.loan_id = $1 AND c.amount = 0 AND c.penalty = 0
          AND c.created_by IS NULL AND c.note IN (
            'Auto-marked: no collection recorded for this day',
            'Auto-marked: installment covered by advance payment',
            'Auto-marked: advance coverage completed on time')`,
      [loanId],
    );
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
    disbursedAt?: string,
  ) {
    await client.query(
      `UPDATE loans
          SET status = 'active', disbursed_mode = $2, disbursed_at = COALESCE($6::timestamptz, now()), disbursed_by = $3,
              loan_date = $4, duration_days = $5
        WHERE id = $1`,
      [id, mode, disbursedBy, loanDate, durationDays, disbursedAt ?? null],
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
    const { rows } = await client.query<{ installments: string; shortfall: string }>(
      `SELECT (SELECT count(*) FROM emi_schedule WHERE loan_id = $1)::text AS installments,
              (SELECT l.total_payable - COALESCE((SELECT sum(c.amount + c.penalty) FROM collections c WHERE c.loan_id = l.id
                 AND c.collected_at < CURRENT_DATE::timestamp + interval '1 day'), 0)
                 FROM loans l WHERE l.id = $1)::text AS shortfall`,
      [loanId],
    );
    if (Number(rows[0].installments) === 0 || Number(rows[0].shortfall) > 0) return false;
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
    frequency: StoredEmiFrequency,
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
      `WITH ${historyCtes(true, true)}
       SELECT co.*, co.collected_at::date::text AS entry_date,
              r.due_by_day AS expected_by_day, r.received_by_day AS received_by_day,
              CASE WHEN r.received_by_day > r.due_by_day THEN 'advance'
                   WHEN co.amount + co.penalty = 0 AND r.received_by_day < r.due_by_day THEN 'missed'
                   WHEN co.amount + co.penalty > 0 AND (r.received_by_day < r.due_by_day
                     OR r.received_by_day - r.day_received < r.due_by_day - r.day_due) THEN 'delayed'
                   ELSE 'on_time' END AS timing,
              COALESCE(agent.full_name, creator.full_name, 'Automatic') AS agent_name,
              e.installment_no, COALESCE(e.due_date,co.collected_at::date) AS due_date,
              e.due_amount, e.status AS emi_status,
              COALESCE((SELECT p.amount FROM loan_daily_penalties p
                WHERE p.loan_id = co.loan_id AND p.penalty_date = co.collected_at::date
                  AND p.penalty_date < CURRENT_DATE),0) AS missed_penalty
         FROM collections co
         JOIN running r ON r.loan_id = co.loan_id AND r.day = co.collected_at::date
         LEFT JOIN users agent ON agent.id = co.agent_id
         LEFT JOIN users creator ON creator.id = co.created_by
         LEFT JOIN emi_schedule e ON e.id = co.emi_id
        WHERE co.loan_id = $1 ORDER BY co.collected_at DESC`,
      [loanId],
    );
    return rows;
  },
};
