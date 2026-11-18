import { createApp } from './app';
import { config } from './config/env';
import { checkDbConnection, closeDb } from './db/client';
import { logger } from './lib/logger';
import { startStaleSweeper, stopStaleSweeper } from './lib/stale-job-sweeper';

/**
 * Boots the HTTP service. Exported so the CLI's `serve` command can start it after
 * it has resolved the config location; resolves once the server is listening.
 */
export async function start(): Promise<void> {
  // Verify DB connectivity before accepting any traffic.
  // If this throws the process exits here — no half-started server.
  try {
    await checkDbConnection();
    logger.info('Database connection established');
  } catch (err) {
    logger.error(
      { err },
      'Cannot connect to the database. Check DATABASE_URL and that PostgreSQL is running.',
    );
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Server listening on http://localhost:${config.port} (${config.env})`);
  });

  startStaleSweeper();

  /** Graceful shutdown — finish in-flight requests, then close DB pool. */
  function shutdown(signal: string): void {
    logger.info(`${signal} received — shutting down gracefully`);
    stopStaleSweeper();
    server.close(async () => {
      await closeDb();
      logger.info('Server and database connections closed');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Still directly runnable (`node dist/server.js`, `npm start`) — but importing this
// module, as the CLI does, must not start a second listener.
if (require.main === module) {
  void start();
}
