import { PoolClient } from 'pg';
import { query } from '../../db/pool';
import { CreateCollectionBody } from './collection.schema';

export const collectionRepository = {
  /**
   * Runtime rollout guard for deployments where the API is restarted before
   * the latest migration command is run. Keeping this idempotent prevents the
   * statement/penalty sweep from failing before it reaches penalty handling.
   */
  async ensureStatementInfrastructure() {
    await query(
      `CREATE TABLE IF NOT EXISTS statement_entry_suppressions (
         emi_id uuid PRIMARY KEY REFERENCES emi_schedule(id) ON DELETE CASCADE,
         loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
         suppressed_by uuid REFERENCES users(id) ON DELETE SET NULL,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_statement_suppressions_loan
         ON statement_entry_suppressions(loan_id)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_collections_emi_id
         ON collections(emi_id)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_collections_loan_collected_at
         ON collections(loan_id, collected_at)`,
    );
  },

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
              COALESCE(agent.full_name, creator.full_name, 'Automatic') AS agent_name,
              e.missed_penalty
         FROM collections co
         JOIN loans l ON l.id = co.loan_id
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN users agent ON agent.id = co.agent_id
         LEFT JOIN users creator ON creator.id = co.created_by
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
              c.work AS customer_work,
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
              (SELECT COALESCE(sum(m.missed_penalty), 0) FROM emi_schedule m
                WHERE m.loan_id = l.id)::text AS total_penalty,
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
      `INSERT INTO collections(loan_id, emi_id, agent_id, amount, penalty, type, mode, note, created_by, reconciled_at, collected_at)
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         CASE WHEN $10 THEN now() ELSE NULL END,
         CASE WHEN $11::date IS NULL THEN now() ELSE ($11::date + LOCALTIME)::timestamptz END
       )
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
        input.collectedDate ?? null,
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

  /** Repair derived EMI balances/statuses for every active loan in one pass. */
  async rebuildAllActiveEmiStates(client: PoolClient) {
    await client.query(
      `WITH totals AS MATERIALIZED (
         SELECT l.id AS loan_id, COALESCE(sum(c.amount), 0) AS collected
           FROM loans l
           LEFT JOIN collections c ON c.loan_id = l.id
          WHERE l.status = 'active'
          GROUP BY l.id
       ),
       collection_penalties AS MATERIALIZED (
         SELECT c.emi_id, sum(c.penalty) AS penalty_total
           FROM collections c
          WHERE c.emi_id IS NOT NULL
          GROUP BY c.emi_id
       ),
       fill AS MATERIALIZED (
         SELECT e.id, e.loan_id, e.due_amount, e.due_date, e.missed_penalty,
                COALESCE(p.penalty_total, 0) AS penalty_total,
                COALESCE(sum(e.due_amount) OVER (
                  PARTITION BY e.loan_id
                  ORDER BY e.installment_no
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0) AS prior_due
           FROM emi_schedule e
           JOIN loans l ON l.id = e.loan_id AND l.status = 'active'
           LEFT JOIN collection_penalties p ON p.emi_id = e.id
       )
       UPDATE emi_schedule e
          SET paid_amount = GREATEST(0, LEAST(f.due_amount, t.collected - f.prior_due)),
              penalty_amount = f.penalty_total,
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
         FROM fill f
         JOIN totals t ON t.loan_id = f.loan_id
        WHERE e.id = f.id`,
    );
  },

  /**
   * Immediately reconcile past derived statement rows after a payment changes.
   * Covered missed rows become Advance/Full, existing automatic coverage rows
   * change classification, and automatic rows that are no longer funded are
   * removed. Missing covered dates are materialized in the same transaction.
   */
  async reconcileStatementCoverage(loanId: string | null, client: PoolClient) {
    const loanFilter = loanId ? 'AND l.id = $1' : '';
    const collectionFilter = loanId ? 'WHERE c.loan_id = $1' : '';
    const params = loanId ? [loanId] : [];
    const { rows } = await client.query<{ advance_entries: number; on_time_entries: number }>(
      `WITH collection_totals AS MATERIALIZED (
         SELECT c.loan_id, sum(c.amount) AS total_received
           FROM collections c
           ${collectionFilter}
          GROUP BY c.loan_id
       ),
       scheduled AS MATERIALIZED (
         SELECT e.id, e.loan_id, e.due_date,
                sum(e.due_amount) OVER (
                  PARTITION BY e.loan_id
                  ORDER BY e.installment_no
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS cumulative_due,
                COALESCE(t.total_received, 0) AS total_received
           FROM emi_schedule e
           JOIN loans l ON l.id = e.loan_id AND l.status = 'active' ${loanFilter}
           LEFT JOIN collection_totals t ON t.loan_id = e.loan_id
       ),
       desired AS MATERIALIZED (
         SELECT s.*,
                CASE WHEN s.total_received > s.cumulative_due + 0.01
                     THEN 'advance'::payment_type ELSE 'full'::payment_type END AS desired_type
           FROM scheduled s
          WHERE s.due_date < CURRENT_DATE
            AND s.total_received >= s.cumulative_due - 0.01
       ),
       converted AS (
         UPDATE collections entry
            SET type = d.desired_type,
                note = CASE
                  WHEN entry.created_by IS NULL AND d.desired_type = 'advance'
                    THEN 'Auto-marked: installment covered by advance payment'
                  WHEN entry.created_by IS NULL
                    THEN 'Auto-marked: advance coverage completed on time'
                  ELSE entry.note
                END
           FROM desired d
          WHERE entry.loan_id = d.loan_id
            AND entry.emi_id = d.id
            AND entry.amount = 0
            AND (
              entry.type = 'missed'
              OR entry.note IN (
                'Auto-marked: installment covered by advance payment',
                'Auto-marked: advance coverage completed on time'
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM collections actual
               WHERE actual.loan_id = entry.loan_id
                 AND actual.collected_at >= entry.collected_at::date
                 AND actual.collected_at < entry.collected_at::date + interval '1 day'
                 AND actual.id <> entry.id
                 AND NOT (
                   actual.amount = 0 AND actual.note IN (
                     'Auto-marked: installment covered by advance payment',
                     'Auto-marked: advance coverage completed on time'
                   )
                 )
            )
          RETURNING entry.id
       ),
       removed AS (
         DELETE FROM collections marker
          WHERE marker.amount = 0
            AND EXISTS (
              SELECT 1 FROM loans active_loan
               WHERE active_loan.id = marker.loan_id
                 AND active_loan.status = 'active'
            )
            AND marker.note IN (
              'Auto-marked: installment covered by advance payment',
              'Auto-marked: advance coverage completed on time'
            )
            AND ${loanId ? 'marker.loan_id = $1' : 'TRUE'}
            AND (
              NOT EXISTS (SELECT 1 FROM desired d WHERE d.id = marker.emi_id)
              OR EXISTS (
                SELECT 1 FROM collections actual
                 WHERE actual.loan_id = marker.loan_id
                   AND actual.collected_at >= marker.collected_at::date
                   AND actual.collected_at < marker.collected_at::date + interval '1 day'
                   AND actual.id <> marker.id
                   AND NOT (
                     actual.amount = 0 AND actual.note IN (
                       'Auto-marked: installment covered by advance payment',
                       'Auto-marked: advance coverage completed on time'
                     )
                   )
              )
            )
          RETURNING marker.id
       ),
       added AS (
         INSERT INTO collections(
           loan_id, emi_id, amount, penalty, type, mode, note, reconciled_at, collected_at
         )
         SELECT d.loan_id, d.id, 0, 0, d.desired_type, 'cash',
                CASE WHEN d.desired_type = 'advance'
                     THEN 'Auto-marked: installment covered by advance payment'
                     ELSE 'Auto-marked: advance coverage completed on time' END,
                now(), d.due_date::timestamp + interval '23 hours 59 minutes'
           FROM desired d
          WHERE NOT EXISTS (
                  SELECT 1 FROM statement_entry_suppressions suppressed
                   WHERE suppressed.emi_id = d.id
                )
            AND NOT EXISTS (
                  SELECT 1 FROM collections existing
                   WHERE existing.loan_id = d.loan_id
                     AND existing.collected_at >= d.due_date::timestamp
                     AND existing.collected_at < d.due_date::timestamp + interval '1 day'
                )
          RETURNING type
       )
       SELECT count(*) FILTER (WHERE type = 'advance')::int AS advance_entries,
              count(*) FILTER (WHERE type = 'full')::int AS on_time_entries
         FROM added`,
      params,
    );

    return {
      advanceEntries: rows[0]?.advance_entries ?? 0,
      onTimeEntries: rows[0]?.on_time_entries ?? 0,
    };
  },

  /**
   * Agent explicitly marked the day missed — flip the EMI unless money already
   * covers it, and accrue the missed-day penalty (settings.penalty.per_day_pct
   * % of the loan principal) onto the EMI's missed_penalty and the loan's
   * total payable. The EMI's due_amount is NOT touched — payments always fill
   * base EMI days, and the penalty is recovered via the loan total instead.
   *
   * Grace rule: the first THREE misses of a streak are free — penalty applies
   * from the 4th consecutive missed installment. Paying an installment resets
   * the streak. missed_penalty=0 keeps the accrual once-only per EMI.
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
            AND (
              SELECT count(*) FROM emi_schedule prev
               WHERE prev.loan_id = e.loan_id
                 AND prev.installment_no BETWEEN e.installment_no - 3 AND e.installment_no - 1
                 AND prev.status = 'missed'
            ) = 3
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
    input: {
      amount: number;
      penalty: number;
      type?: string;
      collectedAt: string | null;
      takeOwnership?: { actorId: string };
    },
    client: PoolClient,
  ) {
    await client.query(
      `UPDATE collections
          SET amount = $2, penalty = $3,
              type = COALESCE($4::payment_type, type),
              collected_at = COALESCE($5::timestamptz, collected_at),
              agent_id = CASE WHEN $6::uuid IS NULL THEN agent_id ELSE $6::uuid END,
              created_by = CASE WHEN $6::uuid IS NULL THEN created_by ELSE $6::uuid END,
              note = CASE WHEN $6::uuid IS NULL THEN note ELSE NULL END
         WHERE id = $1`,
      [id, input.amount, input.penalty, input.type ?? null, input.collectedAt, input.takeOwnership?.actorId ?? null],
    );
  },

  async deleteById(id: string, client: PoolClient) {
    await client.query(`DELETE FROM collections WHERE id = $1`, [id]);
  },

  /** Prevent the hourly sweep from recreating an automatic statement row deleted by an admin. */
  async suppressAutomaticStatementEntry(emiId: string, loanId: string, actorId: string, client: PoolClient) {
    await client.query(
      `INSERT INTO statement_entry_suppressions(emi_id, loan_id, suppressed_by)
       VALUES ($1,$2,$3)
       ON CONFLICT (emi_id) DO UPDATE
         SET suppressed_by = EXCLUDED.suppressed_by, created_at = now()`,
      [emiId, loanId, actorId],
    );
  },
};
