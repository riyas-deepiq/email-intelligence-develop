import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  claimJobs,
  getJobToken,
  getSyncSchedule,
  updateJob,
} from '../src/clients/core-server.client';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(data: unknown): Response {
  return { ok: true, json: async () => ({ data }) } as unknown as Response;
}

function errorJson(status: number, code: string): Response {
  const body = JSON.stringify({ error: { code, message: 'nope' } });
  return { ok: false, status, text: async () => body } as unknown as Response;
}

describe('api-client', () => {
  it('claims jobs with limit, instance id, and the collector bearer secret', async () => {
    fetchMock.mockResolvedValue(okJson([{ jobId: 'j1' }]));

    const jobs = await claimJobs(5, 'host:42');

    expect(jobs).toEqual([{ jobId: 'j1' }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/v1/internal/jobs/claim?limit=5&instance=host%3A42');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer test-collector-secret',
    });
  });

  it('unwraps the data envelope on token fetch', async () => {
    fetchMock.mockResolvedValue(
      okJson({ provider: 'm365', tenantId: 't', clientId: 'c', clientSecret: 's' }),
    );
    const token = await getJobToken('j1');
    expect(token).toMatchObject({ provider: 'm365', clientSecret: 's' });
  });

  it('PATCHes job updates with status, stats, and sync token', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));

    await updateJob('j1', 'done', { fetched: 10, accepted: 9, skipped: 1 }, undefined, 'tok-1');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/v1/internal/jobs/j1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      status: 'done',
      stats: { fetched: 10, accepted: 9, skipped: 1 },
      nextSyncToken: 'tok-1',
    });
  });

  it('throws a typed ApiError with status and server error code on failure', async () => {
    fetchMock.mockResolvedValue(errorJson(503, 'provider_unavailable'));

    const err = await getSyncSchedule().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).code).toBe('provider_unavailable');
  });

  it('falls back to a generic code when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'Bad Gateway',
    } as unknown as Response);

    const err = await claimJobs(1, 'host:1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('server_error');
  });
});
