import { PoolClient } from 'pg';
import { query } from '../../db/pool';
import { CreateCollectionBody } from './collection.schema';

export const collectionRepository = {
  /** Sum of all amounts (excluding penalty) already collected toward a loan's total payable. */
  async totalCollectedForLoan(loanId: string, client: PoolClient): Promise<number> {
    const { rows } = await client.query<{ s: string }>(
      `SELECT COALESCE(sum(amount), 0)::text AS s FROM collections WHERE loan_id = $1`,
      [loanId],
    );
    return Number(rows[0].s);
  },

  async list() {
    const { rows } = await query(
      `SELECT co.*, l.loan_number, c.full_name AS customer_name, c.mobile AS customer_mobile,
              u.full_name AS agent_name, e.missed_penalty
         FROM collections co
         JOIN loans l ON l.id = co.loan_id
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN users u ON u.id = co.agent_id
         LEFT JOIN emi_schedule e ON e.id = co.emi_id
        ORDER BY co.collected_at DESC
        LIMIT 300`,
    );
    return rows;
  },

  /**
   * Collection sheet: every active loan with its loan-level rollups plus
   * today's action status — 'done' if any collection entry (cash, bank, or
   * a missed marker) was recorded today for the loan, else 'pending'.
   */
  async sheet() {
    const { rows } = await query(
      `SELECT l.id AS loan_id, l.loan_number, l.principal, l.total_payable, l.emi_amount,
              l.emi_frequency, l.loan_date::text AS start_date,
              c.full_name AS customer_name, c.mobile AS customer_mobile,
              a.name AS area_name,
              (SELECT count(*) FROM emi_schedule m
                WHERE m.loan_id = l.id AND m.due_date <= CURRENT_DATE
                  AND m.paid_amount < m.due_amount AND m.status = 'missed')::int AS missed_count,
              (SELECT COALESCE(sum(m.due_amount - m.paid_amount), 0) FROM emi_schedule m
                WHERE m.loan_id = l.id AND m.due_date <= CURRENT_DATE
                  AND m.paid_amount < m.due_amount)::text AS due_till_today,
              (SELECT count(*) FROM emi_schedule m
                WHERE m.loan_id = l.id AND m.due_date >= CURRENT_DATE
                  AND m.paid_amount >= m.due_amount)::int AS advance_count,
              (SELECT COALESCE(sum(m.paid_amount), 0) FROM emi_schedule m
                WHERE m.loan_id = l.id AND m.due_date > CURRENT_DATE)::text AS advance_amount,
              COALESCE((SELECT sum(co.amount) FROM collections co WHERE co.loan_id = l.id), 0)::text AS received,
              GREATEST(0, l.total_payable - COALESCE((
                SELECT sum(co.amount) FROM collections co WHERE co.loan_id = l.id
              ), 0))::text AS remaining,
              (SELECT max(m.due_date) FROM emi_schedule m WHERE m.loan_id = l.id)::text AS closing_date,
              (SELECT min(m.due_date) FROM emi_schedule m
                WHERE m.loan_id = l.id AND m.paid_amount < m.due_amount)::text AS next_due_date,
              t.today_type, t.today_mode, t.today_amount, t.today_at
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN areas a ON a.id = c.area_id
         LEFT JOIN LATERAL (
           SELECT co.type AS today_type, co.mode AS today_mode,
                  co.amount::text AS today_amount, co.collected_at AS today_at
             FROM collections co
            WHERE co.loan_id = l.id AND co.collected_at::date = CURRENT_DATE
            ORDER BY co.collected_at DESC
            LIMIT 1
         ) t ON true
        WHERE l.status = 'active'
        ORDER BY c.full_name ASC
        LIMIT 500`,
    );
    return rows;
  },

  /** Today's collected totals per agent (split by cash / bank), for the collection-sheet footer. */
  async sheetAgents() {
    const { rows } = await query(
      `SELECT u.id AS agent_id, u.full_name AS agent_name,
              COALESCE(sum(co.amount), 0)::text AS collected,
              COALESCE(sum(co.amount) FILTER (WHERE co.mode = 'cash' AND co.type <> 'missed'), 0)::text AS cash,
              COALESCE(sum(co.amount) FILTER (WHERE co.mode <> 'cash'), 0)::text AS bank,
              count(*) FILTER (WHERE co.type <> 'missed')::int AS entries
         FROM collections co
         JOIN users u ON u.id = co.agent_id
        WHERE co.collected_at::date = CURRENT_DATE
        GROUP BY u.id, u.full_name
        ORDER BY sum(co.amount) DESC`,
    );
    return rows;
  },

  async todaysDue() {
    // Only EMIs still awaiting action — days already marked 'missed' (by the
    // agent or the sweep) drop off the collection desk; they can still be
    // collected via manual loan search. Each row carries loan-level rollups
    // for the collection desk table (missed count, due-till-today incl.
    // penalty, received, remaining, dates).
    const { rows } = await query(
      `SELECT e.*, l.loan_number, l.principal, l.total_payable, l.loan_date::text AS start_date,
              c.full_name AS customer_name, c.mobile AS customer_mobile,
              (SELECT count(*) FROM emi_schedule m
                WHERE m.loan_id = l.id AND m.due_date <= CURRENT_DATE
                  AND m.paid_amount < m.due_amount AND m.status = 'missed')::int AS missed_count,
              (SELECT COALESCE(sum(m.due_amount - m.paid_amount), 0) FROM emi_schedule m
                WHERE m.loan_id = l.id AND m.due_date <= CURRENT_DATE
                  AND m.paid_amount < m.due_amount)::text AS due_till_today,
              COALESCE((SELECT sum(co.amount) FROM collections co WHERE co.loan_id = l.id), 0)::text AS received,
              GREATEST(0, l.total_payable - COALESCE((
                SELECT sum(co.amount) FROM collections co WHERE co.loan_id = l.id
              ), 0))::text AS remaining,
              (SELECT max(m.due_date) FROM emi_schedule m WHERE m.loan_id = l.id)::text AS closing_date
         FROM emi_schedule e
         JOIN loans l ON l.id = e.loan_id
         JOIN customers c ON c.id = l.customer_id
        WHERE e.due_date <= CURRENT_DATE AND e.status IN ('pending','partial')
        ORDER BY e.due_date ASC
        LIMIT 300`,
    );
    return rows;
  },

  async create(
    input: CreateCollectionBody & { agentId: string; createdBy: string; reconciledImmediately?: boolean },
    client: PoolClient,
  ) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO collections(loan_id, emi_id, agent_id, amount, penalty, type, mode, note, created_by, reconciled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10 THEN now() ELSE NULL END)
       RETURNING id`,
      [
        input.loanId,
        input.emiId ?? null,
        input.agentId,
        input.amount,
        input.penalty,
        input.type,
        input.mode,
        input.note ?? null,
        input.createdBy,
        input.reconciledImmediately ?? false,
      ],
    );
    return rows[0];
  },

  /**
   * Rebuild every EMI row of a loan from the loan's collection total. The
   * total collected (SUM of amounts) is poured into installments in order,
   * each row clamped at its due_amount — so an overpayment automatically
   * fills future EMIs ("advance") and a delete/edit automatically drains
   * them back. Penalties stay anchored to the EMI their entry points at.
   * Idempotent: record, edit and delete all converge on the same state.
   */
  async rebuildEmiState(loanId: string, client: PoolClient) {
    await client.query(
      `WITH totals AS (
         SELECT COALESCE(sum(amount), 0) AS collected
           FROM collections WHERE loan_id = $1
       ),
       fill AS (
         SELECT id, due_amount, due_date, missed_penalty,
                COALESCE(sum(due_amount) OVER (
                  ORDER BY installment_no
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0) AS prior_due
           FROM emi_schedule
          WHERE loan_id = $1
       )
       UPDATE emi_schedule e
          SET paid_amount = GREATEST(0, LEAST(f.due_amount, t.collected - f.prior_due)),
              penalty_amount = COALESCE(
                (SELECT sum(c.penalty) FROM collections c WHERE c.emi_id = e.id), 0),
              status = CASE
                WHEN GREATEST(0, LEAST(f.due_amount, t.collected - f.prior_due)) >= f.due_amount
                     AND f.due_date > CURRENT_DATE THEN 'advance'::emi_status
                WHEN GREATEST(0, LEAST(f.due_amount, t.collected - f.prior_due)) >= f.due_amount
                     THEN 'paid'::emi_status
                WHEN f.due_date < CURRENT_DATE OR f.missed_penalty > 0 THEN 'missed'::emi_status
                WHEN GREATEST(0, LEAST(f.due_amount, t.collected - f.prior_due)) > 0
                     THEN 'partial'::emi_status
                ELSE 'pending'::emi_status
              END
         FROM fill f, totals t
        WHERE e.id = f.id`,
      [loanId],
    );
  },

  /**
   * Agent explicitly marked the day missed — flip the EMI unless money already
   * covers it, and accrue the missed-day penalty (settings.penalty.per_day_pct
   * % of the loan principal) onto the EMI's missed_penalty and the loan's
   * total payable. The EMI's due_amount is NOT touched — payments always fill
   * base EMI days, and the penalty is recovered via the loan total instead.
   *
   * Grace rule: the FIRST miss of a streak is free — penalty applies only
   * from the 2nd consecutive missed day (previous installment also missed).
   * Paying a day resets the streak. missed_penalty=0 guard keeps the accrual
   * once-only per EMI.
   */
  async markEmiMissed(emiId: string, client: PoolClient) {
    await client.query(
      `UPDATE emi_schedule SET status = 'missed' WHERE id = $1 AND paid_amount < due_amount`,
      [emiId],
    );
    await client.query(
      `WITH pen AS (
         SELECT COALESCE((value->>'per_day_pct')::numeric, 0) AS pct FROM settings WHERE key = 'penalty'
       ),
       upd AS (
         UPDATE emi_schedule e
            SET missed_penalty = round(l.principal * pen.pct / 100, 2)
           FROM pen, loans l
          WHERE e.id = $1 AND l.id = e.loan_id
            AND e.status = 'missed' AND e.missed_penalty = 0 AND pen.pct > 0
            AND EXISTS (
              SELECT 1 FROM emi_schedule prev
               WHERE prev.loan_id = e.loan_id
                 AND prev.installment_no = e.installment_no - 1
                 AND prev.status = 'missed'
            )
          RETURNING e.loan_id, e.missed_penalty
       )
       UPDATE loans l
          SET total_payable = l.total_payable + u.missed_penalty
         FROM upd u
        WHERE l.id = u.loan_id`,
      [emiId],
    );
  },

  /**
   * Undo a missed-day penalty when the entry that caused it is deleted —
   * unless another 'missed' entry still anchors to the same EMI. Only the
   * loan's total_payable and the EMI's missed_penalty are reversed;
   * due_amount was never inflated by the penalty.
   */
  async reverseMissedPenalty(emiId: string, excludeCollectionId: string, client: PoolClient) {
    await client.query(
      `WITH old AS (
         SELECT id, loan_id, missed_penalty FROM emi_schedule
          WHERE id = $1 AND missed_penalty > 0
            AND NOT EXISTS (
              SELECT 1 FROM collections c
               WHERE c.emi_id = $1 AND c.type = 'missed' AND c.id <> $2
            )
          FOR UPDATE
       ),
       upd AS (
         UPDATE emi_schedule e
            SET missed_penalty = 0
           FROM old o WHERE e.id = o.id
       )
       UPDATE loans l
          SET total_payable = l.total_payable - o.missed_penalty
         FROM old o
        WHERE l.id = o.loan_id`,
      [emiId, excludeCollectionId],
    );
  },

  /** Lock a collection row for the duration of a delete transaction. */
  async findByIdForUpdate(id: string, client: PoolClient) {
    const { rows } = await client.query(`SELECT * FROM collections WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0] ?? null;
  },

  /** Admin correction — collectedAt keeps the entry's original time-of-day on a new date. */
  async updateEntry(
    id: string,
    input: { amount: number; penalty: number; type?: string; collectedAt: string | null },
    client: PoolClient,
  ) {
    await client.query(
      `UPDATE collections
          SET amount = $2, penalty = $3,
              type = COALESCE($4::payment_type, type),
              collected_at = COALESCE($5::timestamptz, collected_at)
        WHERE id = $1`,
      [id, input.amount, input.penalty, input.type ?? null, input.collectedAt],
    );
  },

  async deleteById(id: string, client: PoolClient) {
    await client.query(`DELETE FROM collections WHERE id = $1`, [id]);
  },
};
