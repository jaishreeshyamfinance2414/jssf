import { logger } from '../../config/logger';
import { withTransaction } from '../../db/pool';

/**
 * Daily-entry guarantee: every active loan must have an entry for every EMI
 * day. If an agent recorded nothing against a due EMI by end of day, the
 * sweep inserts a zero-amount 'missed' collection entry (stamped 23:59 of the
 * due date) and flips the EMI to 'missed'. It also promotes 'advance' EMIs
 * whose day has arrived to 'paid'.
 *
 * Idempotent — the NOT EXISTS guard and the status predicates make repeat
 * runs no-ops, so it's safe to run at startup and on every interval tick.
 */
export async function sweepMissedEmis(): Promise<{ missedMarked: number; penalized: number; advancesMatured: number }> {
  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO collections(loan_id, emi_id, amount, penalty, type, mode, note, reconciled_at, collected_at)
       SELECT e.loan_id, e.id, 0, 0, 'missed', 'cash',
              'Auto-marked: no collection recorded for this day', now(),
              e.due_date::timestamp + interval '23 hours 59 minutes'
         FROM emi_schedule e
         JOIN loans l ON l.id = e.loan_id AND l.status = 'active'
        WHERE e.due_date < CURRENT_DATE
          AND e.paid_amount < e.due_amount
          AND e.status IN ('pending', 'partial')
          AND NOT EXISTS (SELECT 1 FROM collections c WHERE c.emi_id = e.id)`,
    );

    const marked = await client.query(
      `UPDATE emi_schedule e
          SET status = 'missed'
         FROM loans l
        WHERE l.id = e.loan_id AND l.status = 'active'
          AND e.due_date < CURRENT_DATE
          AND e.paid_amount < e.due_amount
          AND e.status IN ('pending', 'partial')`,
    );

    // Accrue the missed-day penalty (settings.penalty.per_day_pct % of the
    // loan principal) onto newly missed EMIs. Grace rule: the first miss of a
    // streak is free — only the 2nd+ consecutive missed day is penalized
    // (previous installment also missed). missed_penalty=0 keeps this
    // once-only per EMI.
    const penalized = await client.query(
      `WITH pen AS (
         SELECT COALESCE((value->>'per_day_pct')::numeric, 0) AS pct FROM settings WHERE key = 'penalty'
       ),
       upd AS (
         UPDATE emi_schedule e
            SET missed_penalty = round(l.principal * pen.pct / 100, 2),
                due_amount = e.due_amount + round(l.principal * pen.pct / 100, 2)
           FROM pen, loans l
          WHERE l.id = e.loan_id AND l.status = 'active'
            AND e.status = 'missed' AND e.missed_penalty = 0 AND pen.pct > 0
            AND EXISTS (
              SELECT 1 FROM emi_schedule prev
               WHERE prev.loan_id = e.loan_id
                 AND prev.installment_no = e.installment_no - 1
                 AND prev.status = 'missed'
            )
          RETURNING e.loan_id, e.missed_penalty
       ),
       by_loan AS (
         SELECT loan_id, sum(missed_penalty) AS added FROM upd GROUP BY loan_id
       )
       UPDATE loans l
          SET total_payable = l.total_payable + b.added
         FROM by_loan b
        WHERE l.id = b.loan_id`,
    );

    const matured = await client.query(
      `UPDATE emi_schedule SET status = 'paid'
        WHERE status = 'advance' AND due_date <= CURRENT_DATE`,
    );

    return {
      missedMarked: (inserted.rowCount ?? 0) + (marked.rowCount ?? 0),
      penalized: penalized.rowCount ?? 0,
      advancesMatured: matured.rowCount ?? 0,
    };
  });
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly — cheap and keeps the day boundary tight
let running = false;

export function startMissedEmiJob(): NodeJS.Timeout {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await sweepMissedEmis();
      if (result.missedMarked > 0 || result.penalized > 0 || result.advancesMatured > 0) {
        logger.info(result, 'Missed-EMI sweep applied changes');
      }
    } catch (err) {
      logger.error({ err }, 'Missed-EMI sweep failed');
    } finally {
      running = false;
    }
  };
  void tick(); // catch up immediately on boot
  const timer = setInterval(tick, SWEEP_INTERVAL_MS);
  timer.unref(); // never keep the process alive just for the sweep
  return timer;
}
