import { Router } from 'express';
import { send } from '../../lib/respond';
import { and, eq, sql, count } from 'drizzle-orm';
import { getDb } from '../../db/client';
import {
  authProviders,
  ingestionJobs,
  mailboxes,
  messages,
  orgSyncConfig,
  organizations,
  threads,
} from '../../db/schema';
import { asyncHandler } from '../../lib/async-handler';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { decrypt } from '../auth-providers/auth-provider.crypto';
import { createAlertRepository } from '../alerts/alert.repository';
import { AlertService } from '../alerts/alert.service';
import { JOB_TYPE_LABELS, JobType } from '../../lib/job-type';
import type { EmailAddress } from '../../db/schema';
import { collectorHeartbeatService } from '../../services/collector-heartbeat.service';
import { triggerRagIngest } from '../chat/clients/rag.client';
import { indexPendingAttachmentsForMailbox } from '../../services/attachments.service';

const alertsSvc = new AlertService(createAlertRepository());

/**
 * Start body indexing immediately, then populate provider attachment metadata
 * and trigger one follow-up incremental pass for any newly discovered files.
 * The RAG service serializes these requests, so simultaneous mailbox syncs
 * cannot race its global cursors or Qdrant delete/upsert operations.
 */
function triggerAutomaticRagVectorization(mailboxId: string): void {
  triggerRagIngest().catch((err) =>
    logger.debug({ err, mailboxId }, 'automatic RAG vectorization trigger skipped'),
  );

  void indexPendingAttachmentsForMailbox(mailboxId)
    .then((summary) => {
      if (summary.messagesIndexed === 0) return;
      return triggerRagIngest().then((result) => {
        if (!result) {
          logger.debug({ mailboxId, ...summary }, 'attachment follow-up RAG trigger skipped');
        }
      });
    })
    .catch((err) =>
      logger.warn(
        { err, mailboxId },
        'automatic attachment metadata indexing failed; next sync will retry',
      ),
    );
}

/** Turns the collector's structured failure into an alert-safe explanation. */
function humanizeJobError(raw: string | undefined): string {
  if (!raw) return 'An unknown error occurred.';

  try {
    const parsed = JSON.parse(raw) as { userMessage?: unknown };
    if (typeof parsed.userMessage === 'string' && parsed.userMessage.trim())
      return parsed.userMessage;
  } catch {
    /* Legacy errors below have no structured payload. */
  }

  return 'An unexpected error occurred while syncing this mailbox.';
}

/** Records an alert for a job-level failure reported by the collector. */
async function recordJobFailureAlert(
  db: ReturnType<typeof getDb>,
  job: { orgId: string; mailboxId: string; jobType: string },
  errorMsg: string | undefined,
  isDead: boolean,
): Promise<void> {
  const [mb] = await db
    .select({ address: mailboxes.address })
    .from(mailboxes)
    .where(eq(mailboxes.id, job.mailboxId));
  const label = JOB_TYPE_LABELS[job.jobType as JobType] ?? 'Sync';
  await alertsSvc.record({
    orgId: job.orgId,
    severity: isDead ? 'critical' : 'warning',
    category: label,
    title: `${label} job ${isDead ? 'permanently failed' : 'failed, retrying'}${mb ? ` for ${mb.address}` : ''}`,
    description: humanizeJobError(errorMsg),
    source: 'Collector',
    mailboxId: job.mailboxId,
  });
}

// Types

interface RawMessageBody {
  providerMessageId: string;
  providerThreadId?: string;
  rfcMessageId?: string;
  subject?: string;
  fromAddress: string;
  fromName?: string;
  toAddresses: EmailAddress[];
  ccAddresses: EmailAddress[];
  bccAddresses: EmailAddress[];
  bodyText?: string;
  hasAttachments: boolean;
  receivedAt: string;
  sentAt?: string;
  sizeBytes?: number;
  importance?: 'low' | 'normal' | 'high';
  isRead?: boolean;
  labels?: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

function normalizeAddresses(raw: unknown): EmailAddress[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => item as Partial<EmailAddress>)
    .filter((item) => isNonEmptyString(item.email))
    .map((item) => ({
      email: item.email!.trim(),
      ...(isNonEmptyString(item.name) ? { name: item.name } : {}),
    }));
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isNonEmptyString);
}

function normalizeImportance(raw: unknown): 'low' | 'normal' | 'high' {
  if (raw === 'low' || raw === 'high') return raw;
  return 'normal';
}

function normalizeRawMessage(raw: RawMessageBody): RawMessageBody | null {
  if (!isNonEmptyString(raw.providerMessageId) || !isValidDateString(raw.receivedAt)) {
    return null;
  }

  const sentAt = isValidDateString(raw.sentAt) ? raw.sentAt : undefined;
  const sizeBytes =
    typeof raw.sizeBytes === 'number' && Number.isFinite(raw.sizeBytes)
      ? Math.trunc(raw.sizeBytes)
      : undefined;

  return {
    providerMessageId: raw.providerMessageId.trim(),
    providerThreadId: isNonEmptyString(raw.providerThreadId) ? raw.providerThreadId : undefined,
    rfcMessageId: isNonEmptyString(raw.rfcMessageId) ? raw.rfcMessageId : undefined,
    subject: typeof raw.subject === 'string' ? raw.subject : undefined,
    fromAddress: typeof raw.fromAddress === 'string' ? raw.fromAddress : '',
    fromName: isNonEmptyString(raw.fromName) ? raw.fromName : undefined,
    toAddresses: normalizeAddresses(raw.toAddresses),
    ccAddresses: normalizeAddresses(raw.ccAddresses),
    bccAddresses: normalizeAddresses(raw.bccAddresses),
    bodyText: typeof raw.bodyText === 'string' ? raw.bodyText : undefined,
    hasAttachments: Boolean(raw.hasAttachments),
    receivedAt: raw.receivedAt,
    sentAt,
    sizeBytes,
    importance: normalizeImportance(raw.importance),
    isRead: Boolean(raw.isRead),
    labels: normalizeStringArray(raw.labels),
  };
}

// Router

export const internalRouter = Router();

// Validate Authorization: Bearer <COLLECTOR_SECRET> on every /v1/internal/* request.
// Tokens must never appear in URLs or query params.
internalRouter.use((req, res, next) => {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Missing Bearer token' } });
    return;
  }
  const token = auth.slice(7);
  if (token !== config.collector.secret) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid collector secret' } });
    return;
  }
  next();
});

// GET /v1/internal/jobs/claim
// Atomically claim up to ?limit= pending jobs (default 10, max 50).
// The collector's instance_id (hostname:pid) is recorded as a heartbeat.
// Returns job metadata — credentials are fetched separately via /jobs/:id/token.

internalRouter.get(
  '/jobs/claim',
  asyncHandler(async (req, res) => {
    const limit = Math.min(
      Math.max(1, parseInt((req.query['limit'] as string) || '10', 10) || 10),
      50,
    );
    const instanceId = (req.query['instance'] as string) || 'unknown';
    const db = getDb();

    collectorHeartbeatService.markSeen(instanceId);
    logger.debug({ instanceId, limit }, 'collector claim request (heartbeat)');

    // Atomically select and claim pending jobs.
    const claimedAt = new Date();
    let claimedJobs: Array<Record<string, unknown>> = [];

    await db.transaction(async (tx) => {
      // SELECT pending jobs ordered by priority (highest first) with FOR UPDATE SKIP LOCKED
      // so multiple collector instances never claim the same job.
      // Mailbox scans always claim regardless of the org pause flag — a scan is
      // a lightweight read-only lookup, not "syncing", and mailboxes triggered
      // by login/connect should still get their stats even while sync is paused.
      const rows = await tx.execute(sql`
      SELECT
        ij.id, ij.org_id, ij.mailbox_id, ij.job_type, ij.status, ij.retry_count,
        m.address, m.provider, m.provider_user_id, m.sync_token, m.sync_from_date, m.backfilled_from_at
      FROM ingestion_jobs ij
      JOIN mailboxes m ON m.id = ij.mailbox_id
      JOIN organizations o ON o.id = ij.org_id
      WHERE ij.status = 'pending'
        AND (ij.job_type = ${JobType.MailboxScan} OR o.sync_enabled = true)
      ORDER BY ij.priority DESC, ij.created_at ASC
      LIMIT ${limit}
      FOR UPDATE OF ij SKIP LOCKED
    `);

      if (rows.rows.length === 0) return;

      const ids = rows.rows.map((r) => r['id'] as string);

      await tx.execute(sql`
      UPDATE ingestion_jobs
      SET status = 'claimed', claimed_by = ${instanceId}, claimed_at = ${claimedAt}, updated_at = ${claimedAt}
      WHERE id = ANY(ARRAY[${sql.raw(ids.map((id) => `'${id}'`).join(','))}]::uuid[])
    `);

      claimedJobs = rows.rows as Array<Record<string, unknown>>;
    });

    send(
      res,
      claimedJobs.map((r) => ({
        jobId: r['id'],
        orgId: r['org_id'],
        mailboxId: r['mailbox_id'],
        jobType: r['job_type'],
        address: r['address'],
        provider: r['provider'],
        providerUserId: r['provider_user_id'],
        syncToken: r['sync_token'],
        syncFromDate: r['sync_from_date'],
        backfilledFromAt: r['backfilled_from_at'],
      })),
    );
  }),
);

// GET /v1/internal/jobs/:id/token
// Return decrypted provider credentials for a claimed job.
// Fetched just-in-time — not bundled in the claim response.

internalRouter.get(
  '/jobs/:id/token',
  asyncHandler(async (req, res) => {
    const db = getDb();

    const [job] = await db
      .select({ mailboxId: ingestionJobs.mailboxId, status: ingestionJobs.status })
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, req.params['id']!));

    if (!job) {
      res.status(404).json({ error: { code: 'not_found', message: 'Job not found' } });
      return;
    }
    if (job.status !== 'claimed' && job.status !== 'running') {
      res
        .status(409)
        .json({ error: { code: 'conflict', message: 'Job is not in claimed/running state' } });
      return;
    }

    const [mailbox] = await db
      .select({ provider: mailboxes.provider })
      .from(mailboxes)
      .where(eq(mailboxes.id, job.mailboxId));

    if (!mailbox) {
      res.status(404).json({ error: { code: 'not_found', message: 'Mailbox not found' } });
      return;
    }

    const provider = mailbox.provider as 'm365' | 'google';

    const [ap] = await db.select().from(authProviders).where(eq(authProviders.provider, provider));

    if (!ap) {
      res.status(503).json({
        error: {
          code: 'provider_unavailable',
          message: `Provider '${provider}' is not configured`,
        },
      });
      return;
    }

    if (provider === 'm365') {
      if (!ap.tenantId || !ap.clientId || !ap.clientSecret) {
        res.status(503).json({
          error: { code: 'credentials_incomplete', message: 'M365 credentials incomplete' },
        });
        return;
      }
      send(res, {
        provider: 'm365',
        tenantId: ap.tenantId,
        clientId: ap.clientId,
        clientSecret: decrypt(ap.clientSecret),
      });
    } else {
      if (!ap.serviceAccountJson) {
        res.status(503).json({
          error: { code: 'credentials_incomplete', message: 'Google credentials incomplete' },
        });
        return;
      }
      send(res, {
        provider: 'google',
        serviceAccountJson: decrypt(ap.serviceAccountJson),
      });
    }
  }),
);

// PATCH /v1/internal/jobs/:id
// Collector updates job status: 'running' | 'done' | 'failed'.
// On 'done': mailbox sync_status and last_sync_at are updated.
// On 'failed': server applies retry logic (reset to pending or mark dead).

internalRouter.patch(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const now = new Date();
    const {
      status,
      stats,
      error: errorMsg,
      nextSyncToken,
      probeResult,
    } = req.body as {
      status?: string;
      stats?: { fetched?: number; accepted?: number; skipped?: number; errors?: number };
      error?: string;
      nextSyncToken?: string;
      probeResult?: { earliestEmailAt?: string; emailCountEstimate?: number };
    };

    const [job] = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, req.params['id']!));

    if (!job) {
      res.status(404).json({ error: { code: 'not_found', message: 'Job not found' } });
      return;
    }

    if (job.claimedBy) collectorHeartbeatService.markSeen(job.claimedBy);

    // Already terminated (cancelled by the user, completed, or marked dead while
    // the collector was still mid-flight) — a late 'running'/'done'/'failed'
    // report must not resurrect the job or flip the mailbox's status back.
    if (job.status === 'dead' || job.status === 'done') {
      logger.debug(
        { jobId: job.id, jobStatus: job.status, lateStatus: status },
        'ignoring late status update for terminated job',
      );
      send(res, { ok: true, ignored: true });
      return;
    }

    // 'running' doubles as the collector's per-job heartbeat (sent every
    // JOB_HEARTBEAT_MS while a worker holds the job). It is only valid while the
    // job is legitimately held — after a stale-sweep requeue (status back to
    // 'pending') a late heartbeat from the old worker must not mark the job
    // running again, or nobody would ever finish it.
    if (status === 'running' && job.status !== 'claimed' && job.status !== 'running') {
      logger.debug(
        { jobId: job.id, jobStatus: job.status },
        'ignoring stale heartbeat for job no longer held',
      );
      send(res, { ok: true, ignored: true });
      return;
    }

    if (status === 'dead') {
      await db
        .update(ingestionJobs)
        .set({
          status: 'dead',
          finishedAt: now,
          error: errorMsg ?? null,
          stats: stats ?? job.stats,
          updatedAt: now,
        })
        .where(eq(ingestionJobs.id, job.id));
      // A sync-range extension is a background gap-fill — its failure doesn't mean
      // the mailbox's regular sync is broken, so it never touches syncStatus/probeStatus.
      if (job.jobType !== JobType.SyncRangeExtension) {
        await db
          .update(mailboxes)
          .set(
            job.jobType === JobType.MailboxScan
              ? { probeStatus: 'error', updatedAt: now }
              : { syncStatus: 'error', updatedAt: now },
          )
          .where(eq(mailboxes.id, job.mailboxId));
      }
      await recordJobFailureAlert(db, job, errorMsg, true);
    } else if (status === 'running') {
      await db
        .update(ingestionJobs)
        .set({
          status: 'running',
          startedAt: job.startedAt ?? now,
          stats: stats ?? job.stats,
          updatedAt: now,
        })
        .where(eq(ingestionJobs.id, job.id));
    } else if (status === 'done') {
      await db
        .update(ingestionJobs)
        .set({ status: 'done', finishedAt: now, stats: stats ?? job.stats, updatedAt: now })
        .where(eq(ingestionJobs.id, job.id));

      if (job.jobType === JobType.MailboxScan) {
        await db
          .update(mailboxes)
          .set({
            probeStatus: 'complete',
            earliestEmailAt: probeResult?.earliestEmailAt
              ? new Date(probeResult.earliestEmailAt)
              : null,
            emailCountEstimate: probeResult?.emailCountEstimate ?? null,
            updatedAt: now,
          })
          .where(eq(mailboxes.id, job.mailboxId));
      } else if (job.jobType === JobType.SyncRangeExtension) {
        // Gap-fill only — never touches syncToken (the forward/incremental
        // cursor) or syncStatus/lastSyncAt (not a "checked for new mail" event).
        // Just record that history now reaches back to this mailbox's target date.
        const [{ value: totalCount }] = await db
          .select({ value: count() })
          .from(messages)
          .where(eq(messages.mailboxId, job.mailboxId));

        const [mb] = await db
          .select({ syncFromDate: mailboxes.syncFromDate })
          .from(mailboxes)
          .where(eq(mailboxes.id, job.mailboxId));

        await db
          .update(mailboxes)
          .set({
            totalMessages: totalCount,
            syncedMessages: totalCount,
            backfilledFromAt: mb?.syncFromDate ?? new Date(0),
            updatedAt: now,
          })
          .where(eq(mailboxes.id, job.mailboxId));
      } else {
        // Count the actual total in the DB — most accurate after all batches have been flushed.
        const [{ value: totalCount }] = await db
          .select({ value: count() })
          .from(messages)
          .where(eq(messages.mailboxId, job.mailboxId));

        // A completed initial import (first-ever sync) also establishes the
        // backfill watermark — how far back this mailbox has now actually been fetched.
        let backfillPatch: { backfilledFromAt?: Date } = {};
        if (job.jobType === JobType.InitialImport) {
          const [mb] = await db
            .select({ syncFromDate: mailboxes.syncFromDate })
            .from(mailboxes)
            .where(eq(mailboxes.id, job.mailboxId));
          backfillPatch = { backfilledFromAt: mb?.syncFromDate ?? new Date(0) };
        }

        await db
          .update(mailboxes)
          .set({
            syncStatus: 'complete',
            lastSyncAt: now,
            totalMessages: totalCount,
            syncedMessages: totalCount,
            ...(nextSyncToken ? { syncToken: nextSyncToken } : {}),
            ...backfillPatch,
            updatedAt: now,
          })
          .where(eq(mailboxes.id, job.mailboxId));
      }

      // One automatic workflow covers message bodies and attachments. Attachment
      // metadata is discovered from the provider in the background; no user has
      // to open the Attachments page or run a separate command first.
      if (job.jobType !== JobType.MailboxScan) {
        triggerAutomaticRagVectorization(job.mailboxId);
      }
    } else if (status === 'failed') {
      const newRetryCount = (job.retryCount ?? 0) + 1;
      const isDead = newRetryCount >= (job.maxRetries ?? 3);

      await db
        .update(ingestionJobs)
        .set({
          status: isDead ? 'dead' : 'failed',
          finishedAt: now,
          stats: stats ?? job.stats,
          error: errorMsg ?? null,
          retryCount: newRetryCount,
          updatedAt: now,
        })
        .where(eq(ingestionJobs.id, job.id));

      if (job.jobType === JobType.MailboxScan) {
        await db
          .update(mailboxes)
          .set({ probeStatus: 'error', updatedAt: now })
          .where(eq(mailboxes.id, job.mailboxId));
      } else if (job.jobType !== JobType.SyncRangeExtension) {
        // A sync-range extension is a background gap-fill — a retryable failure
        // there doesn't mean the mailbox's regular sync is broken.
        await db
          .update(mailboxes)
          .set({ syncStatus: 'error', updatedAt: now })
          .where(eq(mailboxes.id, job.mailboxId));
      }

      // Re-queue if retries remain (will be picked up on next poll cycle)
      if (!isDead) {
        await db
          .update(ingestionJobs)
          .set({ status: 'pending', claimedAt: null, claimedBy: null, updatedAt: now })
          .where(eq(ingestionJobs.id, job.id));
      }

      await recordJobFailureAlert(db, job, errorMsg, isDead);
    }

    send(res, { ok: true });
  }),
);

// POST /v1/internal/ingest/batch
// Collector flushes a batch of messages. Server deduplicates, upserts threads,
// inserts messages. Returns { accepted, skipped }. Idempotent — safe to retry.

internalRouter.post(
  '/ingest/batch',
  asyncHandler(async (req, res) => {
    const {
      jobId,
      orgId,
      mailboxId,
      messages: batch,
      nextSyncToken,
    } = req.body as {
      jobId: string;
      orgId: string;
      mailboxId: string;
      messages: RawMessageBody[];
      nextSyncToken?: string;
    };

    if (!orgId || !mailboxId || !Array.isArray(batch)) {
      res.status(400).json({
        error: { code: 'validation_error', message: 'orgId, mailboxId, messages[] required' },
      });
      return;
    }

    const db = getDb();
    if (jobId) {
      const [job] = await db
        .select({
          status: ingestionJobs.status,
          orgId: ingestionJobs.orgId,
          mailboxId: ingestionJobs.mailboxId,
          jobType: ingestionJobs.jobType,
          syncEnabled: mailboxes.syncEnabled,
        })
        .from(ingestionJobs)
        .innerJoin(mailboxes, eq(mailboxes.id, ingestionJobs.mailboxId))
        .where(eq(ingestionJobs.id, jobId));

      const isSyncJob = job?.jobType !== JobType.MailboxScan;
      const isValidActiveJob =
        !!job &&
        job.orgId === orgId &&
        job.mailboxId === mailboxId &&
        (job.status === 'claimed' || job.status === 'running') &&
        (!isSyncJob || job.syncEnabled);

      if (!isValidActiveJob) {
        res.status(409).json({
          error: { code: 'conflict', message: 'Sync job is no longer active for this mailbox' },
        });
        return;
      }
    }

    if (batch.length === 0) {
      send(res, { accepted: 0, skipped: 0 });
      return;
    }

    const normalizedBatch = batch
      .map(normalizeRawMessage)
      .filter((msg): msg is RawMessageBody => msg !== null);
    const rejected = batch.length - normalizedBatch.length;

    if (rejected > 0) {
      logger.warn({ jobId, mailboxId, rejected }, 'ingest/batch skipped invalid messages');
    }

    if (normalizedBatch.length === 0) {
      send(res, { accepted: 0, skipped: rejected });
      return;
    }

    const { accepted, skipped } = await persistBatch(db, orgId, mailboxId, normalizedBatch);
    const totalSkipped = skipped + rejected;

    // Update sync_token on the mailbox if collector sends one mid-batch
    if (nextSyncToken) {
      await db
        .update(mailboxes)
        .set({ syncToken: nextSyncToken, updatedAt: new Date() })
        .where(eq(mailboxes.id, mailboxId));
    }

    // Keep job stats in sync (best-effort; job PATCH at end is the authoritative update)
    if (jobId) {
      await db.execute(sql`
      UPDATE ingestion_jobs
      SET stats = jsonb_set(
        jsonb_set(COALESCE(stats, '{}'::jsonb), '{accepted}', to_jsonb(COALESCE((stats->>'accepted')::int, 0) + ${accepted})),
        '{skipped}', to_jsonb(COALESCE((stats->>'skipped')::int, 0) + ${totalSkipped})
      ), updated_at = ${new Date()}
      WHERE id = ${jobId}
    `);
    }

    logger.debug(
      { jobId, mailboxId, accepted, skipped: totalSkipped, rejected },
      'ingest/batch complete',
    );

    send(res, { accepted, skipped: totalSkipped });
  }),
);

// GET /v1/internal/collectors
// Dashboard: recent collector heartbeats (derived from claimed_by in active jobs).

internalRouter.get(
  '/collectors',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const rows = await db.execute(sql`
    SELECT
      claimed_by AS instance_id,
      MAX(COALESCE(updated_at, claimed_at)) AS last_seen,
      COUNT(*) FILTER (WHERE status IN ('claimed','running')) AS jobs_in_flight
    FROM ingestion_jobs
    WHERE claimed_by IS NOT NULL
      AND COALESCE(updated_at, claimed_at) > NOW() - INTERVAL '60 minutes'
    GROUP BY claimed_by
    ORDER BY last_seen DESC
  `);
    const seen = new Map<string, Record<string, unknown>>();
    for (const row of rows.rows) {
      const r = row as { instance_id?: string };
      if (r.instance_id) seen.set(r.instance_id, row);
    }

    for (const heartbeat of collectorHeartbeatService.list()) {
      const existing = seen.get(heartbeat.instanceId);
      if (existing) {
        const lastSeen =
          existing['last_seen'] instanceof Date
            ? existing['last_seen']
            : new Date(String(existing['last_seen']));
        if (!Number.isFinite(lastSeen.getTime()) || heartbeat.lastSeenAt > lastSeen) {
          existing['last_seen'] = heartbeat.lastSeenAt;
        }
      } else {
        seen.set(heartbeat.instanceId, {
          instance_id: heartbeat.instanceId,
          last_seen: heartbeat.lastSeenAt,
          jobs_in_flight: 0,
        });
      }
    }

    send(res, Array.from(seen.values()));
  }),
);

// GET /v1/internal/sync-schedule
// Business-hours-aware poll cadence, read by the collector's poll loop so
// "Business hours interval" / "Off-hours interval" actually change behavior.

internalRouter.get(
  '/sync-schedule',
  asyncHandler(async (_req, res) => {
    const db = getDb();

    const defaults = {
      timezone: 'UTC',
      businessHoursStart: '09:00',
      businessHoursEnd: '18:00',
      businessDays: [1, 2, 3, 4, 5],
      businessHoursIntervalMin: 5,
      offHoursIntervalMin: 60,
    };

    const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
    if (!org) {
      send(res, defaults);
      return;
    }

    const [cfg] = await db
      .select()
      .from(orgSyncConfig)
      .where(eq(orgSyncConfig.orgId, org.id))
      .limit(1);
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
    });
  }),
);

// persistBatch
// Upsert threads + insert messages (dedup on providerMessageId).
// Returns counts of accepted (new) and skipped (duplicate) messages.

async function persistBatch(
  db: ReturnType<typeof getDb>,
  orgId: string,
  mailboxId: string,
  batch: RawMessageBody[],
): Promise<{ accepted: number; skipped: number }> {
  let accepted = 0;
  let skipped = 0;

  // Process in chunks of 100 to avoid oversized statements
  for (let i = 0; i < batch.length; i += 100) {
    const chunk = batch.slice(i, i + 100);
    const result = await persistChunk(db, orgId, mailboxId, chunk);
    accepted += result.accepted;
    skipped += result.skipped;
  }

  return { accepted, skipped };
}

async function persistChunk(
  db: ReturnType<typeof getDb>,
  orgId: string,
  mailboxId: string,
  chunk: RawMessageBody[],
): Promise<{ accepted: number; skipped: number }> {
  // 1. Upsert threads
  const threadIds = [...new Set(chunk.map((m) => m.providerThreadId).filter(Boolean))] as string[];
  const threadIdMap = new Map<string, string>(); // providerThreadId → thread.id (uuid)

  for (const providerThreadId of threadIds) {
    const [existing] = await db
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.mailboxId, mailboxId), eq(threads.providerThreadId, providerThreadId)));

    if (existing) {
      threadIdMap.set(providerThreadId, existing.id);
      continue;
    }

    const threadMsgs = chunk.filter((m) => m.providerThreadId === providerThreadId);
    const subject = threadMsgs[0]?.subject ?? null;
    const participants = [
      ...new Set([
        ...threadMsgs.map((m) => m.fromAddress),
        ...threadMsgs.flatMap((m) => m.toAddresses.map((a) => a.email)),
        ...threadMsgs.flatMap((m) => m.ccAddresses.map((a) => a.email)),
      ]),
    ].filter(Boolean);

    const dates = threadMsgs
      .map((m) => new Date(m.receivedAt))
      .sort((a, b) => a.getTime() - b.getTime());

    const [inserted] = await db
      .insert(threads)
      .values({
        orgId,
        mailboxId,
        providerThreadId,
        subject,
        participantEmails: participants,
        messageCount: 0,
        hasAttachments: threadMsgs.some((m) => m.hasAttachments),
        firstMessageAt: dates[0] ?? null,
        lastMessageAt: dates.at(-1) ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: threads.id });

    if (inserted) {
      threadIdMap.set(providerThreadId, inserted.id);
    } else {
      const [winner] = await db
        .select({ id: threads.id })
        .from(threads)
        .where(
          and(eq(threads.mailboxId, mailboxId), eq(threads.providerThreadId, providerThreadId)),
        );
      if (winner) threadIdMap.set(providerThreadId, winner.id);
    }
  }

  // 2. Insert messages — ON CONFLICT DO NOTHING deduplicates by (mailboxId, providerMessageId)
  const rows = chunk.map((m) => ({
    orgId,
    mailboxId,
    threadId: m.providerThreadId ? (threadIdMap.get(m.providerThreadId) ?? null) : null,
    providerMessageId: m.providerMessageId,
    providerThreadId: m.providerThreadId ?? null,
    rfcMessageId: m.rfcMessageId ?? null,
    subject: m.subject ?? null,
    fromAddress: m.fromAddress,
    fromName: m.fromName ?? null,
    toAddresses: m.toAddresses,
    ccAddresses: m.ccAddresses,
    bccAddresses: m.bccAddresses,
    bodyText: m.bodyText ?? null,
    hasAttachments: m.hasAttachments,
    receivedAt: new Date(m.receivedAt),
    sentAt: m.sentAt ? new Date(m.sentAt) : null,
    sizeBytes: m.sizeBytes ?? null,
    importance: m.importance ?? 'normal',
    isRead: m.isRead ?? false,
    labels: m.labels ?? [],
  }));

  const insertResult = await db
    .insert(messages)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: messages.id });

  const chunkAccepted = insertResult.length;
  const chunkSkipped = chunk.length - chunkAccepted;

  // 3. Recount thread message counts from DB (accurate, avoids double-counting duplicates)
  for (const [providerThreadId, threadId] of threadIdMap.entries()) {
    const threadMsgs = chunk.filter((m) => m.providerThreadId === providerThreadId);
    const dates = threadMsgs.map((m) => new Date(m.receivedAt));
    const earliestDate = [...dates].sort((a, b) => a.getTime() - b.getTime())[0];
    const latestDate = dates.at(-1);

    const chunkParticipants = [
      ...new Set(
        threadMsgs.flatMap((m) => [
          m.fromAddress,
          ...m.toAddresses.map((a) => a.email),
          ...m.ccAddresses.map((a) => a.email),
        ]),
      ),
    ].filter(Boolean);

    const [{ value: actualCount }] = await db
      .select({ value: count() })
      .from(messages)
      .where(eq(messages.threadId, threadId));

    await db
      .update(threads)
      .set({
        messageCount: actualCount,
        participantEmails: sql`(
          select coalesce(jsonb_agg(distinct p), '[]'::jsonb)
          from jsonb_array_elements_text(${threads.participantEmails} || ${JSON.stringify(chunkParticipants)}::jsonb) as t(p)
        )`,
        hasAttachments: sql`${threads.hasAttachments} OR ${threadMsgs.some((m) => m.hasAttachments)}`,
        firstMessageAt: sql`LEAST(${threads.firstMessageAt}, ${earliestDate?.toISOString() ?? null}::timestamptz)`,
        lastMessageAt: sql`GREATEST(${threads.lastMessageAt}, ${latestDate?.toISOString() ?? null}::timestamptz)`,
        updatedAt: new Date(),
      })
      .where(eq(threads.id, threadId));
  }

  return { accepted: chunkAccepted, skipped: chunkSkipped };
}
