import { afterEach, describe, expect, it, vi } from 'vitest';
import { triggerRagIngest } from '../../../../../src/modules/chat/clients/rag.client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('triggerRagIngest', () => {
  it('queues the single combined Postgres workflow', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ job_id: 42 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await triggerRagIngest({ fullResync: true, maxWorkers: 3 });

    expect(result).toEqual({ jobId: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/ingest\/postgres$/);
    expect(url).not.toContain('/ingest/attachments');
    expect(JSON.parse(String(init.body))).toMatchObject({
      full_resync: true,
      max_workers: 3,
    });
  });
});
