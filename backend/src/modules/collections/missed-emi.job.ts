import { logger } from '../../config/logger';
import { withTransaction } from '../../db/pool';
import { collectionRepository } from './collection.repository';
import { reconcileHistory, reconcileHistoricalPenalties } from './statement-history';

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

      // Rebuild current financial allocation separately from dated statement
      // history. Settlement of arrears must not rewrite earlier missed days.
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

      const { advanceEntries, onTimeEntries, missedEntries } =
        await reconcileHistory(null, client);
      const penalized = await reconcileHistoricalPenalties(null, client);

      const matured = await client.query(
        `UPDATE emi_schedule SET status = 'paid'
          WHERE status = 'advance' AND due_date <= CURRENT_DATE`,
      );

      return {
        missedMarked: missedEntries,
        penalized,
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
