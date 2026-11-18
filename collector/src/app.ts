import express, { type Express } from 'express';

/**
 * Live snapshot of the collector's working state, surfaced on /health.
 * The poll loop in server.ts owns and mutates a single instance of this.
 */
export interface HealthState {
  instance: string;
  activeWorkers: number;
  lastPollAt: string | null;
  lastPollOk: boolean | null; // null = no poll has completed yet
  lastPollError: string | null;
  jobsSucceeded: number;
  jobsFailed: number;
}

/**
 * Builds the collector's HTTP surface: a single GET /health endpoint.
 *
 * This is deliberately the ONLY inbound route — the collector pulls work from
 * the server (outbound-only), so nothing else may be exposed here.
 *
 * /health always answers 200, even when the last poll failed ("degraded"):
 * a server outage is not a collector fault, and a 5xx here would make an
 * orchestrator restart-loop a perfectly healthy process. Monitors that care
 * should alert on `status: "degraded"` in the body instead.
 */
export function createApp(getHealth: () => HealthState): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    const health = getHealth();
    res.status(200).json({
      status: health.lastPollOk === false ? 'degraded' : 'ok',
      uptime: process.uptime(),
      ...health,
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  });

  return app;
}
