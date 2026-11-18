import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ClaimedJob } from '../src/clients/core-server.client';
import { JobType } from '../src/jobs/job-type';
import type { FetchSummary, MessageStream, RawMessage } from '../src/connectors/connector.types';

const updateJob = vi.fn();
const getJobToken = vi.fn();

vi.mock('../src/clients/core-server.client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/clients/core-server.client')>();
  return {
    ...actual,
    updateJob: (...args: unknown[]) => updateJob(...args),
    getJobToken: (...args: unknown[]) => getJobToken(...args),
  };
});

const fetchMailbox = vi.fn();
const fetchBackfillRange = vi.fn();
const probeMailbox = vi.fn();

vi.mock('../src/connectors/m365.connector', () => ({
  M365Connector: class {
    fetchMailbox = fetchMailbox;
    fetchBackfillRange = fetchBackfillRange;
    probeMailbox = probeMailbox;
  },
}));

const bufferAdd = vi.fn();
const bufferFlush = vi.fn();

vi.mock('../src/jobs/message-buffer', () => ({
  MessageBuffer: class {
    add = bufferAdd;
    flush = bufferFlush;
    getStats = (): { accepted: number; skipped: number; errors: number } => ({
      accepted: 2,
      skipped: 0,
      errors: 0,
    });
  },
}));

import { processJob } from '../src/jobs/processor';

function msg(id: string): RawMessage {
  return {
    providerMessageId: id,
    fromAddress: 'a@x.com',
    toAddresses: [],
    ccAddresses: [],
    bccAddresses: [],
    hasAttachments: false,
    receivedAt: '2026-07-06T10:00:00Z',
  };
}

/** Builds a MessageStream that yields the given pages then returns the summary. */
function stream(pages: RawMessage[][], summary: FetchSummary = {}): MessageStream {
  return (async function* (): MessageStream {
    for (const page of pages) yield page;
    return summary;
  })();
}

/** Builds a MessageStream whose first next() rejects with the given error. */
function failingStream(error: unknown): MessageStream {
  return (async function* (): MessageStream {
    yield* [] as RawMessage[][];
    throw error;
  })();
}

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: 'j1',
    orgId: 'org1',
    mailboxId: 'mb1',
    jobType: JobType.NewMailCheck,
    address: 'user@corp.com',
    provider: 'm365',
    providerUserId: 'puid',
    syncToken: 'delta-1',
    syncFromDate: null,
    backfilledFromAt: null,
    ...overrides,
  };
}

const M365_CREDS = { provider: 'm365', tenantId: 't', clientId: 'c', clientSecret: 's' };

beforeEach(() => {
  vi.clearAllMocks();
  getJobToken.mockResolvedValue(M365_CREDS);
  updateJob.mockResolvedValue(undefined);
  bufferAdd.mockResolvedValue(undefined);
  bufferFlush.mockResolvedValue(undefined);
});

describe('processJob — sync (streaming)', () => {
  it('marks running, drains all pages into the buffer, and reports done with stats and sync token', async () => {
    fetchMailbox.mockReturnValue(
      stream([[msg('m1'), msg('m2')], [msg('m3')]], { nextSyncToken: 'delta-2' }),
    );

    const ok = await processJob(job());

    expect(ok).toBe(true);
    expect(updateJob).toHaveBeenNthCalledWith(1, 'j1', 'running');
    expect(bufferAdd).toHaveBeenCalledTimes(3);
    expect(bufferFlush).toHaveBeenCalledWith('delta-2');
    expect(updateJob).toHaveBeenLastCalledWith(
      'j1',
      'done',
      { fetched: 3, accepted: 2, skipped: 0, errors: 0 },
      undefined,
      'delta-2',
    );
  });

  it('feeds each page into the buffer BEFORE requesting the next page (flat memory)', async () => {
    const order: string[] = [];
    fetchMailbox.mockReturnValue(
      (async function* (): MessageStream {
        order.push('page-1-fetched');
        yield [msg('m1')];
        order.push('page-2-fetched');
        yield [msg('m2')];
        return { nextSyncToken: 'tok' };
      })(),
    );
    bufferAdd.mockImplementation(async (m: RawMessage) => {
      order.push(`buffered-${m.providerMessageId}`);
    });

    await processJob(job());

    // The whole point of streaming: page 2 is not fetched until page 1 is buffered.
    expect(order).toEqual(['page-1-fetched', 'buffered-m1', 'page-2-fetched', 'buffered-m2']);
  });

  it('falls back to a full backfill when the Gmail history cursor has expired', async () => {
    const expired = Object.assign(new Error('history gone'), { code: 'GMAIL_HISTORY_EXPIRED' });
    fetchMailbox
      .mockReturnValueOnce(failingStream(expired))
      .mockReturnValueOnce(stream([], { nextSyncToken: 'fresh' }));

    const ok = await processJob(job());

    expect(ok).toBe(true);
    // Second attempt must drop the stale cursor
    expect(fetchMailbox).toHaveBeenCalledTimes(2);
    expect(fetchMailbox.mock.calls[1]![0]).toMatchObject({ syncToken: undefined });
    expect(updateJob).toHaveBeenLastCalledWith('j1', 'done', expect.anything(), undefined, 'fresh');
  });

  it('reports failed (retryable) when the connector stream throws', async () => {
    fetchMailbox.mockReturnValue(failingStream(new Error('Graph delta failed (500)')));

    const ok = await processJob(job());

    expect(ok).toBe(false);
    expect(updateJob).toHaveBeenLastCalledWith(
      'j1',
      'failed',
      undefined,
      'Graph delta failed (500)',
    );
  });

  it('reports dead (permanent) when credentials are unavailable on the server', async () => {
    getJobToken.mockRejectedValue(
      new ApiError(503, 'credentials_incomplete', 'M365 credentials incomplete'),
    );

    const ok = await processJob(job());

    expect(ok).toBe(false);
    expect(updateJob).toHaveBeenLastCalledWith(
      'j1',
      'dead',
      undefined,
      expect.stringContaining('credentials'),
    );
  });

  it('reports dead when the job was cancelled while in flight (409)', async () => {
    getJobToken.mockRejectedValue(
      new ApiError(409, 'conflict', 'Job is not in claimed/running state'),
    );

    expect(await processJob(job())).toBe(false);
    expect(updateJob).toHaveBeenLastCalledWith('j1', 'dead', undefined, expect.any(String));
  });

  it('never throws even when the failure report itself fails', async () => {
    fetchMailbox.mockReturnValue(failingStream(new Error('boom')));
    updateJob.mockRejectedValue(new Error('server unreachable'));

    await expect(processJob(job())).resolves.toBe(false);
  });

  it('heartbeats "running" while a long stream is in flight, and stops after', async () => {
    vi.useFakeTimers();
    try {
      let releasePage!: () => void;
      const gate = new Promise<void>((resolve) => {
        releasePage = resolve;
      });
      fetchMailbox.mockReturnValue(
        (async function* (): MessageStream {
          await gate; // simulate a slow provider
          yield [msg('m1')];
          return { nextSyncToken: 'tok' };
        })(),
      );

      const inFlight = processJob(job());

      // 10-15 min job: after 5 min, initial 'running' + 2 heartbeats (at 2 & 4 min)
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      const runningCalls = (): number =>
        updateJob.mock.calls.filter((c) => c[1] === 'running').length;
      expect(runningCalls()).toBe(3);

      releasePage();
      await inFlight;
      expect(updateJob).toHaveBeenLastCalledWith('j1', 'done', expect.anything(), undefined, 'tok');

      // Heartbeat must be cleared once the job is finished
      const after = runningCalls();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(runningCalls()).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('processJob — probe', () => {
  it('reports done with the probe result and zeroed stats', async () => {
    probeMailbox.mockResolvedValue({
      earliestEmailAt: '2020-01-01T00:00:00Z',
      emailCountEstimate: 1234,
    });

    const ok = await processJob(job({ jobType: JobType.MailboxScan }));

    expect(ok).toBe(true);
    expect(updateJob).toHaveBeenLastCalledWith(
      'j1',
      'done',
      { fetched: 0, accepted: 0, skipped: 0, errors: 0 },
      undefined,
      undefined,
      { earliestEmailAt: '2020-01-01T00:00:00Z', emailCountEstimate: 1234 },
    );
  });
});

describe('processJob — sync range extension', () => {
  it('streams the gap range and completes without touching the sync cursor', async () => {
    fetchBackfillRange.mockReturnValue(stream([[msg('old1')]], {}));

    const ok = await processJob(
      job({
        jobType: JobType.SyncRangeExtension,
        syncFromDate: '2024-01-01T00:00:00Z',
        backfilledFromAt: '2025-01-01T00:00:00Z',
      }),
    );

    expect(ok).toBe(true);
    expect(fetchBackfillRange).toHaveBeenCalledWith(
      expect.anything(),
      '2024-01-01T00:00:00Z',
      '2025-01-01T00:00:00Z',
    );
    // flush(undefined) — the forward/incremental cursor must not move
    expect(bufferFlush).toHaveBeenCalledWith(undefined);
    expect(updateJob).toHaveBeenLastCalledWith('j1', 'done', {
      fetched: 1,
      accepted: 2,
      skipped: 0,
      errors: 0,
    });
  });

  it('completes as a no-op when no target date is set', async () => {
    const ok = await processJob(job({ jobType: JobType.SyncRangeExtension, syncFromDate: null }));

    expect(ok).toBe(true);
    expect(fetchBackfillRange).not.toHaveBeenCalled();
    expect(updateJob).toHaveBeenLastCalledWith('j1', 'done', {
      fetched: 0,
      accepted: 0,
      skipped: 0,
      errors: 0,
    });
  });
});
