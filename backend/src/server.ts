import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { pool } from './db/pool';
import { startMissedEmiJob } from './modules/collections/missed-emi.job';
import { collectionRepository } from './modules/collections/collection.repository';

async function bootstrap() {
  // Verify DB connectivity before accepting traffic — fail fast.
  await pool.query('SELECT 1');
  logger.info('Database connection OK');

  // The sweep starts immediately, so its small supporting table must exist
  // before the first run even when a deployment omitted `npm run migrate`.
  await collectionRepository.ensureStatementInfrastructure();

  startMissedEmiJob();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 JSSF API listening on http://localhost:${env.PORT}${env.API_PREFIX}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Prevent stray promise rejections or uncaught exceptions from silently killing the process.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
});

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
