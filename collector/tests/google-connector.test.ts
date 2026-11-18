import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailboxRef, RawMessage } from '../src/connectors/connector.types';

const googleMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  messagesList: vi.fn(),
  messagesGet: vi.fn(),
  historyList: vi.fn(),
  jwt: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { JWT: googleMocks.jwt },
    gmail: vi.fn(() => ({
      users: {
        getProfile: googleMocks.getProfile,
        messages: { list: googleMocks.messagesList, get: googleMocks.messagesGet },
        history: { list: googleMocks.historyList },
      },
    })),
  },
}));

import { GoogleConnector } from '../src/connectors/google.connector';

const serviceAccountJson = JSON.stringify({
  client_email: 'collector@project.iam.gserviceaccount.com',
  private_key: 'private-key',
});

function mailbox(overrides: Partial<MailboxRef> = {}): MailboxRef {
  return {
    id: 'mb-1',
    orgId: 'org-1',
    address: 'owner@example.test',
    provider: 'google',
    ...overrides,
  };
}

async function drain(
  stream: AsyncGenerator<RawMessage[], { nextSyncToken?: string }>,
): Promise<{ messages: RawMessage[]; token?: string }> {
  const messages: RawMessage[] = [];
  let result = await stream.next();
  while (!result.done) {
    messages.push(...result.value);
    result = await stream.next();
  }
  return { messages, token: result.value.nextSyncToken };
}

beforeEach(() => {
  vi.clearAllMocks();
  googleMocks.getProfile.mockResolvedValue({ data: { historyId: 'H-NEW' } });
  googleMocks.messagesList.mockResolvedValue({ data: { messages: [{ id: 'm-1' }] } });
  googleMocks.historyList.mockResolvedValue({ data: { history: [] } });
});

describe('GoogleConnector', () => {
  it('imports HTML-only bodies, nested attachments, and quoted address names', async () => {
    googleMocks.messagesGet.mockResolvedValue({
      data: {
        id: 'm-1',
        threadId: 't-1',
        internalDate: '1782900000000',
        labelIds: ['INBOX', 'UNREAD', 'PROJECT'],
        payload: {
          mimeType: 'multipart/mixed',
          headers: [
            { name: 'From', value: '"Smith, John" <john@example.test>' },
            { name: 'To', value: 'Owner <owner@example.test>, second@example.test' },
            { name: 'Subject', value: 'Connector test' },
            { name: 'Date', value: 'Wed, 1 Jul 2026 10:00:00 +0000' },
          ],
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                {
                  mimeType: 'text/html',
                  body: { data: Buffer.from('<p>Hello &amp; welcome</p>').toString('base64url') },
                },
              ],
            },
            {
              mimeType: 'application/pdf',
              filename: 'report.pdf',
              body: { attachmentId: 'att-1' },
            },
          ],
        },
      },
    });

    const result = await drain(
      new GoogleConnector({ serviceAccountJson }).fetchMailbox(
        mailbox({ syncFromDate: '2026-07-01T00:00:00Z' }),
      ),
    );

    expect(result.token).toBe('H-NEW');
    expect(result.messages[0]).toMatchObject({
      bodyText: 'Hello & welcome',
      fromAddress: 'john@example.test',
      fromName: 'Smith, John',
      hasAttachments: true,
      labels: ['PROJECT'],
    });
    expect(googleMocks.messagesList).toHaveBeenCalledWith(
      expect.objectContaining({
        q: `after:${Math.floor(Date.parse('2026-07-01T00:00:00Z') / 1000)}`,
      }),
    );
  });

  it('deduplicates message IDs repeated across Gmail history records', async () => {
    googleMocks.historyList.mockResolvedValue({
      data: {
        history: [
          { messagesAdded: [{ message: { id: 'm-1' } }] },
          { messagesAdded: [{ message: { id: 'm-1' } }] },
        ],
      },
    });
    googleMocks.messagesGet.mockResolvedValue({
      data: {
        id: 'm-1',
        internalDate: '1782900000000',
        payload: {
          headers: [{ name: 'From', value: 'sender@example.test' }],
        },
      },
    });

    const result = await drain(
      new GoogleConnector({ serviceAccountJson }).fetchMailbox(mailbox({ syncToken: 'H-OLD' })),
    );

    expect(result.messages).toHaveLength(1);
    expect(googleMocks.messagesGet).toHaveBeenCalledTimes(1);
  });

  it('signals a full resync when the Gmail history cursor has expired', async () => {
    googleMocks.historyList.mockRejectedValue({ response: { status: 404 } });

    await expect(
      drain(
        new GoogleConnector({ serviceAccountJson }).fetchMailbox(
          mailbox({ syncToken: 'H-EXPIRED' }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'GMAIL_HISTORY_EXPIRED' });
  });
});
