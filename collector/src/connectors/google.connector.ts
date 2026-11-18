import { gmail_v1, google } from 'googleapis';
import { logger } from '../observability/logger';
import type { MailConnector } from './connector';
import type {
  EmailAddress,
  MailboxRef,
  MessagePageStream,
  MessageStream,
  ProbeResult,
  RawMessage,
} from './connector.types';

// ── Auth helper ───────────────────────────────────────────────────────────────

function buildGmailClient(serviceAccountJson: string, userEmail: string): gmail_v1.Gmail {
  const key = JSON.parse(serviceAccountJson) as Record<string, string>;
  const auth = new google.auth.JWT({
    email: key['client_email'],
    key: key['private_key'],
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    subject: userEmail, // domain-wide delegation
  });
  return google.gmail({ version: 'v1', auth });
}

// ── Throttle-aware call wrapper ───────────────────────────────────────────────
// Gmail signals throttling with 429 (and per-user rate limits as 403 with a
// rate-limit reason). Like Graph, a throttle is a "wait", never a job failure.

const GMAIL_MAX_ATTEMPTS = 5;
const RETRY_WAIT_CAP_MS = 5 * 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface GaxiosLikeError {
  message?: string;
  response?: { status?: number; headers?: Record<string, string> };
}

async function withGmailRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as GaxiosLikeError;
      const status = e.response?.status;
      const rateLimited403 = status === 403 && /rate ?limit/i.test(e.message ?? '');
      const retryable = status === 429 || status === 500 || status === 503 || rateLimited403;

      if (!retryable || attempt >= GMAIL_MAX_ATTEMPTS) throw err;

      const retryAfterSec = Number(e.response?.headers?.['retry-after']);
      const waitMs = Math.min(
        Number.isFinite(retryAfterSec) && retryAfterSec >= 0
          ? retryAfterSec * 1000
          : Math.min(2 ** attempt * 1000, 60_000),
        RETRY_WAIT_CAP_MS,
      );
      logger.warn({ context, status, attempt, waitMs }, 'gmail throttled — waiting before retry');
      await sleep(waitMs);
    }
  }
}

// ── Address parsing ───────────────────────────────────────────────────────────

function parseHeader(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function splitAddressList(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  let angleDepth = 0;

  for (const char of raw) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '<') angleDepth++;
    if (!quoted && char === '>' && angleDepth > 0) angleDepth--;
    if (char === ',' && !quoted && angleDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseAddressHeader(raw: string): EmailAddress[] {
  if (!raw) return [];
  return splitAddressList(raw)
    .map((part) => {
      const match = part.trim().match(/^(.*?)\s*<([^>]+)>$/);
      if (match) {
        const name = match[1].trim().replace(/^"|"$/g, '').replace(/\\"/g, '"');
        return { name: name || undefined, email: match[2].trim() };
      }
      return { email: part.trim() };
    })
    .filter((a) => a.email);
}

function findMimeBody(
  payload: gmail_v1.Schema$MessagePart | undefined,
  mimeType: 'text/plain' | 'text/html',
): string | undefined {
  if (!payload) return undefined;
  if (payload.mimeType?.toLowerCase() === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }
  for (const part of payload.parts ?? []) {
    const body = findMimeBody(part, mimeType);
    if (body) return body;
  }
  return undefined;
}

function htmlToText(html: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
      const normalized = entity.toLowerCase();
      if (normalized.startsWith('#x')) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
      }
      if (normalized.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
      }
      return entities[normalized] ?? `&${entity};`;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  const plain = findMimeBody(payload, 'text/plain');
  if (plain) return plain;
  const html = findMimeBody(payload, 'text/html');
  return html ? htmlToText(html) : '';
}

function hasAttachment(payload: gmail_v1.Schema$MessagePart | undefined): boolean {
  if (!payload) return false;
  if (!!payload.filename && !!payload.body?.attachmentId) return true;
  return (payload.parts ?? []).some(hasAttachment);
}

function gmailDateQuery(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid Gmail sync date: ${value}`);
  return String(Math.floor(timestamp / 1000));
}

function optionalIsoDate(value: string): string | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

// ── GoogleConnector ───────────────────────────────────────────────────────────

interface GoogleCredentials {
  serviceAccountJson: string; // decrypted JSON string
}

export class GoogleConnector implements MailConnector {
  readonly provider = 'google' as const;

  constructor(private readonly creds: GoogleCredentials) {}

  async *fetchMailbox(mailbox: MailboxRef): MessageStream {
    const gmail = buildGmailClient(this.creds.serviceAccountJson, mailbox.address);

    // Capture historyId BEFORE fetching messages so we don't miss messages
    // that arrive during the sync window. Only surfaced when the stream fully
    // drains — a crash mid-backfill never persists a cursor for partial data.
    const profileRes = await withGmailRetry(
      () => gmail.users.getProfile({ userId: 'me' }),
      `gmail getProfile ${mailbox.address}`,
    );
    const nextSyncToken = profileRes.data.historyId ?? undefined;

    if (mailbox.syncToken) {
      // Incremental: use Gmail history API.
      yield* this.streamViaHistory(gmail, mailbox);
    } else {
      // Backfill: list all messages (optionally date-bounded).
      const query = mailbox.syncFromDate
        ? `after:${gmailDateQuery(mailbox.syncFromDate)}`
        : undefined;
      yield* this.streamByQuery(gmail, mailbox.address, query);
    }

    logger.debug({ mailbox: mailbox.address }, 'google fetch stream complete');
    return { nextSyncToken };
  }

  async *fetchBackfillRange(mailbox: MailboxRef, from: string, to: string): MessageStream {
    const gmail = buildGmailClient(this.creds.serviceAccountJson, mailbox.address);
    const query = `after:${gmailDateQuery(from)} before:${gmailDateQuery(to)}`;

    yield* this.streamByQuery(gmail, mailbox.address, query);

    // Gap-fill only — never advance the forward/incremental cursor (historyId).
    logger.debug({ mailbox: mailbox.address, from, to }, 'google backfill_extend stream complete');
    return {};
  }

  async probeMailbox(mailbox: MailboxRef): Promise<ProbeResult> {
    const gmail = buildGmailClient(this.creds.serviceAccountJson, mailbox.address);

    // Gmail messages.list returns newest-first by default — there is no orderBy
    // support. We use the profile messagesTotal for the count estimate and skip
    // the "earliest" date since Gmail cannot return the oldest message cheaply.
    const profile = await withGmailRetry(
      () => gmail.users.getProfile({ userId: 'me' }),
      `gmail probe ${mailbox.address}`,
    );
    const emailCountEstimate = profile.data.messagesTotal ?? undefined;

    return { emailCountEstimate };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Streams full message details for a Gmail search query — one yielded page
   * per messages.list page (≤100 messages), details fetched in sub-batches of
   * 10 to respect Gmail per-user quota limits.
   */
  private async *streamByQuery(
    gmail: gmail_v1.Gmail,
    address: string,
    query: string | undefined,
  ): MessagePageStream {
    let pageToken: string | undefined;

    do {
      const listRes = await withGmailRetry(
        () =>
          gmail.users.messages.list({
            userId: 'me',
            maxResults: 100,
            pageToken,
            q: query,
            includeSpamTrash: false,
          }),
        `gmail messages.list ${address}`,
      );

      const ids = listRes.data.messages ?? [];
      const page = await this.fetchDetails(gmail, address, ids.map((m) => m.id!).filter(Boolean));
      if (page.length > 0) yield page;

      pageToken = listRes.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  private async *streamViaHistory(gmail: gmail_v1.Gmail, mailbox: MailboxRef): MessagePageStream {
    let pageToken: string | undefined;

    do {
      let histRes;
      try {
        histRes = await withGmailRetry(
          () =>
            gmail.users.history.list({
              userId: 'me',
              startHistoryId: mailbox.syncToken,
              historyTypes: ['messageAdded'],
              maxResults: 100,
              pageToken,
            }),
          `gmail history.list ${mailbox.address}`,
        );
      } catch (err: unknown) {
        // Gmail returns 404 when the historyId has expired (typically after ~1
        // week of inactivity). Signal the caller to fall back to a full
        // backfill by clearing the sync token and re-running.
        const status = (err as GaxiosLikeError).response?.status;
        if (status === 404) {
          logger.warn(
            { mailbox: mailbox.address },
            'Gmail historyId expired - clearing sync token for full backfill',
          );
          throw Object.assign(new Error('HISTORY_EXPIRED'), { code: 'GMAIL_HISTORY_EXPIRED' });
        }
        throw err;
      }

      const addedIds = [
        ...new Set(
          (histRes.data.history ?? [])
            .flatMap((h) => h.messagesAdded ?? [])
            .map((a) => a.message?.id)
            .filter((id): id is string => !!id),
        ),
      ];

      const page = await this.fetchDetails(gmail, mailbox.address, addedIds);
      if (page.length > 0) yield page;

      pageToken = histRes.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  /** Fetches full details for a list of message ids in quota-friendly sub-batches of 10. */
  private async fetchDetails(
    gmail: gmail_v1.Gmail,
    address: string,
    ids: string[],
  ): Promise<RawMessage[]> {
    const messages: RawMessage[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const details = await Promise.all(
        batch.map((id) =>
          withGmailRetry(
            () => gmail.users.messages.get({ userId: 'me', id, format: 'FULL' }),
            `gmail messages.get ${address}`,
          ),
        ),
      );
      for (const { data } of details) {
        const msg = this.mapMessage(data);
        if (msg) messages.push(msg);
      }
    }
    return messages;
  }

  private mapMessage(data: gmail_v1.Schema$Message): RawMessage | null {
    if (!data.id) return null;
    const headers = data.payload?.headers ?? [];

    // If internalDate is missing, skip the message rather than corrupting receivedAt
    // with the current timestamp (which would permanently misplace it in sort order).
    if (!data.internalDate) {
      logger.debug({ id: data.id }, 'google message missing internalDate - skipped');
      return null;
    }

    // Skip messages with no sender address — they cannot be deduplicated reliably.
    const fromAddress = parseAddressHeader(parseHeader(headers, 'From'))[0]?.email ?? '';
    if (!fromAddress) {
      logger.debug({ id: data.id }, 'google message missing from address - skipped');
      return null;
    }

    return {
      providerMessageId: data.id,
      providerThreadId: data.threadId ?? undefined,
      rfcMessageId: parseHeader(headers, 'Message-ID') || undefined,
      subject: parseHeader(headers, 'Subject') || undefined,
      fromAddress,
      fromName: parseAddressHeader(parseHeader(headers, 'From'))[0]?.name,
      toAddresses: parseAddressHeader(parseHeader(headers, 'To')),
      ccAddresses: parseAddressHeader(parseHeader(headers, 'Cc')),
      bccAddresses: parseAddressHeader(parseHeader(headers, 'Bcc')),
      bodyText: extractBody(data.payload ?? undefined),
      hasAttachments: hasAttachment(data.payload ?? undefined),
      receivedAt: new Date(Number(data.internalDate)).toISOString(),
      sentAt: parseHeader(headers, 'Date')
        ? optionalIsoDate(parseHeader(headers, 'Date'))
        : undefined,
      sizeBytes: data.sizeEstimate ?? undefined,
      importance: 'normal',
      isRead: !(data.labelIds ?? []).includes('UNREAD'),
      labels: (data.labelIds ?? []).filter(
        (l) => !['UNREAD', 'INBOX', 'SENT', 'TRASH', 'SPAM'].includes(l),
      ),
    };
  }
}
