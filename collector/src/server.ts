import { hostname } from 'os';
import { env } from './config/env';
import { logger } from './observability/logger';
import { createApp, type HealthState } from './app';
import { Poller } from './jobs/poller';

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection — collector continues');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught exception — collector continues');
});

const INSTANCE_ID = env.COLLECTOR_INSTANCE_ID ?? `${hostname()}:${env.PORT}`;

const health: HealthState = {
  instance: INSTANCE_ID,
  activeWorkers: 0,
  lastPollAt: null,
  lastPollOk: null,
  lastPollError: null,
  jobsSucceeded: 0,
  jobsFailed: 0,
};

const app = createApp(() => ({ ...health }));
const poller = new Poller(INSTANCE_ID, health);

const server = app.listen(env.PORT, () => {
  logger.info(`Collector health endpoint on http://localhost:${env.PORT}/health (${env.NODE_ENV})`);
  logger.info(
    { instance: INSTANCE_ID, pollIntervalMs: env.POLL_INTERVAL_MS },
    'starting poll loop',
  );
  void poller.start();
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received - shutting down`);
  poller.stop();

  const deadline = Date.now() + 60_000;
  while (health.activeWorkers > 0 && Date.now() < deadline) {
    logger.info({ activeWorkers: health.activeWorkers }, 'waiting for in-flight workers to finish');
    await new Promise((r) => setTimeout(r, 2_000));
  }

  await new Promise<void>((resolve) =>
    server.close(() => {
      logger.info('collector shutdown complete');
      resolve();
    }),
  );
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
