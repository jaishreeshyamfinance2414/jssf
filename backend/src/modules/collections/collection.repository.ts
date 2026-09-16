import { PoolClient } from 'pg';
import { query } from '../../db/pool';
import { CreateCollectionBody } from './collection.schema';
import { reconcileHistory } from './statement-history';
import { loanBalanceJoin } from '../loans/loan-balance';

export const collectionRepository = {
  /**
   * Runtime rollout guard for deployments where the API is restarted before
   * the latest migration command is run. Keeping this idempotent prevents the
   * statement/penalty sweep from failing before it reaches penalty handling.
   */
  async ensureStatementInfrastructure() {
    await query(`CREATE TABLE IF NOT EXISTS loan_daily_penalties (
      loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      penalty_date date NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount >= 0),
      PRIMARY KEY (loan_id, penalty_date))`);
    await query(`INSERT INTO loan_daily_penalties(loan_id,penalty_date,amount)
      SELECT loan_id,due_date,sum(missed_penalty) FROM emi_schedule
      GROUP BY loan_id,due_date HAVING sum(missed_penalty) > 0
      ON CONFLICT (loan_id,penalty_date) DO NOTHING`);
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

  /** Both EMI and separate penalty receipts settle the combined payable. */
  async totalCollectedForLoan(loanId: string, client: PoolClient): Promise<number> {
    const { rows } = await client.query<{ s: string }>(
      `SELECT COALESCE(sum(amount + penalty), 0)::text AS s FROM collections WHERE loan_id = $1
        AND collected_at < CURRENT_DATE::timestamp + interval '1 day'`,
      [loanId],
    );
    return Number(rows[0].s);
  },

  async list() {
    const { rows } = await query(
      `SELECT co.*, l.loan_number, c.full_name AS customer_name, c.mobile AS customer_mobile,
              COALESCE(agent.full_name, creator.full_name, 'Automatic') AS agent_name,
              COALESCE((SELECT p.amount FROM loan_daily_penalties p
                WHERE p.loan_id = co.loan_id AND p.penalty_date = co.collected_at::date
                  AND p.penalty_date < CURRENT_DATE),0) AS missed_penalty
         FROM collections co
         JOIN loans l ON l.id = co.loan_id
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN users agent ON agent.id = co.agent_id
         LEFT JOIN users creator ON creator.id = co.created_by
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
      `SELECT l.id AS loan_id, l.loan_number, l.principal, dues.total_payable, l.emi_amount,
              l.emi_frequency, l.loan_date::text AS start_date,
              c.full_name AS customer_name, c.mobile AS customer_mobile,
              c.work AS customer_work,
              a.name AS area_name,
              coverage.missed_count, balance.shortfall::text AS due_till_today,
              dues.expected::text AS expected_till_today,
              coverage.advance_count, balance.advance::text AS advance_amount,
              receipts.received::text, balance.remaining::text,
              dues.closing_date::text, coverage.next_due_date::text,
              dues.penalty::text AS total_penalty,
              t.today_type, t.today_mode, t.today_amount, t.today_at
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN areas a ON a.id = c.area_id
         ${loanBalanceJoin}
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
      `SELECT e.*, l.loan_number, l.principal, dues.total_payable, l.loan_date::text AS start_date,
              LEAST(l.emi_amount,balance.shortfall)::text AS collection_due,
              c.full_name AS customer_name, c.mobile AS customer_mobile,
              coverage.missed_count, balance.shortfall::text AS due_till_today,
              dues.expected::text AS expected_till_today,
              receipts.received::text, balance.remaining::text,
              dues.closing_date::text
         FROM emi_schedule e
         JOIN loans l ON l.id = e.loan_id
         JOIN customers c ON c.id = l.customer_id
         ${loanBalanceJoin}
        WHERE l.status = 'active'
          AND e.due_date = COALESCE(coverage.next_due_date,dues.closing_date)
          AND e.due_date <= CURRENT_DATE AND balance.shortfall > 0
          AND NOT EXISTS (SELECT 1 FROM collections today WHERE today.loan_id = l.id
            AND today.collected_at >= CURRENT_DATE AND today.collected_at < CURRENT_DATE + interval '1 day')
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
             AND collected_at < CURRENT_DATE::timestamp + interval '1 day'
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
                WHEN f.due_date < CURRENT_DATE THEN 'missed'::emi_status
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
             AND c.collected_at < CURRENT_DATE::timestamp + interval '1 day'
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
                WHEN f.due_date < CURRENT_DATE THEN 'missed'::emi_status
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
   * change classification using receipts available on each date. Rows no
   * longer covered become Missed; missing elapsed dates are materialized.
   */
  async reconcileStatementCoverage(loanId: string | null, client: PoolClient, deletedAt?: Date | string) {
    return reconcileHistory(loanId, client, deletedAt);
  },

  /** Explicit missed marker; the shared history calculation handles penalties. */
  async markEmiMissed(emiId: string, client: PoolClient) {
    await client.query(
      `UPDATE emi_schedule SET status = 'missed' WHERE id = $1 AND paid_amount < due_amount`,
      [emiId],
    );
  },

  /** Lock a collection row for the duration of a delete transaction. */
  async findByIdForUpdate(id: string, client: PoolClient) {
    // Always lock loan before collection, matching record() and the sweep.
    await client.query(`SELECT l.id FROM loans l JOIN collections c ON c.loan_id = l.id
                         WHERE c.id = $1 FOR UPDATE OF l`, [id]);
    const { rows } = await client.query(`SELECT *, collected_at::date::text AS entry_date
      FROM collections WHERE id = $1 FOR UPDATE`, [id]);
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
              collected_at = CASE WHEN $5::date IS NULL THEN collected_at
                                  ELSE ($5::date + collected_at::time)::timestamptz END,
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

};
