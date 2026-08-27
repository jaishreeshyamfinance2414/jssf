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
 *
 * Concurrency guard: only one sweep runs at a time. The `running` flag
 * prevents both the hourly timer and the admin API from executing
 * simultaneously, which would deadlock on the same rows.
 */
let running = false;

export async function sweepMissedEmis(): Promise<{ missedMarked: number; penalized: number; advancesMatured: number }> {
  if (running) {
    logger.warn('Sweep already running — skipping duplicate invocation');
    return { missedMarked: 0, penalized: 0, advancesMatured: 0 };
  }
  running = true;
  try {
    return await withTransaction(async (client) => {
      // Guard: 30-second timeout so a slow query releases its pool connection
      // instead of hanging the entire server.
      await client.query('SET LOCAL statement_timeout = 30000');

      const inserted = await client.query(
        `INSERT INTO collections(loan_id, emi_id, amount, penalty, type, mode, note, reconciled_at, collected_at)
         SELECT e.loan_id, e.id, 0, 0, 'missed', 'cash',
                'Auto-marked: no collection recorded for this day', now(),
                e.due_date::timestamp + interval '23 hours 59 minutes'
           FROM emi_schedule e
           JOIN loans l ON l.id = e.loan_id AND l.status = 'active'
          WHERE e.due_date < CURRENT_DATE
            AND e.paid_amount < e.due_amount
            AND e.status IN ('pending', 'partial', 'missed')
            AND NOT EXISTS (SELECT 1 FROM collections c WHERE c.emi_id = e.id)`,
      );
      logger.debug({ rows: inserted.rowCount }, 'Sweep: missed entries inserted');

      const marked = await client.query(
        `UPDATE emi_schedule e
            SET status = 'missed'
           FROM loans l
          WHERE l.id = e.loan_id AND l.status = 'active'
            AND e.due_date < CURRENT_DATE
            AND e.paid_amount < e.due_amount
            AND e.status IN ('pending', 'partial')`,
      );
      logger.debug({ rows: marked.rowCount }, 'Sweep: EMIs marked missed');

      // Idempotent penalty recalculation: compute what each EMI's missed_penalty
      // SHOULD be based on the current streak state (1st miss free, 2nd+
      // consecutive miss penalized), compare with current value, update diffs,
      // and adjust loans.total_payable by the net delta per loan.
      const penalized = await client.query(
        `WITH pen AS (
           SELECT COALESCE((value->>'per_day_pct')::numeric, 0) AS pct FROM settings WHERE key = 'penalty'
         ),
         target AS (
           SELECT e.id, e.loan_id, e.missed_penalty AS old_penalty,
                  CASE
                    WHEN e.status = 'missed' AND pen.pct > 0 AND EXISTS (
                      SELECT 1 FROM emi_schedule prev
                       WHERE prev.loan_id = e.loan_id
                         AND prev.installment_no = e.installment_no - 1
                         AND prev.status = 'missed'
                    ) THEN round(l.principal * pen.pct / 100, 2)
                    ELSE 0
                  END AS new_penalty
             FROM emi_schedule e
             JOIN loans l ON l.id = e.loan_id AND l.status = 'active'
             CROSS JOIN pen
         ),
         diff AS (
           SELECT id, loan_id, old_penalty, new_penalty, (new_penalty - old_penalty) AS delta
             FROM target
            WHERE old_penalty <> new_penalty
         ),
         upd_emi AS (
           UPDATE emi_schedule e
              SET missed_penalty = d.new_penalty
             FROM diff d
            WHERE e.id = d.id
         ),
         by_loan AS (
           SELECT loan_id, sum(delta) AS net_delta
             FROM diff
            GROUP BY loan_id
         )
         UPDATE loans l
            SET total_payable = l.total_payable + b.net_delta
           FROM by_loan b
          WHERE l.id = b.loan_id
         RETURNING l.id`,
      );
      logger.debug({ rows: penalized.rowCount }, 'Sweep: penalties recalculated');

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
  } catch (err) {
    logger.error({ err }, 'Missed-EMI sweep failed');
    throw err;
  } finally {
    running = false;
  }
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
let timer: NodeJS.Timeout | null = null;

export function startMissedEmiJob(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const result = await sweepMissedEmis();
      if (result.missedMarked > 0 || result.penalized > 0 || result.advancesMatured > 0) {
        logger.info(result, 'Missed-EMI sweep applied changes');
      }
    } catch {
      // already logged inside sweepMissedEmis
    }
  };
  void tick(); // catch up immediately on boot
  timer = setInterval(tick, SWEEP_INTERVAL_MS);
  return timer;
}
