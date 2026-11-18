import { env } from '../config/env';
import { JobType } from './job-type';
import { logger } from '../observability/logger';
import { ApiError, getJobToken, updateJob, type ClaimedJob } from '../clients/core-server.client';
import { MessageBuffer } from './message-buffer';
import { isSyncError, SyncRecoveryAction } from '../connectors/sync-error';
import { M365Connector } from '../connectors/m365.connector';
import { GoogleConnector } from '../connectors/google.connector';
import type { MailConnector } from '../connectors/connector';
import type { FetchSummary, MailboxRef, MessageStream } from '../connectors/connector.types';

/**
 * Drains a connector's page stream into the flush buffer as pages arrive.
 * This is the heart of flat-memory ingestion: at any moment the collector
 * holds at most one provider page + one unflushed buffer, regardless of
 * whether the mailbox has 600 or 300,000 messages. Every buffer flush also
 * persists progress to the server, so a crash loses at most one buffer.
 */
async function drainStream(
  stream: MessageStream,
  buffer: MessageBuffer,
): Promise<{ fetched: number; summary: FetchSummary }> {
  let fetched = 0;
  let result = await stream.next();
  while (!result.done) {
    for (const msg of result.value) {
      fetched++;
      await buffer.add(msg);
    }
    result = await stream.next();
  }
  return { fetched, summary: result.value };
}

/**
 * Runs one claimed job end-to-end and reports the outcome back to the server.
 * Never throws — every failure path ends in an updateJob('failed'|'dead')
 * report. Returns true when the job completed successfully.
 */
export async function processJob(job: ClaimedJob): Promise<boolean> {
  const {
    jobId,
    orgId,
    mailboxId,
    address,
    provider,
    providerUserId,
    syncToken,
    syncFromDate,
    backfilledFromAt,
  } = job;
  logger.info({ jobId, address, jobType: job.jobType }, 'job started');

  // Mark job as running
  await updateJob(jobId, 'running').catch((err) =>
    logger.warn({ err, jobId }, 'failed to mark job running - continuing'),
  );

  // Liveness heartbeat: keep re-sending 'running' while the job is in flight
  // so the server can tell a long-running job apart from a dead collector.
  // A job may legitimately take 10–15+ minutes (large backfill); without this
  // the server would have no way to know the worker is still alive. The
  // server ignores heartbeats for jobs it no longer considers held, so a
  // heartbeat racing the final done/failed report is harmless.
  const heartbeat = setInterval(() => {
    updateJob(jobId, 'running').catch((err) =>
      logger.debug({ err, jobId }, 'job heartbeat failed — will retry next interval'),
    );
  }, env.JOB_HEARTBEAT_MS);

  try {
    const creds = await getJobToken(jobId);
    const connector: MailConnector = buildConnector(creds);

    const mailboxRef: MailboxRef = {
      id: mailboxId,
      orgId,
      address,
      provider,
      providerUserId: providerUserId ?? undefined,
      syncToken: syncToken ?? undefined,
      syncFromDate: syncFromDate ?? undefined,
      backfilledFromAt: backfilledFromAt ?? undefined,
    };

    if (job.jobType === JobType.MailboxScan) {
      await runMailboxScanJob(jobId, address, connector, mailboxRef);
    } else if (job.jobType === JobType.SyncRangeExtension) {
      await runSyncRangeExtensionJob(jobId, orgId, mailboxId, address, connector, mailboxRef);
    } else {
      // InitialImport and NewMailCheck share one path — the connector decides
      // by the presence of the mailbox's sync cursor.
      await runImportJob(jobId, orgId, mailboxId, address, connector, mailboxRef);
    }
    return true;
  } catch (err: unknown) {
    const errorMsg = isSyncError(err)
      ? JSON.stringify(err.toJSON())
      : err instanceof Error
        ? err.message
        : String(err);
    // 503 = provider not configured / credentials incomplete on the server;
    // 409 = job no longer in a claimable state. Neither can succeed on retry.
    const isPermanent =
      (err instanceof ApiError && (err.status === 503 || err.status === 409)) ||
      (isSyncError(err) && !err.details.retryable);
    const finalStatus = isPermanent ? 'dead' : 'failed';

    if (isPermanent) {
      logger.warn({ err, jobId, address }, 'permanent job failure - marking dead');
    } else {
      logger.error({ err, jobId, address }, 'job failed');
    }

    await updateJob(jobId, finalStatus, undefined, errorMsg).catch((e) =>
      logger.error({ e, jobId }, 'failed to report job failure'),
    );
    return false;
  } finally {
    clearInterval(heartbeat);
  }
}

// ── Job handlers ─────────────────────────────────────────────────────────────

async function runMailboxScanJob(
  jobId: string,
  address: string,
  connector: MailConnector,
  mailboxRef: MailboxRef,
): Promise<void> {
  const probeResult = await connector.probeMailbox(mailboxRef);
  const stats = { fetched: 0, accepted: 0, skipped: 0, errors: 0 };
  await updateJob(jobId, 'done', stats, undefined, undefined, probeResult);
  logger.info({ jobId, address, probeResult }, 'mailbox scan done');
}

async function runImportJob(
  jobId: string,
  orgId: string,
  mailboxId: string,
  address: string,
  connector: MailConnector,
  mailboxRef: MailboxRef,
): Promise<void> {
  const buffer = new MessageBuffer(jobId, orgId, mailboxId);

  let outcome;
  try {
    outcome = await drainStream(connector.fetchMailbox(mailboxRef), buffer);
  } catch (err: unknown) {
    // Gmail's historyId expires after ~1 week of inactivity — the connector
    // signals this so we can transparently fall back to a full backfill
    // instead of failing the job. Anything already flushed before the signal
    // is deduplicated server-side on the re-run.
    if (
      (err as { code?: string }).code === 'GMAIL_HISTORY_EXPIRED' ||
      (isSyncError(err) && err.details.action === SyncRecoveryAction.FullResync)
    ) {
      logger.info({ jobId, address }, 'historyId expired - retrying as full backfill');
      outcome = await drainStream(
        connector.fetchMailbox({ ...mailboxRef, syncToken: undefined }),
        buffer,
      );
    } else {
      throw err;
    }
  }

  const nextSyncToken = outcome.summary.nextSyncToken;
  await buffer.flush(nextSyncToken);

  const stats = { fetched: outcome.fetched, ...buffer.getStats() };
  await updateJob(jobId, 'done', stats, undefined, nextSyncToken);
  logger.info({ jobId, address, ...stats }, 'import job done');
}

async function runSyncRangeExtensionJob(
  jobId: string,
  orgId: string,
  mailboxId: string,
  address: string,
  connector: MailConnector,
  mailboxRef: MailboxRef,
): Promise<void> {
  if (!mailboxRef.syncFromDate) {
    // Nothing to extend to — shouldn't normally happen since the server only
    // queues this job when a target date is set, but guard defensively.
    await updateJob(jobId, 'done', { fetched: 0, accepted: 0, skipped: 0, errors: 0 });
    logger.warn({ jobId, address }, 'sync-range extension had no target date - skipped');
    return;
  }

  const buffer = new MessageBuffer(jobId, orgId, mailboxId);
  const to = mailboxRef.backfilledFromAt ?? new Date().toISOString();
  const outcome = await drainStream(
    connector.fetchBackfillRange(mailboxRef, mailboxRef.syncFromDate, to),
    buffer,
  );

  // Never pass a sync token — a sync-range extension must not disturb the mailbox's
  // forward/incremental cursor.
  await buffer.flush(undefined);

  const stats = { fetched: outcome.fetched, ...buffer.getStats() };
  await updateJob(jobId, 'done', stats);
  logger.info({ jobId, address, ...stats }, 'sync-range extension done');
}

// ── Connector factory (credentials come from server, not DB) ─────────────────

function buildConnector(creds: Awaited<ReturnType<typeof getJobToken>>): MailConnector {
  if (creds.provider === 'm365') {
    return new M365Connector({
      tenantId: creds.tenantId,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
  }
  if (creds.provider === 'google') {
    return new GoogleConnector({ serviceAccountJson: creds.serviceAccountJson });
  }
  throw new Error(`Unknown provider: ${(creds as { provider: string }).provider}`);
}
