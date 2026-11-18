import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { isTransientDbConnectionError, withDbRetry } from '../db/retry';
import { authProviders, ingestionJobs, mailboxes } from '../db/schema';
import { JobType } from './job-type';
import { logger } from './logger';

const SWEEP_INTERVAL_MS = 60_000; // run every minute
const STALE_THRESHOLD_MS = 5 * 60_000; // claimed > 5 min ago → stale

// A running job's collector re-PATCHes {status:'running'} every ~2 min as a
// heartbeat (bumping updated_at). 10 min of silence = ~5 missed heartbeats =
// the collector process is gone, however long the job itself was going to take.
const RUNNING_STALE_THRESHOLD_MS = 10 * 60_000;

let timer: ReturnType<typeof setInterval> | undefined;

/** Reset claimed jobs that the collector stopped heartbeating on back to pending. */
async function resetStaleClaimedJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const updated = await withDbRetry(
    () =>
      getDb()
        .update(ingestionJobs)
        .set({ status: 'pending', claimedBy: null, claimedAt: null, updatedAt: sql`now()` })
        .where(and(eq(ingestionJobs.status, 'claimed'), lt(ingestionJobs.claimedAt, cutoff)))
        .returning({ id: ingestionJobs.id }),
    { operationName: 'reset stale claimed jobs' },
  );

  if (updated.length > 0) {
    logger.warn({ count: updated.length }, 'Stale claimed jobs reset to pending');
  }
}

/**
 * Requeue running jobs whose collector stopped heartbeating (crashed or was
 * killed mid-job). Without this, a job whose worker died stays 'running'
 * forever and its mailbox is stuck showing "syncing". Uses the same retry
 * accounting as a reported failure: requeue while retries remain, dead after.
 */
async function resetStaleRunningJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - RUNNING_STALE_THRESHOLD_MS);
  const db = getDb();

  const stale = await withDbRetry(
    () =>
      db
        .select()
        .from(ingestionJobs)
        .where(and(eq(ingestionJobs.status, 'running'), lt(ingestionJobs.updatedAt, cutoff))),
    { operationName: 'load stale running jobs' },
  );

  for (const job of stale) {
    const now = new Date();
    const newRetryCount = (job.retryCount ?? 0) + 1;
    const isDead = newRetryCount >= (job.maxRetries ?? 3);

    await withDbRetry(
      () =>
        db
          .update(ingestionJobs)
          .set(
            isDead
              ? {
                  status: 'dead',
                  finishedAt: now,
                  retryCount: newRetryCount,
                  error: 'Collector heartbeat lost — worker crashed or was killed mid-job',
                  updatedAt: now,
                }
              : {
                  status: 'pending',
                  claimedBy: null,
                  claimedAt: null,
                  startedAt: null,
                  retryCount: newRetryCount,
                  updatedAt: now,
                },
          )
          .where(
            and(
              eq(ingestionJobs.id, job.id),
              // Guard against a heartbeat that landed between our SELECT and now.
              eq(ingestionJobs.status, 'running'),
              lt(ingestionJobs.updatedAt, cutoff),
            ),
          ),
      { operationName: 'reset stale running job' },
    );

    // Mirror the failure-report path: surface the error on the mailbox so the
    // UI doesn't show "syncing" forever. A sync-range extension is a background
    // gap-fill and never touches mailbox status.
    if (isDead && job.jobType !== JobType.SyncRangeExtension) {
      await withDbRetry(
        () =>
          db
            .update(mailboxes)
            .set(
              job.jobType === JobType.MailboxScan
                ? { probeStatus: 'error', updatedAt: now }
                : { syncStatus: 'error', updatedAt: now },
            )
            .where(eq(mailboxes.id, job.mailboxId)),
        { operationName: 'mark mailbox errored after dead running job' },
      );
    }
  }

  if (stale.length > 0) {
    logger.warn({ count: stale.length }, 'Stale running jobs (heartbeat lost) swept');
  }
}

/**
 * Kill pending/failed jobs whose mailbox's auth provider is disabled.
 * Prevents the collector from claiming jobs it will immediately fail on.
 */
async function killJobsForDisabledProviders(): Promise<void> {
  const db = getDb();

  // Providers without stored credentials cannot be synced — `enabled` controls
  // SSO login only, not mail-sync access.
  const allProviders = await withDbRetry(() => db.select().from(authProviders), {
    operationName: 'load auth providers for stale sweep',
  });
  const credentialedSet = new Set(
    allProviders
      .filter(
        (p) =>
          (p.provider === 'm365' && !!(p.tenantId && p.clientId && p.clientSecret)) ||
          (p.provider === 'google' && !!p.serviceAccountJson),
      )
      .map((p) => p.provider),
  );

  const allMailboxProviders = await withDbRetry(
    () => db.selectDistinct({ provider: mailboxes.provider }).from(mailboxes),
    { operationName: 'load mailbox providers for stale sweep' },
  );
  const disabledProviders = allMailboxProviders
    .map((r) => r.provider)
    .filter((p) => !credentialedSet.has(p as 'm365' | 'google' | 'email_password'));

  if (disabledProviders.length === 0) return;

  // Find mailbox IDs for those providers.
  const affectedMailboxes = await withDbRetry(
    () =>
      db
        .select({ id: mailboxes.id })
        .from(mailboxes)
        .where(inArray(mailboxes.provider, disabledProviders)),
    { operationName: 'load disabled-provider mailboxes for stale sweep' },
  );

  if (affectedMailboxes.length === 0) return;

  const mailboxIds = affectedMailboxes.map((m) => m.id);

  // Mark any queued/failed jobs for those mailboxes dead so they are never claimed.
  const killed = await withDbRetry(
    () =>
      db
        .update(ingestionJobs)
        .set({
          status: 'dead',
          error: 'Auth provider not enabled — job killed by sweeper',
          finishedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            inArray(ingestionJobs.status, ['pending', 'failed']),
            inArray(ingestionJobs.mailboxId, mailboxIds),
          ),
        )
        .returning({ id: ingestionJobs.id }),
    { operationName: 'kill jobs for disabled providers' },
  );

  if (killed.length > 0) {
    logger.warn(
      { count: killed.length, providers: disabledProviders },
      'Killed jobs for disabled providers',
    );
  }
}

async function sweep(): Promise<void> {
  try {
    await resetStaleClaimedJobs();
    await resetStaleRunningJobs();
    await killJobsForDisabledProviders();
  } catch (err) {
    if (isTransientDbConnectionError(err)) {
      logger.warn({ err }, 'Stale job sweep skipped because database connection is unavailable');
      return;
    }
    logger.error({ err }, 'Stale job sweep failed');
  }
}

export function startStaleSweeper(): void {
  void sweep(); // run immediately on startup to clear any existing bad jobs
  timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  logger.info('Stale job sweeper started');
}

export function stopStaleSweeper(): void {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}
