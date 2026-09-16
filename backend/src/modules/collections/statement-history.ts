import { PoolClient } from 'pg';

/** Group once per business date, then walk receipts and scheduled dues together.
 * Payment dates, including admin backdates, determine historical coverage.
 * Never use today's lifetime total to classify an earlier statement day.
 */
export function historyCtes(scoped: boolean, includeClosed = false): string {
  return `scope AS MATERIALIZED (
    SELECT id, loan_date FROM loans
     WHERE ${scoped ? `id = $1${includeClosed ? '' : ' AND closed_by IS NULL'}` : "status = 'active'"}
  ),
  receipts AS MATERIALIZED (
    SELECT c.loan_id, c.collected_at::date AS day, sum(c.amount + c.penalty) AS received
      FROM collections c JOIN scope s ON s.id = c.loan_id
     GROUP BY c.loan_id, c.collected_at::date
  ),
  contracts AS MATERIALIZED (
    SELECT e.loan_id,sum(e.due_amount) AS total FROM emi_schedule e
      JOIN scope s ON s.id = e.loan_id GROUP BY e.loan_id
  ),
  events AS (
    SELECT loan_id, day, received, 0::numeric AS due, 0::numeric AS penalty FROM receipts
    UNION ALL
    SELECT e.loan_id, e.due_date, 0::numeric, e.due_amount, 0::numeric
      FROM emi_schedule e JOIN scope s ON s.id = e.loan_id
    UNION ALL
    SELECT p.loan_id, p.penalty_date, 0::numeric, p.amount, p.amount
      FROM loan_daily_penalties p JOIN scope s ON s.id = p.loan_id
    UNION ALL
    SELECT s.id, d::date, 0::numeric, 0::numeric, 0::numeric
      FROM scope s CROSS JOIN LATERAL generate_series(s.loan_date, CURRENT_DATE, interval '1 day') d
  ),
  days AS (
    SELECT loan_id, day, sum(received) AS day_received, sum(due) AS day_due, sum(penalty) AS day_penalty
      FROM events GROUP BY loan_id, day
  ),
  running AS MATERIALIZED (
    SELECT loan_id, day, day_received, day_due,
           sum(day_received) OVER w AS received_by_day,
           sum(day_due) OVER w AS due_by_day,
           sum(day_penalty) OVER w AS penalty_by_day
      FROM days
    WINDOW w AS (PARTITION BY loan_id ORDER BY day ROWS UNBOUNDED PRECEDING)
  ),
  historical AS MATERIALIZED (
    SELECT e.id, r.loan_id, e.installment_no, r.day AS due_date, e.due_amount,
           r.day_received, r.received_by_day, r.due_by_day,
           r.received_by_day - r.day_received < contract.total + r.penalty_by_day AS should_create,
           CASE WHEN r.received_by_day < r.due_by_day THEN 'missed'::payment_type
                WHEN r.received_by_day > r.due_by_day THEN 'advance'::payment_type
                ELSE 'full'::payment_type END AS desired_type
      FROM running r JOIN scope s ON s.id = r.loan_id
      JOIN contracts contract ON contract.loan_id = r.loan_id
      LEFT JOIN emi_schedule e ON e.loan_id = r.loan_id AND e.due_date = r.day
     WHERE r.day >= s.loan_date
  )`;
}

export async function reconcileHistory(loanId: string | null, client: PoolClient, deletedAt?: Date | string) {
  const penalized = await reconcileHistoricalPenalties(loanId, client);
  const params = loanId ? [loanId] : [];
  const ctes = historyCtes(!!loanId);
  // Real receipts are classified too, including after backdated corrections.
  // A positive receipt which leaves arrears is Partial, never a zero-money Missed.
  await client.query(`WITH ${ctes}, classified AS (
    SELECT c.id, CASE WHEN r.received_by_day > r.due_by_day THEN 'advance'::payment_type
                     WHEN r.received_by_day = r.due_by_day THEN 'full'::payment_type
                     ELSE 'partial'::payment_type END AS desired_type
      FROM collections c JOIN running r ON r.loan_id = c.loan_id AND r.day = c.collected_at::date
     WHERE c.amount + c.penalty > 0
  ) UPDATE collections c SET type = t.desired_type FROM classified t
     WHERE c.id = t.id AND c.type IS DISTINCT FROM t.desired_type`, params);
  // A backdated payoff can make later zero-money system rows unnecessary.
  // Preserve every real/manual entry, including zero-value admin entries.
  await client.query(`WITH ${ctes} DELETE FROM collections c USING historical h
    WHERE c.loan_id = h.loan_id AND c.collected_at::date = h.due_date
      AND NOT h.should_create AND c.amount = 0 AND c.penalty = 0
      AND c.created_by IS NULL AND c.note IN (
        'Auto-marked: no collection recorded for this day',
        'Auto-marked: installment covered by advance payment',
        'Auto-marked: advance coverage completed on time')`, params);
  // Update in place, including Advance -> Missed after a correction. This
  // preserves IDs and avoids deleting a row only to recreate it next sweep.
  await client.query(`WITH ${ctes}
    UPDATE collections c
       SET type = h.desired_type,
           note = CASE WHEN c.created_by IS NOT NULL THEN c.note
                       WHEN h.desired_type = 'missed' THEN 'Auto-marked: no collection recorded for this day'
                       WHEN h.desired_type = 'advance' THEN 'Auto-marked: installment covered by advance payment'
                       ELSE 'Auto-marked: advance coverage completed on time' END
      FROM historical h
     WHERE c.loan_id = h.loan_id
       AND c.collected_at >= h.due_date::timestamp
       AND c.collected_at < h.due_date::timestamp + interval '1 day'
       AND h.due_date <= CURRENT_DATE
       AND c.amount = 0 AND c.penalty = 0
       AND c.type IN ('missed','advance','full','partial')
       AND c.type IS DISTINCT FROM h.desired_type`, params);

  const { rows } = await client.query<{ type: string }>(`WITH ${ctes}
    INSERT INTO collections(loan_id, emi_id, amount, penalty, type, mode, note, reconciled_at, collected_at)
    SELECT h.loan_id, h.id, 0, 0, h.desired_type, 'cash',
           CASE WHEN h.desired_type = 'missed' THEN 'Auto-marked: no collection recorded for this day'
                WHEN h.desired_type = 'advance' THEN 'Auto-marked: installment covered by advance payment'
                ELSE 'Auto-marked: advance coverage completed on time' END,
           now(), h.due_date::timestamp + interval '23 hours 59 minutes'
      FROM historical h
     WHERE h.due_date < CURRENT_DATE
       AND h.should_create
       ${deletedAt && loanId ? 'AND h.due_date <> $2::timestamptz::date' : ''}
       AND NOT EXISTS (
         SELECT 1 FROM collections c WHERE c.loan_id = h.loan_id
          AND c.collected_at >= h.due_date::timestamp
          AND c.collected_at < h.due_date::timestamp + interval '1 day'
       )
    RETURNING type`, deletedAt && loanId ? [...params, deletedAt] : params);
  return {
    penalized,
    advanceEntries: rows.filter(r => r.type === 'advance').length,
    onTimeEntries: rows.filter(r => r.type === 'full').length,
    missedEntries: rows.filter(r => r.type === 'missed').length,
  };
}

/** Reconstruct daily charges chronologically, never from stored penalty totals.
 * Each day checks scheduled dues + PRIOR penalties - dated receipts. Today's
 * charge is added only once, then participates in subsequent days' thresholds.
 * Full-term EMI debt is capped by the schedule; calendar days are not capped.
 */
export async function reconcileHistoricalPenalties(loanId: string | null, client: PoolClient) {
  const result = await client.query(`WITH RECURSIVE
    scope AS MATERIALIZED (
      SELECT id, loan_date, emi_amount,
             round(principal * COALESCE((SELECT (value->>'per_day_pct')::numeric
               FROM settings WHERE key = 'penalty'),0) / 100,2) AS daily_charge
        FROM loans WHERE ${loanId ? "id = $1 AND closed_by IS NULL AND status IN ('active','closed')" : "status = 'active' AND closed_by IS NULL"}
    ),
    events AS (
      SELECT e.loan_id, e.due_date AS day, e.due_amount AS due, 0::numeric AS received
        FROM emi_schedule e JOIN scope s ON s.id = e.loan_id WHERE e.due_date <= CURRENT_DATE
      UNION ALL
      SELECT c.loan_id, c.collected_at::date, 0::numeric, c.amount + c.penalty
        FROM collections c JOIN scope s ON s.id = c.loan_id
       WHERE c.collected_at < CURRENT_DATE::timestamp + interval '1 day'
      UNION ALL
      SELECT s.id, d::date, 0::numeric, 0::numeric FROM scope s
        CROSS JOIN LATERAL generate_series(s.loan_date,CURRENT_DATE,interval '1 day') d
    ),
    grouped AS (SELECT loan_id,day,sum(due) AS due,sum(received) AS received FROM events GROUP BY loan_id,day),
    inputs AS MATERIALIZED (
      SELECT g.*, row_number() OVER w AS n, sum(due) OVER w - sum(received) OVER w AS base_shortfall,
             s.emi_amount * 3 AS allowance, s.daily_charge, s.loan_date
        FROM grouped g JOIN scope s ON s.id = g.loan_id
      WINDOW w AS (PARTITION BY g.loan_id ORDER BY day)
    ),
    walk AS (
      SELECT i.loan_id, i.day, i.n, charge.amount AS penalty, charge.amount AS accrued
        FROM inputs i CROSS JOIN LATERAL (
          SELECT CASE WHEN i.day >= i.loan_date AND i.base_shortfall > i.allowance
                      THEN i.daily_charge ELSE 0::numeric END AS amount
        ) charge WHERE i.n = 1
      UNION ALL
      SELECT i.loan_id, i.day, i.n, charge.amount, w.accrued + charge.amount
        FROM walk w JOIN inputs i ON i.loan_id = w.loan_id AND i.n = w.n + 1
        CROSS JOIN LATERAL (
          SELECT CASE WHEN i.day >= i.loan_date AND i.base_shortfall + w.accrued > i.allowance
                      THEN i.daily_charge ELSE 0::numeric END AS amount
        ) charge
    ),
    target AS MATERIALIZED (SELECT loan_id,day,penalty FROM walk),
    old_totals AS MATERIALIZED (
      SELECT s.id, COALESCE(sum(p.amount),0) AS amount FROM scope s
        LEFT JOIN loan_daily_penalties p ON p.loan_id = s.id GROUP BY s.id
    ),
    new_totals AS (SELECT loan_id,sum(penalty) AS amount FROM target GROUP BY loan_id),
    removed AS (
      DELETE FROM loan_daily_penalties p USING scope s
       WHERE p.loan_id = s.id AND NOT EXISTS (
         SELECT 1 FROM target t WHERE t.loan_id = p.loan_id AND t.day = p.penalty_date AND t.penalty > 0)
      RETURNING p.loan_id
    ),
    saved AS (
      INSERT INTO loan_daily_penalties(loan_id,penalty_date,amount)
      SELECT loan_id,day,penalty FROM target WHERE penalty > 0
      ON CONFLICT (loan_id,penalty_date) DO UPDATE SET amount = EXCLUDED.amount
        WHERE loan_daily_penalties.amount IS DISTINCT FROM EXCLUDED.amount
      RETURNING loan_id
    ),
    mirror AS (
      UPDATE emi_schedule e SET missed_penalty = COALESCE(t.penalty,0)
        FROM emi_schedule scheduled JOIN scope s ON s.id = scheduled.loan_id
        LEFT JOIN target t ON t.loan_id = scheduled.loan_id AND t.day = scheduled.due_date
       WHERE e.id = scheduled.id
         AND e.missed_penalty IS DISTINCT FROM COALESCE(t.penalty,0)
      RETURNING e.id
    ),
    deltas AS (SELECT o.id,COALESCE(n.amount,0) - o.amount AS delta
                 FROM old_totals o LEFT JOIN new_totals n ON n.loan_id = o.id)
    UPDATE loans l SET total_payable = l.total_payable + d.delta
      FROM deltas d WHERE l.id = d.id AND d.delta <> 0 RETURNING l.id`, loanId ? [loanId] : []);
  return result.rowCount ?? 0;
}
