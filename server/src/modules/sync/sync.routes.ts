import { Router } from 'express';
import { send } from '../../lib/respond';
import { asyncHandler } from '../../lib/async-handler';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';

function parseSyncConfigBody(body: unknown): {
  org?: { syncEnabled?: boolean; globalSyncFromDate?: string | null };
  mailboxes?: Array<{
    id: string;
    syncEnabled?: boolean;
    syncFromDate?: string | null;
    syncPriority?: number;
  }>;
} {
  const b = (body ?? {}) as Record<string, unknown>;

  let org: { syncEnabled?: boolean; globalSyncFromDate?: string | null } | undefined;
  if (b['org'] !== undefined) {
    const o = (b['org'] ?? {}) as Record<string, unknown>;
    org = {};
    if ('syncEnabled' in o) {
      if (typeof o['syncEnabled'] !== 'boolean')
        throw new ValidationError('org.syncEnabled must be a boolean');
      org.syncEnabled = o['syncEnabled'];
    }
    if ('globalSyncFromDate' in o) {
      const d = o['globalSyncFromDate'];
      if (d !== null && d !== undefined) {
        if (typeof d !== 'string' || isNaN(Date.parse(d)))
          throw new ValidationError('org.globalSyncFromDate must be an ISO date string or null');
        org.globalSyncFromDate = d;
      } else {
        org.globalSyncFromDate = null;
      }
    }
  }

  let mailboxes:
    | Array<{
        id: string;
        syncEnabled?: boolean;
        syncFromDate?: string | null;
        syncPriority?: number;
      }>
    | undefined;
  if (b['mailboxes'] !== undefined) {
    if (!Array.isArray(b['mailboxes'])) throw new ValidationError('mailboxes must be an array');
    mailboxes = (b['mailboxes'] as unknown[]).map((item, i) => {
      const m = (item ?? {}) as Record<string, unknown>;
      if (typeof m['id'] !== 'string') throw new ValidationError(`mailboxes[${i}].id is required`);
      const entry: {
        id: string;
        syncEnabled?: boolean;
        syncFromDate?: string | null;
        syncPriority?: number;
      } = { id: m['id'] };
      if ('syncEnabled' in m) {
        if (typeof m['syncEnabled'] !== 'boolean')
          throw new ValidationError(`mailboxes[${i}].syncEnabled must be a boolean`);
        entry.syncEnabled = m['syncEnabled'];
      }
      if ('syncPriority' in m) {
        if (typeof m['syncPriority'] !== 'number' || !Number.isInteger(m['syncPriority']))
          throw new ValidationError(`mailboxes[${i}].syncPriority must be an integer`);
        entry.syncPriority = m['syncPriority'] as number;
      }
      if ('syncFromDate' in m) {
        const d = m['syncFromDate'];
        if (d !== null && d !== undefined) {
          if (typeof d !== 'string' || isNaN(Date.parse(d)))
            throw new ValidationError(
              `mailboxes[${i}].syncFromDate must be an ISO date string or null`,
            );
          entry.syncFromDate = d;
        } else {
          entry.syncFromDate = null;
        }
      }
      return entry;
    });
  }

  return { org, mailboxes };
}
import { eq, and, inArray, or, isNotNull, isNull, gt } from 'drizzle-orm';
import { getDb } from '../../db/client';
import {
  authProviders,
  ingestionJobs,
  mailboxes as mailboxesTable,
  orgSyncConfig,
} from '../../db/schema';
import { createMailboxRepository } from '../mailboxes/mailbox.repository';
import { createOrgRepository } from '../organizations/org.repository';
import { actorFromRequest, AuditService } from '../audit/audit.service';
import { createAuditRepository } from '../audit/audit.repository';
import { createAlertRepository } from '../alerts/alert.repository';
import { AlertService } from '../alerts/alert.service';
import { JobType } from '../../lib/job-type';
import { logger } from '../../lib/logger';

const alertsSvc = new AlertService(createAlertRepository());
const orgRepo = createOrgRepository();
const mailboxRepo = createMailboxRepository();
const auditSvc = new AuditService(createAuditRepository());

export const syncRouter = Router();

syncRouter.use(requireAuth, requirePermission('mailboxes.manage'));

/**
 * GET /sync/config
 * Returns org-level sync configuration + per-mailbox sync config.
 */
syncRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const [org, mailboxes] = await Promise.all([orgRepo.findFirst(), mailboxRepo.findAll()]);

    if (!org) throw new NotFoundError('No organization configured yet');

    send(res, {
      org: {
        syncEnabled: org.syncEnabled,
        globalSyncFromDate: org.globalSyncFromDate,
      },
      mailboxes: mailboxes.map((m) => ({
        id: m.id,
        address: m.address,
        displayName: m.displayName,
        provider: m.provider,
        syncEnabled: m.syncEnabled,
        syncFromDate: m.syncFromDate,
        syncPriority: m.syncPriority,
        probeStatus: m.probeStatus,
        earliestEmailAt: m.earliestEmailAt,
        emailCountEstimate: m.emailCountEstimate,
      })),
    });
  }),
);

/**
 * PUT /sync/config
 * Update org-level sync settings and/or per-mailbox sync settings in one call.
 *
 * Body:
 * {
 *   org?: { syncEnabled?: boolean; globalSyncFromDate?: string | null };
 *   mailboxes?: Array<{
 *     id: string;
 *     syncEnabled?: boolean;
 *     syncFromDate?: string | null;
 *     syncPriority?: number;
 *   }>;
 * }
 */
/**
 * GET /sync/status
 * Returns the current sync state across all mailboxes.
 */
syncRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const [org, mailboxes] = await Promise.all([orgRepo.findFirst(), mailboxRepo.findAll()]);

    if (!org) throw new NotFoundError('No organization configured yet');

    const counts = { not_started: 0, syncing: 0, complete: 0, error: 0 };
    for (const m of mailboxes) {
      const key = m.syncStatus as keyof typeof counts;
      if (key in counts) counts[key]++;
    }

    send(res, {
      syncEnabled: org.syncEnabled,
      overall:
        counts.syncing > 0
          ? 'syncing'
          : counts.error > 0 && counts.syncing === 0 && counts.not_started === 0
            ? 'error'
            : counts.complete === mailboxes.length && mailboxes.length > 0
              ? 'complete'
              : 'not_started',
      counts,
      mailboxes: mailboxes.map((m) => ({
        id: m.id,
        address: m.address,
        provider: m.provider,
        syncEnabled: m.syncEnabled,
        syncStatus: m.syncStatus,
        totalMessages: m.totalMessages,
        syncedMessages: m.syncedMessages,
        lastSyncAt: m.lastSyncAt,
      })),
    });
  }),
);

/**
 * POST /sync/start
 * Enable sync globally and create ingestion_jobs for all sync-enabled mailboxes.
 * The collector claims these jobs on its next poll (every 30 s).
 */
syncRouter.post(
  '/start',
  asyncHandler(async (req, res) => {
    const org = await orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');

    const { mailboxIds } = req.body as { mailboxIds?: unknown };
    const ids = Array.isArray(mailboxIds)
      ? (mailboxIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined;

    try {
      const db = getDb();

      // Explicitly selecting mailboxes and starting sync is itself the "enable"
      // action for those mailboxes — the syncEnabled gate only applies to the
      // unscoped "start all" case, where it reflects each mailbox's saved config.
      if (ids?.length) {
        await db
          .update(mailboxesTable)
          .set({ syncEnabled: true, updatedAt: new Date() })
          .where(and(eq(mailboxesTable.orgId, org.id), inArray(mailboxesTable.id, ids)));
      }

      // Find all sync-enabled mailboxes (include provider so we can gate on auth config)
      const syncableMailboxes = await db
        .select({
          id: mailboxesTable.id,
          orgId: mailboxesTable.orgId,
          provider: mailboxesTable.provider,
          syncPriority: mailboxesTable.syncPriority,
          syncToken: mailboxesTable.syncToken,
          probeStatus: mailboxesTable.probeStatus,
          syncFromDate: mailboxesTable.syncFromDate,
          backfilledFromAt: mailboxesTable.backfilledFromAt,
        })
        .from(mailboxesTable)
        .where(
          and(
            eq(mailboxesTable.orgId, org.id),
            eq(mailboxesTable.syncEnabled, true),
            ...(ids?.length ? [inArray(mailboxesTable.id, ids)] : []),
          ),
        );

      if (syncableMailboxes.length === 0) {
        throw new ValidationError(
          ids?.length
            ? 'Selected mailbox(es) could not be enabled for sync.'
            : 'No sync-enabled mailboxes. Enable at least one mailbox for sync before starting.',
        );
      }

      // Collect providers that have credentials stored so we don't queue jobs that
      // will immediately fail. `enabled` controls SSO login, not mail-sync access.
      const allProviders = await db.select().from(authProviders);
      const credentialedProviderSet = new Set(
        allProviders
          .filter(
            (p) =>
              (p.provider === 'm365' && !!(p.tenantId && p.clientId && p.clientSecret)) ||
              (p.provider === 'google' && !!p.serviceAccountJson),
          )
          .map((p) => p.provider),
      );

      await orgRepo.updateSyncConfig(org.id, { syncEnabled: true });

      // Create one ingestion_job per mailbox (skip if an active job already exists)
      let created = 0;
      let backfillExtendsCreated = 0;
      let probesCreated = 0;
      let skippedNoProvider = 0;
      for (const mb of syncableMailboxes) {
        if (!credentialedProviderSet.has(mb.provider as 'm365' | 'google' | 'email_password')) {
          logger.warn(
            { mailboxId: mb.id, provider: mb.provider },
            'skipping job — auth provider not enabled',
          );
          skippedNoProvider++;
          continue;
        }

        // Reset syncStatus to 'syncing' immediately so the UI reflects progress
        await db
          .update(mailboxesTable)
          .set({ syncStatus: 'syncing', updatedAt: new Date() })
          .where(eq(mailboxesTable.id, mb.id));

        // Target depth: this mailbox's own setting, falling back to the org
        // default. If this mailbox never had its own value, materialize the org
        // default onto it now — one-time fill-in, never overwrites an explicit
        // per-mailbox choice made later via the mailbox drawer.
        const orgDefaultSyncFromDate = org.globalSyncFromDate
          ? new Date(org.globalSyncFromDate)
          : null;
        const effectiveSyncFromDate = mb.syncFromDate ?? orgDefaultSyncFromDate;
        if (mb.syncFromDate == null && orgDefaultSyncFromDate != null) {
          await db
            .update(mailboxesTable)
            .set({ syncFromDate: orgDefaultSyncFromDate, updatedAt: new Date() })
            .where(eq(mailboxesTable.id, mb.id));
        }

        const jobType = mb.syncToken ? JobType.NewMailCheck : JobType.InitialImport;
        try {
          await db.insert(ingestionJobs).values({
            orgId: mb.orgId,
            mailboxId: mb.id,
            jobType,
            status: 'pending',
            priority: mb.syncPriority ?? 0,
          });
          created++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.debug(
            { mailboxId: mb.id, err: msg },
            'sync ingestion_job already active — skipped',
          );
        }

        // Gap-fill: this mailbox has already synced (has a forward cursor), but
        // its target depth now reaches further back than what's been backfilled.
        // Queue a bounded, one-off job for just the gap — never re-fetches
        // anything already covered, and never touches the incremental cursor.
        if (
          jobType === JobType.NewMailCheck &&
          effectiveSyncFromDate != null &&
          (mb.backfilledFromAt == null || effectiveSyncFromDate < mb.backfilledFromAt)
        ) {
          try {
            await db.insert(ingestionJobs).values({
              orgId: mb.orgId,
              mailboxId: mb.id,
              jobType: JobType.SyncRangeExtension,
              status: 'pending',
              priority: (mb.syncPriority ?? 0) - 1, // behind incremental — new mail always comes first
            });
            backfillExtendsCreated++;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.debug(
              { mailboxId: mb.id, err: msg },
              'backfill_extend job already active — skipped',
            );
          }
        }

        // Enqueue a probe job if we don't have stats for this mailbox yet
        if (mb.probeStatus !== 'complete') {
          try {
            await db.insert(ingestionJobs).values({
              orgId: mb.orgId,
              mailboxId: mb.id,
              jobType: JobType.MailboxScan,
              status: 'pending',
              priority: (mb.syncPriority ?? 0) + 1, // probes run first
            });
            probesCreated++;
            // Reset probeStatus so UI shows it is in-flight
            await db
              .update(mailboxesTable)
              .set({ probeStatus: 'pending', updatedAt: new Date() })
              .where(eq(mailboxesTable.id, mb.id));
          } catch {
            // Probe job already active — fine
          }
        }
      }

      logger.info(
        {
          orgId: org.id,
          created,
          backfillExtendsCreated,
          probesCreated,
          skippedNoProvider,
          total: syncableMailboxes.length,
        },
        'ingestion jobs created',
      );

      if (req.user) {
        const actor = actorFromRequest(req.user, req.ip);
        await auditSvc.syncEvent('sync.started', actor, ids?.join(',') ?? org.id, null, {
          jobsCreated: created,
          backfillExtendsCreated,
          probesCreated,
          skippedNoProvider,
          mailboxCount: syncableMailboxes.length,
          mailboxIds: ids ?? null,
        });
      }

      send(res, {
        message: `Sync started. ${created} job(s) queued for ${syncableMailboxes.length} mailbox(es).${backfillExtendsCreated > 0 ? ` ${backfillExtendsCreated} extending history to a wider range.` : ''}${skippedNoProvider > 0 ? ` ${skippedNoProvider} skipped (provider not enabled).` : ''} Collector will pick them up within 30 s.`,
        jobsCreated: created,
        backfillExtendsCreated,
        probesCreated,
        skippedNoProvider,
      });
    } catch (err: unknown) {
      const message =
        err instanceof ValidationError || err instanceof NotFoundError
          ? err.message
          : 'An unexpected error occurred while starting sync.';
      await alertsSvc.record({
        orgId: org.id,
        severity: 'warning',
        category: 'Sync',
        title: 'Sync failed to start',
        description: message,
        source: req.user?.email ?? 'System',
        mailboxId: ids?.length === 1 ? ids[0]! : null,
      });
      throw err;
    }
  }),
);

/**
 * POST /sync/pause
 * Cancels sync: disables org.syncEnabled (stops future job claims) AND
 * marks every pending/claimed/running sync job dead right now, resetting
 * affected mailboxes off "syncing" — a real cancel, not just "stop taking
 * new work while whatever's in flight keeps going".
 */
syncRouter.post(
  '/pause',
  asyncHandler(async (req, res) => {
    const org = await orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');

    await orgRepo.updateSyncConfig(org.id, { syncEnabled: false });

    const db = getDb();
    const now = new Date();

    const cancelledJobs = await db
      .update(ingestionJobs)
      .set({ status: 'dead', error: 'Cancelled by user', finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(ingestionJobs.orgId, org.id),
          inArray(ingestionJobs.status, ['pending', 'claimed', 'running']),
          inArray(ingestionJobs.jobType, [
            JobType.InitialImport,
            JobType.NewMailCheck,
            JobType.SyncRangeExtension,
          ]),
        ),
      )
      .returning({ mailboxId: ingestionJobs.mailboxId });

    // 'not_started', not 'error' — this was a deliberate user cancel, not a
    // failure, so it shouldn't read as something having gone wrong.
    //
    // Re-starting sync on an already-synced mailbox flips it to 'syncing'
    // immediately on trigger, even though its prior results (syncedMessages /
    // lastSyncAt) are still there untouched. So on cancel: if that data is
    // still present, restore 'complete' instead of wiping it to 'not_started'
    // — a cancelled re-sync must not make an already-synced mailbox look like
    // it's never been synced at all.
    const affectedMailboxIds = [...new Set(cancelledJobs.map((j) => j.mailboxId))];
    if (affectedMailboxIds.length > 0) {
      const hasPriorData = or(
        gt(mailboxesTable.syncedMessages, 0),
        isNotNull(mailboxesTable.lastSyncAt),
      );

      await db
        .update(mailboxesTable)
        .set({ syncStatus: 'complete', updatedAt: now })
        .where(
          and(
            eq(mailboxesTable.orgId, org.id),
            inArray(mailboxesTable.id, affectedMailboxIds),
            hasPriorData,
          ),
        );

      await db
        .update(mailboxesTable)
        .set({ syncStatus: 'not_started', updatedAt: now })
        .where(
          and(
            eq(mailboxesTable.orgId, org.id),
            inArray(mailboxesTable.id, affectedMailboxIds),
            eq(mailboxesTable.syncedMessages, 0),
            isNull(mailboxesTable.lastSyncAt),
          ),
        );
    }

    if (req.user) {
      const actor = actorFromRequest(req.user, req.ip);
      await auditSvc.syncEvent('sync.cancelled', actor, org.id, null, {
        jobsCancelled: cancelledJobs.length,
      });
    }

    send(res, {
      message: `Sync cancelled. ${cancelledJobs.length} job(s) stopped.`,
      cancelled: cancelledJobs.length,
    });
  }),
);

/**
 * POST /sync/resume
 * Re-enable sync and queue jobs for any mailboxes with no active job.
 */
syncRouter.post(
  '/resume',
  asyncHandler(async (_req, res) => {
    const org = await orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');

    await orgRepo.updateSyncConfig(org.id, { syncEnabled: true });

    send(res, { message: 'Sync resumed. New jobs will be queued on next /sync/start call.' });
  }),
);

/**
 * PUT /sync/config
 * Update org-level sync settings and/or per-mailbox sync settings in one call.
 *
 * Body:
 * {
 *   org?: { syncEnabled?: boolean; globalSyncFromDate?: string | null };
 *   mailboxes?: Array<{
 *     id: string;
 *     syncEnabled?: boolean;
 *     syncFromDate?: string | null;
 *     syncPriority?: number;
 *   }>;
 * }
 */
// Schedule endpoints

const VALID_BH_INTERVALS = [5, 15, 30, 60];
const VALID_OH_INTERVALS = [60, 240, 480, 1440];

/**
 * GET /sync/schedule
 * Returns the org's business-hours sync schedule config.
 * Falls back to safe defaults when no row exists yet.
 */
syncRouter.get(
  '/schedule',
  asyncHandler(async (_req, res) => {
    const org = await orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');

    const cfg = await getDb()
      .select()
      .from(orgSyncConfig)
      .where(eq(orgSyncConfig.orgId, org.id))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    const defaults = {
      timezone: 'UTC',
      businessHoursStart: '09:00',
      businessHoursEnd: '18:00',
      businessDays: [1, 2, 3, 4, 5],
      businessHoursIntervalMin: 5,
      offHoursIntervalMin: 60,
      initialSyncDays: 90,
    };

    if (!cfg) {
      send(res, defaults);
      return;
    }

    send(res, {
      timezone: cfg.timezone,
      businessHoursStart: cfg.businessHoursStart,
      businessHoursEnd: cfg.businessHoursEnd,
      businessDays: cfg.businessDays.split(',').map(Number),
      businessHoursIntervalMin: cfg.businessHoursIntervalMin,
      offHoursIntervalMin: cfg.offHoursIntervalMin,
      initialSyncDays: cfg.initialSyncDays,
    });
  }),
);

/**
 * PUT /sync/schedule
 * Create-or-update the org's sync schedule.
 * Also updates globalSyncFromDate when initialSyncDays changes.
 */
syncRouter.put(
  '/schedule',
  asyncHandler(async (req, res) => {
    const org = await orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');

    const b = (req.body ?? {}) as Record<string, unknown>;

    if (b['businessHoursIntervalMin'] !== undefined) {
      if (!VALID_BH_INTERVALS.includes(b['businessHoursIntervalMin'] as number))
        throw new ValidationError(
          `businessHoursIntervalMin must be one of: ${VALID_BH_INTERVALS.join(', ')}`,
        );
    }
    if (b['offHoursIntervalMin'] !== undefined) {
      if (!VALID_OH_INTERVALS.includes(b['offHoursIntervalMin'] as number))
        throw new ValidationError(
          `offHoursIntervalMin must be one of: ${VALID_OH_INTERVALS.join(', ')}`,
        );
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (b['timezone'] !== undefined) patch['timezone'] = b['timezone'];
    if (b['businessHoursStart'] !== undefined)
      patch['businessHoursStart'] = b['businessHoursStart'];
    if (b['businessHoursEnd'] !== undefined) patch['businessHoursEnd'] = b['businessHoursEnd'];
    if (Array.isArray(b['businessDays']))
      patch['businessDays'] = (b['businessDays'] as number[]).join(',');
    if (b['businessHoursIntervalMin'] !== undefined)
      patch['businessHoursIntervalMin'] = b['businessHoursIntervalMin'];
    if (b['offHoursIntervalMin'] !== undefined)
      patch['offHoursIntervalMin'] = b['offHoursIntervalMin'];
    if ('initialSyncDays' in b) patch['initialSyncDays'] = b['initialSyncDays'];

    const existing = await getDb()
      .select({ id: orgSyncConfig.id })
      .from(orgSyncConfig)
      .where(eq(orgSyncConfig.orgId, org.id))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (existing) {
      await getDb().update(orgSyncConfig).set(patch).where(eq(orgSyncConfig.orgId, org.id));
    } else {
      await getDb()
        .insert(orgSyncConfig)
        .values({
          orgId: org.id,
          timezone: (b['timezone'] as string | undefined) ?? 'UTC',
          businessHoursStart: (b['businessHoursStart'] as string | undefined) ?? '09:00',
          businessHoursEnd: (b['businessHoursEnd'] as string | undefined) ?? '18:00',
          businessDays: Array.isArray(b['businessDays'])
            ? (b['businessDays'] as number[]).join(',')
            : '1,2,3,4,5',
          businessHoursIntervalMin: (b['businessHoursIntervalMin'] as number | undefined) ?? 5,
          offHoursIntervalMin: (b['offHoursIntervalMin'] as number | undefined) ?? 60,
          initialSyncDays: b['initialSyncDays'] != null ? (b['initialSyncDays'] as number) : 90,
        });
    }

    // Sync globalSyncFromDate to match new initialSyncDays. Once a mailbox has
    // synced, its own syncFromDate is frozen and always wins over the org
    // default (see /sync/start below) — so changing this range wouldn't ever
    // reach an already-synced mailbox unless we clear that per-mailbox freeze
    // here, letting it re-inherit the new range on its next sync.
    if ('initialSyncDays' in b && b['initialSyncDays'] != null) {
      const days = b['initialSyncDays'] as number;
      // Plain ms arithmetic — timezone/DST-independent, unlike setDate/getDate
      // which operate on whatever local timezone the server process is in.
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      await orgRepo.updateSyncConfig(org.id, { globalSyncFromDate: from.toISOString() });
      await getDb()
        .update(mailboxesTable)
        .set({ syncFromDate: from, updatedAt: new Date() })
        .where(eq(mailboxesTable.orgId, org.id));
    } else if ('initialSyncDays' in b && b['initialSyncDays'] === null) {
      await orgRepo.updateSyncConfig(org.id, { globalSyncFromDate: null });
      await getDb()
        .update(mailboxesTable)
        .set({ syncFromDate: null, updatedAt: new Date() })
        .where(eq(mailboxesTable.orgId, org.id));
    }

    if (req.user) {
      const actor = actorFromRequest(req.user, req.ip);
      await auditSvc.syncEvent('sync.schedule_updated', actor, org.id, null, patch);
    }

    send(res, { message: 'Sync schedule saved.' });
  }),
);

// Mailbox sync config

syncRouter.put(
  '/config',
  asyncHandler(async (req, res) => {
    const body = parseSyncConfigBody(req.body);

    const org = await orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');

    // Apply org-level sync config update
    let updatedOrg = org;
    if (body.org && Object.keys(body.org).length > 0) {
      updatedOrg = await orgRepo.updateSyncConfig(org.id, body.org);
    }

    // Apply per-mailbox updates
    const mailboxUpdates: Array<{
      id: string;
      syncEnabled: boolean;
      syncFromDate: string | null;
      syncPriority: number;
    }> = [];
    if (Array.isArray(body.mailboxes) && body.mailboxes.length > 0) {
      for (const patch of body.mailboxes) {
        if (!patch.id) throw new ValidationError('Each mailbox entry must have an id');
        const updated = await mailboxRepo.updateSyncConfig(patch.id, {
          syncEnabled: patch.syncEnabled,
          syncFromDate: patch.syncFromDate,
          syncPriority: patch.syncPriority,
        });
        mailboxUpdates.push({
          id: updated.id,
          syncEnabled: updated.syncEnabled,
          syncFromDate: updated.syncFromDate,
          syncPriority: updated.syncPriority,
        });
      }
    }

    // A mailbox disabled in the setup wizard may already have been queued by an
    // older server or a concurrent trigger. Make the saved selection authoritative:
    // terminate active ingestion work for every explicitly disabled mailbox.
    const disabledMailboxIds = [
      ...new Set(
        (body.mailboxes ?? [])
          .filter((patch) => patch.syncEnabled === false)
          .map((patch) => patch.id),
      ),
    ];
    let jobsCancelled = 0;
    if (disabledMailboxIds.length > 0) {
      const db = getDb();
      const now = new Date();
      const cancelledJobs = await db
        .update(ingestionJobs)
        .set({
          status: 'dead',
          error: 'Mailbox disabled for sync',
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(ingestionJobs.orgId, org.id),
            inArray(ingestionJobs.mailboxId, disabledMailboxIds),
            inArray(ingestionJobs.status, ['pending', 'claimed', 'running']),
            inArray(ingestionJobs.jobType, [
              JobType.InitialImport,
              JobType.NewMailCheck,
              JobType.SyncRangeExtension,
            ]),
          ),
        )
        .returning({ mailboxId: ingestionJobs.mailboxId });
      jobsCancelled = cancelledJobs.length;

      const hasPriorData = or(
        gt(mailboxesTable.syncedMessages, 0),
        isNotNull(mailboxesTable.lastSyncAt),
      );
      await db
        .update(mailboxesTable)
        .set({ syncStatus: 'complete', updatedAt: now })
        .where(
          and(
            eq(mailboxesTable.orgId, org.id),
            inArray(mailboxesTable.id, disabledMailboxIds),
            hasPriorData,
          ),
        );
      await db
        .update(mailboxesTable)
        .set({ syncStatus: 'not_started', updatedAt: now })
        .where(
          and(
            eq(mailboxesTable.orgId, org.id),
            inArray(mailboxesTable.id, disabledMailboxIds),
            eq(mailboxesTable.syncedMessages, 0),
            isNull(mailboxesTable.lastSyncAt),
          ),
        );
    }

    send(res, {
      org: {
        syncEnabled: updatedOrg.syncEnabled,
        globalSyncFromDate: updatedOrg.globalSyncFromDate,
      },
      mailboxesUpdated: mailboxUpdates.length,
      jobsCancelled,
      mailboxes: mailboxUpdates,
    });
  }),
);
