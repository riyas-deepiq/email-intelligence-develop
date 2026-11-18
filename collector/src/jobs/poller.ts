import { env } from '../config/env';
import { logger } from '../observability/logger';
import {
  claimJobs as defaultClaimJobs,
  getSyncSchedule as defaultGetSyncSchedule,
  type ClaimedJob,
} from '../clients/core-server.client';
import { nextPollDelayMs } from '../scheduling/schedule';
import { processJob as defaultProcessJob } from './processor';
import type { HealthState } from '../app';

/** Injectable for tests — production uses the real implementations. */
export interface PollerDeps {
  claimJobs: (limit: number, instanceId: string) => Promise<ClaimedJob[]>;
  getSyncSchedule: typeof defaultGetSyncSchedule;
  processJob: (job: ClaimedJob) => Promise<boolean>;
}

export interface PollerOptions {
  pollIntervalMs?: number;
  workerConcurrency?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The collector's poll loop as a plain while-loop.
 *
 * Survivability is the design goal: the loop must outlive ANY failure —
 * server down at startup, server down mid-run, schedule fetch broken,
 * unexpected bugs in a poll iteration. Every await inside an iteration is
 * fenced; the outer loop's only exit is stop(). A collector that cannot
 * reach the server is a healthy collector that reports "degraded" and keeps
 * knocking — never a dead process.
 */
export class Poller {
  private stopped = false;

  constructor(
    private readonly instanceId: string,
    private readonly health: HealthState,
    private readonly deps: PollerDeps = {
      claimJobs: defaultClaimJobs,
      getSyncSchedule: defaultGetSyncSchedule,
      processJob: defaultProcessJob,
    },
    private readonly opts: Required<PollerOptions> = {
      pollIntervalMs: env.POLL_INTERVAL_MS,
      workerConcurrency: env.WORKER_CONCURRENCY,
    },
  ) {}

  /** Starts the loop. Returns a promise that resolves only after stop(). */
  start(): Promise<void> {
    return this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let delayMs = this.opts.pollIntervalMs;
      try {
        delayMs = await this.pollOnce();
      } catch (err) {
        // Absolute backstop. pollOnce fences its own awaits, so reaching this
        // means a bug — log it loudly, but a bug in one iteration must never
        // kill the loop.
        logger.error({ err }, 'unexpected error in poll iteration — loop continues');
      }
      if (this.stopped) return;
      await sleep(delayMs);
    }
  }

  /** One poll iteration. Returns the delay until the next one. */
  private async pollOnce(): Promise<number> {
    const available = this.opts.workerConcurrency - this.health.activeWorkers;
    if (available <= 0) {
      // Workers are busy, not idle — recheck soon rather than waiting out a
      // possibly much longer business-hours/off-hours interval.
      logger.debug(
        { activeWorkers: this.health.activeWorkers },
        'worker pool full — skipping poll',
      );
      return this.opts.pollIntervalMs;
    }

    this.health.lastPollAt = new Date().toISOString();

    let jobs: ClaimedJob[];
    try {
      jobs = await this.deps.claimJobs(available, this.instanceId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const firstFailure = this.health.lastPollOk !== false;
      this.health.lastPollOk = false;
      this.health.lastPollError = message;

      // First failure gets a clear, actionable WARN; repeats stay at debug so
      // an overnight server outage doesn't fill the log with identical noise.
      if (firstFailure) {
        logger.warn(
          { err, retryInMs: this.opts.pollIntervalMs },
          'cannot reach server — collector stays up and keeps retrying (health: degraded)',
        );
      } else {
        logger.debug({ err }, 'server still unreachable — retrying');
      }
      return this.opts.pollIntervalMs;
    }

    if (this.health.lastPollOk === false) {
      logger.info('server reachable again — resuming normal polling');
    }
    this.health.lastPollOk = true;
    this.health.lastPollError = null;
    logger.debug({ claimed: jobs.length, instance: this.instanceId }, 'poll complete');

    // Dispatch each job as a concurrent async task — do not await here.
    for (const job of jobs) {
      this.dispatch(job);
    }

    // Business-hours-aware cadence for the next poll; static fallback when the
    // schedule can't be fetched.
    try {
      const cfg = await this.deps.getSyncSchedule();
      return nextPollDelayMs(cfg, this.opts.pollIntervalMs);
    } catch (err) {
      logger.debug({ err }, 'failed to fetch sync schedule — using default poll interval');
      return this.opts.pollIntervalMs;
    }
  }

  private dispatch(job: ClaimedJob): void {
    this.health.activeWorkers++;
    this.deps
      .processJob(job)
      .then((ok) => {
        if (ok) {
          this.health.jobsSucceeded++;
        } else {
          this.health.jobsFailed++;
        }
      })
      .catch((err) => {
        // processJob never throws by contract; this is the belt to that suspenders.
        this.health.jobsFailed++;
        logger.error({ err, jobId: job.jobId }, 'job processing crashed');
      })
      .finally(() => {
        this.health.activeWorkers--;
      });
  }
}
