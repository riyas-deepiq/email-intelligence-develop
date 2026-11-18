import { inArray, eq, and, or, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { authProviders, ingestionJobs, mailboxes, organizations } from '../db/schema';
import { JobType } from '../lib/job-type';
import { logger } from '../lib/logger';

/**
 * Server-side service for managing collector work.
 * The collector is a stateless poll-worker: it claims ingestion_jobs from the
 * server DB. Probe and sync jobs are enqueued directly in the DB here — the
 * collector's HTTP /probe and /sync endpoints are stubs kept only for
 * backwards-compatibility with tests.
 */
export class CollectorService {
  /**
   * Enqueue probe jobs for the given mailbox IDs (or all mailboxes when omitted).
   * Called after a provider is connected so the UI can immediately show
   * estimated message counts and the earliest email date.
   */
  async triggerProbe(mailboxIds?: string[]): Promise<number> {
    try {
      const db = getDb();
      const mbs = mailboxIds?.length
        ? await db
            .select({ id: mailboxes.id, orgId: mailboxes.orgId })
            .from(mailboxes)
            .where(inArray(mailboxes.id, mailboxIds))
        : await db.select({ id: mailboxes.id, orgId: mailboxes.orgId }).from(mailboxes);

      let queued = 0;
      for (const mb of mbs) {
        try {
          await db.insert(ingestionJobs).values({
            orgId: mb.orgId,
            mailboxId: mb.id,
            jobType: JobType.MailboxScan,
            status: 'pending',
            priority: 1,
          });
          await db
            .update(mailboxes)
            .set({ probeStatus: 'pending', updatedAt: new Date() })
            .where(eq(mailboxes.id, mb.id));
          queued++;
        } catch {
          // Probe job already active — fine
        }
      }

      logger.info({ queued }, 'probe jobs enqueued');
      return queued;
    } catch (err) {
      logger.warn({ err }, 'Failed to enqueue probe jobs');
      return 0;
    }
  }

  /** No-op — sync jobs are created by POST /sync/start. */
  async triggerSync(_mailboxIds?: string[]): Promise<void> {
    /* no-op */
  }

  /**
   * Cancel any not-yet-finished probe jobs: pending ones never get claimed;
   * already claimed/running ones are marked dead so a late report from the
   * collector can't resurrect them (see the guard in PATCH /jobs/:id).
   * Returns the number of jobs cancelled.
   */
  async cancelProbe(): Promise<number> {
    const db = getDb();
    const now = new Date();

    const cancelled = await db
      .update(ingestionJobs)
      .set({ status: 'dead', error: 'Cancelled by user', finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(ingestionJobs.jobType, JobType.MailboxScan),
          inArray(ingestionJobs.status, ['pending', 'claimed', 'running']),
        ),
      )
      .returning({ mailboxId: ingestionJobs.mailboxId });

    // 'not_started', not 'error' — this was a deliberate user cancel, not a
    // failure, so it shouldn't read as something having gone wrong.
    //
    // A re-probe of an already-probed mailbox overwrites probeStatus to
    // 'pending' immediately on trigger (see above), even though the mailbox's
    // prior results (emailCountEstimate/earliestEmailAt) are still sitting
    // there untouched. So on cancel: if that data is still present, restore
    // 'complete' instead of wiping it to 'not_started' — a cancelled re-probe
    // must not make an already-probed mailbox look like it's never been
    // probed at all.
    const mailboxIds = [...new Set(cancelled.map((j) => j.mailboxId))];
    if (mailboxIds.length > 0) {
      const hasPriorData = or(
        isNotNull(mailboxes.emailCountEstimate),
        isNotNull(mailboxes.earliestEmailAt),
      );

      await db
        .update(mailboxes)
        .set({ probeStatus: 'complete', updatedAt: now })
        .where(and(inArray(mailboxes.id, mailboxIds), hasPriorData));

      await db
        .update(mailboxes)
        .set({ probeStatus: 'not_started', updatedAt: now })
        .where(
          and(
            inArray(mailboxes.id, mailboxIds),
            isNull(mailboxes.emailCountEstimate),
            isNull(mailboxes.earliestEmailAt),
          ),
        );
    }

    logger.info({ cancelled: cancelled.length }, 'probe jobs cancelled');
    return cancelled.length;
  }

  /**
   * Best-effort: queue a first-ever backfill (+ probe) for a mailbox the
   * moment its owner logs in, so a brand-new user doesn't have to wait for an
   * admin to click "Start sync". A no-op once the mailbox has synced at least
   * once (syncStatus !== 'not_started') — every later sync stays on the
   * normal schedule / manual trigger, this only covers the very first run.
   */
  async triggerInitialSyncIfNeeded(mailboxId: string): Promise<boolean> {
    try {
      const db = getDb();
      const [mb] = await db
        .select({
          id: mailboxes.id,
          orgId: mailboxes.orgId,
          provider: mailboxes.provider,
          syncStatus: mailboxes.syncStatus,
          syncEnabled: mailboxes.syncEnabled,
          syncPriority: mailboxes.syncPriority,
          probeStatus: mailboxes.probeStatus,
          syncFromDate: mailboxes.syncFromDate,
        })
        .from(mailboxes)
        .where(eq(mailboxes.id, mailboxId));

      if (!mb || !mb.syncEnabled || mb.syncStatus !== 'not_started') return false;

      const [provider] = await db
        .select()
        .from(authProviders)
        .where(eq(authProviders.provider, mb.provider as 'm365' | 'google'));
      const hasCreds =
        !!provider &&
        ((provider.provider === 'm365' &&
          !!(provider.tenantId && provider.clientId && provider.clientSecret)) ||
          (provider.provider === 'google' && !!provider.serviceAccountJson));
      if (!hasCreds) return false;

      if (mb.syncFromDate == null) {
        const [org] = await db
          .select({ globalSyncFromDate: organizations.globalSyncFromDate })
          .from(organizations)
          .where(eq(organizations.id, mb.orgId));
        if (org?.globalSyncFromDate) {
          await db
            .update(mailboxes)
            .set({ syncFromDate: new Date(org.globalSyncFromDate), updatedAt: new Date() })
            .where(eq(mailboxes.id, mailboxId));
        }
      }

      await db
        .update(mailboxes)
        .set({ syncStatus: 'syncing', updatedAt: new Date() })
        .where(eq(mailboxes.id, mailboxId));

      await db.insert(ingestionJobs).values({
        orgId: mb.orgId,
        mailboxId,
        jobType: JobType.InitialImport,
        status: 'pending',
        priority: mb.syncPriority ?? 0,
      });

      if (mb.probeStatus !== 'complete') {
        await db.insert(ingestionJobs).values({
          orgId: mb.orgId,
          mailboxId,
          jobType: JobType.MailboxScan,
          status: 'pending',
          priority: (mb.syncPriority ?? 0) + 1,
        });
        await db
          .update(mailboxes)
          .set({ probeStatus: 'pending', updatedAt: new Date() })
          .where(eq(mailboxes.id, mailboxId));
      }

      logger.info({ mailboxId }, 'auto-triggered first sync on login');
      return true;
    } catch (err) {
      logger.warn({ err, mailboxId }, 'failed to auto-trigger initial sync on login');
      return false;
    }
  }

  /** Kept for backwards compatibility. */
  async getStatus(): Promise<unknown> {
    return null;
  }
}

export const collectorService = new CollectorService();
