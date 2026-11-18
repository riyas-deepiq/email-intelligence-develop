import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBuffer } from '../src/jobs/message-buffer';
import type { RawMessage } from '../src/connectors/connector.types';

// tests/setup.ts pins FLUSH_MAX_MESSAGES=3, FLUSH_MAX_SIZE_MB=1, FLUSH_MAX_AGE_MS=60000

function msg(id: string, bodyText = 'hello'): RawMessage {
  return {
    providerMessageId: id,
    fromAddress: 'a@example.com',
    toAddresses: [],
    ccAddresses: [],
    bccAddresses: [],
    bodyText,
    hasAttachments: false,
    receivedAt: '2026-07-06T10:00:00Z',
    importance: 'normal',
    isRead: false,
    labels: [],
  };
}

function okResponse(accepted: number, skipped = 0): Response {
  return {
    ok: true,
    json: async () => ({ data: { accepted, skipped } }),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Parsed JSON bodies of every batch POSTed so far. */
function postedBatches(): Array<{ messages: RawMessage[]; nextSyncToken?: string }> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe('MessageBuffer', () => {
  it('buffers below the threshold and posts everything on final flush', async () => {
    fetchMock.mockResolvedValue(okResponse(2));
    const buffer = new MessageBuffer('job-1', 'org-1', 'mb-1');

    await buffer.add(msg('m1'));
    await buffer.add(msg('m2'));
    expect(fetchMock).not.toHaveBeenCalled();

    await buffer.flush('token-abc');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [batch] = postedBatches();
    expect(batch!.messages.map((m) => m.providerMessageId)).toEqual(['m1', 'm2']);
    expect(batch!.nextSyncToken).toBe('token-abc');
  });

  it('auto-flushes when the message-count threshold is reached', async () => {
    fetchMock.mockResolvedValue(okResponse(3));
    const buffer = new MessageBuffer('job-1', 'org-1', 'mb-1');

    await buffer.add(msg('m1'));
    await buffer.add(msg('m2'));
    expect(fetchMock).not.toHaveBeenCalled();
    await buffer.add(msg('m3')); // hits FLUSH_MAX_MESSAGES=3

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Mid-run auto-flush must NOT carry the sync token
    expect(postedBatches()[0]!.nextSyncToken).toBeUndefined();
  });

  it('auto-flushes when the byte-size threshold is reached before the count', async () => {
    fetchMock.mockResolvedValue(okResponse(1));
    const buffer = new MessageBuffer('job-1', 'org-1', 'mb-1');

    await buffer.add(msg('big', 'x'.repeat(1024 * 1024 + 1))); // > FLUSH_MAX_SIZE_MB=1
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the sync token only with the last chunk of a multi-chunk flush', async () => {
    fetchMock.mockResolvedValue(okResponse(1));
    const buffer = new MessageBuffer('job-1', 'org-1', 'mb-1');

    // Two auto-flushes at 3 and 3, one message left over for the final flush
    for (let i = 1; i <= 7; i++) await buffer.add(msg(`m${i}`));
    await buffer.flush('token-final');

    const batches = postedBatches();
    expect(batches.map((b) => b.messages.length)).toEqual([3, 3, 1]);
    expect(batches.map((b) => b.nextSyncToken)).toEqual([undefined, undefined, 'token-final']);
  });

  it('accumulates accepted/skipped stats across flushes', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(2, 1)).mockResolvedValueOnce(okResponse(1, 0));
    const buffer = new MessageBuffer('job-1', 'org-1', 'mb-1');

    for (let i = 1; i <= 3; i++) await buffer.add(msg(`m${i}`)); // auto-flush #1
    await buffer.add(msg('m4'));
    await buffer.flush(); // flush #2

    expect(buffer.getStats()).toEqual({ accepted: 3, skipped: 1, errors: 0 });
  });

  it('throws and counts an error when the server rejects a batch', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as unknown as Response);
    const buffer = new MessageBuffer('job-1', 'org-1', 'mb-1');

    await buffer.add(msg('m1'));
    await expect(buffer.flush()).rejects.toThrow('ingest/batch 500');
    expect(buffer.getStats().errors).toBe(1);
  });

  it('does nothing on final flush when the buffer is empty', async () => {
    const buffer = new MessageBuffer('job-1', 'org-1', 'mb-1');
    await buffer.flush('token');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
