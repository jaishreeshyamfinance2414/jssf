import { logger } from '../config/logger';
import { pool } from '../db/pool';
import { sweepMissedEmis } from '../modules/collections/missed-emi.job';

/** One-shot manual run: `npm run sweep`. Same logic the hourly job uses. */
async function run() {
  const result = await sweepMissedEmis();
  logger.info(result, 'Missed-EMI sweep finished');
  await pool.end();
}

run().catch((err) => {
  logger.error({ err }, 'Sweep failed');
  process.exit(1);
});
