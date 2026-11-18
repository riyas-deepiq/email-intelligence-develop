import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { M365Connector } from '../src/connectors/m365.connector';
import type { MailboxRef, RawMessage } from '../src/connectors/connector.types';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Each connector instance gets unique creds so the module-level token cache
// never leaks a token between tests.
let credCounter = 0;
function connector(): M365Connector {
  credCounter++;
  return new M365Connector({
    tenantId: `t${credCounter}`,
    clientId: `c${credCounter}`,
    clientSecret: 's',
  });
}

function mailbox(overrides: Partial<MailboxRef> = {}): MailboxRef {
  return {
    id: 'mb1',
    orgId: 'org1',
    address: 'sarah@acme.com',
    provider: 'm365',
    providerUserId: 'puid-1',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const TOKEN_RESPONSE = jsonResponse({ access_token: 'tok-123', expires_in: 3600 });

function graphMessage(id: string): Record<string, unknown> {
  return {
    id,
    conversationId: `conv-${id}`,
    subject: `Subject ${id}`,
    from: { emailAddress: { address: 'peer@acme.com', name: 'Peer' } },
    toRecipients: [{ emailAddress: { address: 'sarah@acme.com' } }],
    receivedDateTime: '2026-07-01T10:00:00Z',
    hasAttachments: false,
    isRead: true,
  };
}

/** Routes mocked fetch calls by URL substring, in registration order for repeats. */
function routeFetch(routes: Array<{ match: string; response: Response }>): void {
  fetchMock.mockImplementation(async (url: string | URL) => {
    const u = String(url);
    const idx = routes.findIndex((r) => u.includes(r.match));
    if (idx === -1) throw new Error(`Unmatched fetch in test: ${u}`);
    const [route] = routes.splice(idx, 1);
    return route!.response;
  });
}

async function drain(
  stream: AsyncGenerator<RawMessage[], { nextSyncToken?: string }>,
): Promise<{ pages: RawMessage[][]; token?: string }> {
  const pages: RawMessage[][] = [];
  let result = await stream.next();
  while (!result.done) {
    pages.push(result.value);
    result = await stream.next();
  }
  return { pages, token: result.value.nextSyncToken };
}

describe('M365Connector — streaming backfill', () => {
  it('yields each Graph page as it arrives and returns the delta cursor at the end', async () => {
    routeFetch([
      { match: 'oauth2/v2.0/token', response: TOKEN_RESPONSE },
      // Delta round (captured BEFORE messages): one page, immediate deltaLink
      {
        match: '/messages/delta',
        response: jsonResponse({ value: [], '@odata.deltaLink': 'https://graph/delta?token=D1' }),
      },
      // Message pages: 2 then 1, linked by nextLink
      {
        match: '/messages?',
        response: jsonResponse({
          value: [graphMessage('m1'), graphMessage('m2')],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users/puid-1/messages?page=2',
        }),
      },
      { match: 'page=2', response: jsonResponse({ value: [graphMessage('m3')] }) },
    ]);

    const { pages, token } = await drain(connector().fetchMailbox(mailbox()));

    expect(pages.map((p) => p.map((m) => m.providerMessageId))).toEqual([['m1', 'm2'], ['m3']]);
    expect(token).toBe('https://graph/delta?token=D1');
  });

  it('waits out a 429 with Retry-After and resumes the same page', async () => {
    routeFetch([
      { match: 'oauth2/v2.0/token', response: TOKEN_RESPONSE },
      { match: '/messages/delta', response: jsonResponse({ value: [], '@odata.deltaLink': 'D1' }) },
      // First attempt at the page: throttled with Retry-After: 0 (keeps the test fast)
      {
        match: '/messages?',
        response: jsonResponse({ error: { code: 'TooManyRequests' } }, 429, { 'retry-after': '0' }),
      },
      // Retry of the same page succeeds
      { match: '/messages?', response: jsonResponse({ value: [graphMessage('m1')] }) },
    ]);

    const { pages } = await drain(connector().fetchMailbox(mailbox()));

    expect(pages).toHaveLength(1);
    expect(pages[0]![0]!.providerMessageId).toBe('m1');
    // token + delta + throttled page + retried page = 4 calls
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('throws (job fails, server re-queues) on a non-retryable Graph error', async () => {
    routeFetch([
      { match: 'oauth2/v2.0/token', response: TOKEN_RESPONSE },
      { match: '/messages/delta', response: jsonResponse({ value: [], '@odata.deltaLink': 'D1' }) },
      {
        match: '/messages?',
        response: jsonResponse({ error: { code: 'ErrorItemNotFound' } }, 404),
      },
    ]);

    await expect(drain(connector().fetchMailbox(mailbox()))).rejects.toThrow('(404)');
  });
});

describe('M365Connector — streaming incremental', () => {
  it('follows the saved deltaLink and returns the fresh cursor', async () => {
    routeFetch([
      { match: 'oauth2/v2.0/token', response: TOKEN_RESPONSE },
      {
        match: 'delta?token=OLD',
        response: jsonResponse({
          value: [graphMessage('new1')],
          '@odata.deltaLink': 'https://graph/delta?token=NEW',
        }),
      },
    ]);

    const { pages, token } = await drain(
      connector().fetchMailbox(mailbox({ syncToken: 'https://graph/delta?token=OLD' })),
    );

    expect(pages.map((p) => p.map((m) => m.providerMessageId))).toEqual([['new1']]);
    expect(token).toBe('https://graph/delta?token=NEW');
  });
});

describe('M365Connector — fetchBackfillRange', () => {
  it('streams the gap range and never returns a sync cursor', async () => {
    routeFetch([
      { match: 'oauth2/v2.0/token', response: TOKEN_RESPONSE },
      { match: '/messages?', response: jsonResponse({ value: [graphMessage('old1')] }) },
    ]);

    const { pages, token } = await drain(
      connector().fetchBackfillRange(mailbox(), '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z'),
    );

    expect(pages[0]![0]!.providerMessageId).toBe('old1');
    expect(token).toBeUndefined();

    // The range filter must be on the request
    const messagesCall = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes('%24filter'));
    expect(messagesCall).toContain('2024-01-01');
  });
});
