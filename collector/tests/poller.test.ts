import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Poller, type PollerDeps } from '../src/jobs/poller';
import type { HealthState } from '../src/app';
import type { ClaimedJob } from '../src/clients/core-server.client';
import { JobType } from '../src/jobs/job-type';

const POLL_MS = 30_000;

function healthState(): HealthState {
  return {
    instance: 'test:1',
    activeWorkers: 0,
    lastPollAt: null,
    lastPollOk: null,
    lastPollError: null,
    jobsSucceeded: 0,
    jobsFailed: 0,
  };
}

function makeDeps(overrides: Partial<PollerDeps> = {}): PollerDeps {
  return {
    claimJobs: vi.fn().mockResolvedValue([]),
    getSyncSchedule: vi.fn().mockRejectedValue(new Error('no schedule')),
    processJob: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function job(id: string): ClaimedJob {
  return {
    jobId: id,
    orgId: 'o',
    mailboxId: 'm',
    jobType: JobType.NewMailCheck,
    address: 'a@x.com',
    provider: 'm365',
    providerUserId: null,
    syncToken: null,
    syncFromDate: null,
    backfilledFromAt: null,
  };
}

function makePoller(
  deps: PollerDeps,
  health = healthState(),
): { poller: Poller; health: HealthState } {
  const poller = new Poller('test:1', health, deps, {
    pollIntervalMs: POLL_MS,
    workerConcurrency: 2,
  });
  return { poller, health };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Poller — survivability', () => {
  it('keeps polling forever while the server is unreachable (never crashes, never stops)', async () => {
    const deps = makeDeps({
      claimJobs: vi.fn().mockRejectedValue(new Error('fetch failed: ECONNREFUSED')),
    });
    const { poller, health } = makePoller(deps);

    void poller.start();

    // Simulate 10 poll intervals (5 minutes) with the server down the whole time
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    }

    expect(deps.claimJobs).toHaveBeenCalledTimes(11); // immediate first poll + 10 retries
    expect(health.lastPollOk).toBe(false);
    expect(health.lastPollError).toContain('ECONNREFUSED');

    poller.stop();
  });

  it('recovers automatically when the server comes back', async () => {
    const claimJobs = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED')) // server not up yet
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue([]); // server is up now
    const deps = makeDeps({ claimJobs });
    const { poller, health } = makePoller(deps);

    void poller.start();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(health.lastPollOk).toBe(true);
    expect(health.lastPollError).toBeNull();

    poller.stop();
  });

  it('survives even an unexpected bug in a poll iteration', async () => {
    // getSyncSchedule succeeding with garbage that breaks nextPollDelayMs would
    // surface as a thrown error inside the iteration — the loop must continue.
    const claimJobs = vi.fn().mockResolvedValue([]);
    const getSyncSchedule = vi.fn().mockImplementation(() => {
      throw new TypeError('something unexpected');
    });
    const deps = makeDeps({ claimJobs, getSyncSchedule });
    const { poller } = makePoller(deps);

    void poller.start();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(claimJobs.mock.calls.length).toBeGreaterThanOrEqual(3);

    poller.stop();
  });

  it('stops polling after stop() and not before', async () => {
    const deps = makeDeps();
    const { poller } = makePoller(deps);

    void poller.start();
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    const callsBeforeStop = (deps.claimJobs as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsBeforeStop).toBeGreaterThanOrEqual(2);

    poller.stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect((deps.claimJobs as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeStop);
  });
});

describe('Poller — job dispatch', () => {
  it('dispatches claimed jobs concurrently and tracks worker/outcome counters', async () => {
    const claimJobs = vi
      .fn()
      .mockResolvedValueOnce([job('j1'), job('j2')])
      .mockResolvedValue([]);
    const processJob = vi
      .fn()
      .mockResolvedValueOnce(true) // j1 succeeds
      .mockResolvedValueOnce(false); // j2 fails
    const deps = makeDeps({ claimJobs, processJob });
    const { poller, health } = makePoller(deps);

    void poller.start();
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(processJob).toHaveBeenCalledTimes(2);
    expect(health.jobsSucceeded).toBe(1);
    expect(health.jobsFailed).toBe(1);
    expect(health.activeWorkers).toBe(0); // both finished

    poller.stop();
  });

  it('never claims more jobs than free worker slots, and skips polling when full', async () => {
    let releaseJobs!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseJobs = resolve;
    });

    const claimJobs = vi
      .fn()
      .mockResolvedValueOnce([job('j1'), job('j2')]) // fills both slots (concurrency=2)
      .mockResolvedValue([]);
    const processJob = vi.fn().mockImplementation(() => gate.then(() => true));
    const deps = makeDeps({ claimJobs, processJob });
    const { poller, health } = makePoller(deps);

    void poller.start();
    await vi.advanceTimersByTimeAsync(POLL_MS); // first poll: claims 2, both running

    expect(health.activeWorkers).toBe(2);
    const callsWhileFull = claimJobs.mock.calls.length;

    await vi.advanceTimersByTimeAsync(POLL_MS * 3); // pool full → polls are skipped
    expect(claimJobs.mock.calls.length).toBe(callsWhileFull);

    releaseJobs();
    await vi.advanceTimersByTimeAsync(POLL_MS); // slots free again → polling resumes
    expect(claimJobs.mock.calls.length).toBeGreaterThan(callsWhileFull);
    expect(health.activeWorkers).toBe(0);

    poller.stop();
  });

  it('requests only as many jobs as there are free slots', async () => {
    const claimJobs = vi.fn().mockResolvedValue([]);
    const deps = makeDeps({ claimJobs });
    const { poller } = makePoller(deps); // concurrency = 2

    void poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(claimJobs).toHaveBeenCalledWith(2, 'test:1');

    poller.stop();
  });
});
