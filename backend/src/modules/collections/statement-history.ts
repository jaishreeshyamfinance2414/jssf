import { PoolClient } from 'pg';

/** Group once per business date, then walk receipts and scheduled dues together.
 * Payment dates, including admin backdates, determine historical coverage.
 * Never use today's lifetime total to classify an earlier statement day.
 */
export function historyCtes(scoped: boolean): string {
  return `scope AS MATERIALIZED (
    SELECT id FROM loans
     WHERE ${scoped ? 'id = $1 AND closed_by IS NULL' : "status = 'active'"}
  ),
  receipts AS MATERIALIZED (
    SELECT c.loan_id, c.collected_at::date AS day, sum(c.amount) AS received
      FROM collections c JOIN scope s ON s.id = c.loan_id
     WHERE c.amount > 0
     GROUP BY c.loan_id, c.collected_at::date
  ),
  events AS (
    SELECT loan_id, day, received, 0::numeric AS due FROM receipts
    UNION ALL
    SELECT e.loan_id, e.due_date, 0::numeric, e.due_amount
      FROM emi_schedule e JOIN scope s ON s.id = e.loan_id
  ),
  days AS (
    SELECT loan_id, day, sum(received) AS day_received, sum(due) AS day_due
      FROM events GROUP BY loan_id, day
  ),
  running AS MATERIALIZED (
    SELECT loan_id, day, day_received,
           sum(day_received) OVER w AS received_by_day,
           sum(day_due) OVER w AS due_by_day
      FROM days
    WINDOW w AS (PARTITION BY loan_id ORDER BY day ROWS UNBOUNDED PRECEDING)
  ),
  historical AS MATERIALIZED (
    SELECT e.id, e.loan_id, e.installment_no, e.due_date, e.due_amount,
           r.day_received, r.received_by_day, r.due_by_day,
           CASE WHEN r.received_by_day < r.due_by_day - 0.01 THEN 'missed'::payment_type
                WHEN r.received_by_day > r.due_by_day + 0.01 THEN 'advance'::payment_type
                ELSE 'full'::payment_type END AS desired_type
      FROM emi_schedule e JOIN running r ON r.loan_id = e.loan_id AND r.day = e.due_date
  )`;
}

export async function reconcileHistory(loanId: string | null, client: PoolClient, deletedAt?: Date | string) {
  const params = loanId ? [loanId] : [];
  const ctes = historyCtes(!!loanId);
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
       AND h.due_date < CURRENT_DATE
       AND c.amount = 0 AND c.penalty = 0
       AND c.type IN ('missed','advance','full')
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
       ${deletedAt && loanId ? 'AND h.due_date <> $2::timestamptz::date' : ''}
       AND NOT EXISTS (SELECT 1 FROM statement_entry_suppressions s WHERE s.emi_id = h.id)
       AND NOT EXISTS (
         SELECT 1 FROM collections c WHERE c.loan_id = h.loan_id
          AND c.collected_at >= h.due_date::timestamp
          AND c.collected_at < h.due_date::timestamp + interval '1 day'
       )
    RETURNING type`, deletedAt && loanId ? [...params, deletedAt] : params);
  return {
    advanceEntries: rows.filter(r => r.type === 'advance').length,
    onTimeEntries: rows.filter(r => r.type === 'full').length,
    missedEntries: rows.filter(r => r.type === 'missed').length,
  };
}

/** A later payment settles the balance but cannot erase an earlier missed day.
 * A full installment actually collected on a date breaks the missed streak.
 */
export async function reconcileHistoricalPenalties(loanId: string | null, client: PoolClient) {
  const result = await client.query(`WITH ${historyCtes(!!loanId)},
    missed_days AS (
      SELECT h.*, (h.desired_type = 'missed' AND h.day_received < h.due_amount - 0.01
                   AND (h.due_date < CURRENT_DATE OR (h.due_date = CURRENT_DATE AND EXISTS (
                     SELECT 1 FROM collections c WHERE c.loan_id = h.loan_id
                      AND c.collected_at::date = h.due_date AND c.type = 'missed'
                   )))) AS missed
        FROM historical h
    ),
    streaks AS (
      SELECT *, lag(missed,1) OVER w AS m1, lag(missed,2) OVER w AS m2,
                lag(missed,3) OVER w AS m3 FROM missed_days
      WINDOW w AS (PARTITION BY loan_id ORDER BY installment_no)
    ),
    target AS (
      SELECT e.id, e.loan_id, e.missed_penalty AS old_penalty,
             CASE WHEN s.missed AND s.m1 AND s.m2 AND s.m3
                  THEN round(l.principal * COALESCE((SELECT (value->>'per_day_pct')::numeric
                         FROM settings WHERE key = 'penalty'),0) / 100,2)
                  ELSE 0 END AS new_penalty
        FROM streaks s JOIN emi_schedule e ON e.id = s.id JOIN loans l ON l.id = e.loan_id
    ),
    changed AS (
      UPDATE emi_schedule e SET missed_penalty = t.new_penalty FROM target t
       WHERE e.id = t.id AND t.old_penalty IS DISTINCT FROM t.new_penalty
      RETURNING t.loan_id, t.new_penalty - t.old_penalty AS delta
    ),
    deltas AS (SELECT loan_id, sum(delta) AS delta FROM changed GROUP BY loan_id)
    UPDATE loans l SET total_payable = l.total_payable + d.delta
      FROM deltas d WHERE l.id = d.loan_id RETURNING l.id`, loanId ? [loanId] : []);
  return result.rowCount ?? 0;
}
