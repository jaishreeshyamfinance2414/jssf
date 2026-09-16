import { logger } from '../../config/logger';
import { withTransaction } from '../../db/pool';
import { collectionRepository } from './collection.repository';

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

export async function sweepMissedEmis(): Promise<{
  missedMarked: number;
  penalized: number;
  advancesMatured: number;
  advanceEntries: number;
  onTimeEntries: number;
}> {
  if (running) {
    logger.warn('Sweep already running — skipping duplicate invocation');
    return { missedMarked: 0, penalized: 0, advancesMatured: 0, advanceEntries: 0, onTimeEntries: 0 };
  }
  running = true;
  try {
    return await withTransaction(async (client) => {
      // Guard: 30-second timeout so a slow query releases its pool connection
      // instead of hanging the entire server.
      await client.query('SET LOCAL statement_timeout = 30000');

      // `running` protects one Node process. This transaction-level lock also
      // prevents two deployed API instances/manual sweeps from writing the
      // same statement dates concurrently.
      const { rows: sweepLock } = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_xact_lock(742019017) AS acquired`,
      );
      if (!sweepLock[0]?.acquired) {
        logger.warn('Sweep already running in another process — skipping duplicate invocation');
        return { missedMarked: 0, penalized: 0, advancesMatured: 0, advanceEntries: 0, onTimeEntries: 0 };
      }

      // Repair any stale EMI state first. This is essential for older loans
      // corrected before statement reconciliation existed; otherwise the
      // penalty phase can still see a covered installment as Missed.
      await collectionRepository.rebuildAllActiveEmiStates(client);

      // Repair duplicates produced by older sweep code, but only when the row
      // being removed is a zero-value system row and a real/manual entry exists
      // for the same loan and business date. Never delete a money entry here.
      const duplicateAutomaticEntries = await client.query(
        `DELETE FROM collections generated
          USING collections actual
          WHERE generated.id <> actual.id
            AND generated.loan_id = actual.loan_id
            AND generated.amount = 0
            AND generated.created_by IS NULL
            AND generated.note IN (
              'Auto-marked: no collection recorded for this day',
              'Auto-marked: installment covered by advance payment',
              'Auto-marked: advance coverage completed on time'
            )
            AND actual.collected_at >= generated.collected_at::date
            AND actual.collected_at < generated.collected_at::date + interval '1 day'
            AND NOT (
              actual.amount = 0
              AND actual.created_by IS NULL
              AND actual.note IN (
                'Auto-marked: no collection recorded for this day',
                'Auto-marked: installment covered by advance payment',
                'Auto-marked: advance coverage completed on time'
              )
            )`,
      );
      logger.debug({ rows: duplicateAutomaticEntries.rowCount }, 'Sweep: duplicate automatic entries removed');

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
            AND NOT EXISTS (SELECT 1 FROM collections c WHERE c.emi_id = e.id)
            AND NOT EXISTS (
              SELECT 1 FROM collections same_day
               WHERE same_day.loan_id = e.loan_id
                 AND same_day.collected_at >= e.due_date::timestamp
                 AND same_day.collected_at < e.due_date::timestamp + interval '1 day'
            )`,
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

      // One aggregated pass reconciles every past statement day. It converts
      // old Missed rows, updates stale Advance/On-time classifications, and
      // materializes missing covered days without an N-per-EMI total query.
      const { advanceEntries, onTimeEntries } =
        await collectionRepository.reconcileStatementCoverage(null, client);
      logger.debug(
        { advanceEntries, onTimeEntries },
        'Sweep: advance-covered statement entries inserted',
      );

      // Idempotent penalty recalculation: compute what each EMI's missed_penalty
      // SHOULD be based on the current streak state (first 3 consecutive
      // misses free, 4th+ penalized), compare with the current value, update
      // diffs, and adjust loans.total_payable by the net delta per loan.
      const penalized = await client.query(
        `WITH pen AS (
           SELECT COALESCE((value->>'per_day_pct')::numeric, 0) AS pct FROM settings WHERE key = 'penalty'
         ),
         ordered AS MATERIALIZED (
           SELECT e.id, e.loan_id, e.status, e.missed_penalty,
                  lag(e.status, 1) OVER w AS previous_1,
                  lag(e.status, 2) OVER w AS previous_2,
                  lag(e.status, 3) OVER w AS previous_3
             FROM emi_schedule e
             JOIN loans active_loan ON active_loan.id = e.loan_id AND active_loan.status = 'active'
           WINDOW w AS (PARTITION BY e.loan_id ORDER BY e.installment_no)
         ),
         target AS (
           SELECT e.id, e.loan_id, e.missed_penalty AS old_penalty,
                  CASE
                    WHEN e.status = 'missed' AND pen.pct > 0
                         AND e.previous_1 = 'missed'
                         AND e.previous_2 = 'missed'
                         AND e.previous_3 = 'missed'
                      THEN round(l.principal * pen.pct / 100, 2)
                    ELSE 0
                  END AS new_penalty
             FROM ordered e
             JOIN loans l ON l.id = e.loan_id
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
        advanceEntries,
        onTimeEntries,
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
      if (
        result.missedMarked > 0 ||
        result.penalized > 0 ||
        result.advancesMatured > 0 ||
        result.advanceEntries > 0 ||
        result.onTimeEntries > 0
      ) {
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
