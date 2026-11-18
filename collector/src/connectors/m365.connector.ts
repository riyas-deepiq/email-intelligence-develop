import { logger } from '../observability/logger';
import { classifyM365Error, classifyM365NetworkError } from './sync-error';
import type { MailConnector } from './connector';
import type {
  EmailAddress,
  MailboxRef,
  MessagePageStream,
  MessageStream,
  ProbeResult,
  RawMessage,
} from './connector.types';

// ── Token cache (per tenantId+clientId, reused until within 60s of expiry) ───

interface TokenEntry {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, TokenEntry>();

async function getAccessToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cacheKey = `${tenantId}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  let res: Response;
  try {
    res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw classifyM365NetworkError(err, 'M365 token request');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw classifyM365Error({
      status: res.status,
      body,
      requestId: res.headers.get('request-id'),
      clientRequestId: res.headers.get('client-request-id'),
      retryAfter: res.headers.get('retry-after'),
      context: 'M365 token request',
    });
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const entry: TokenEntry = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  tokenCache.set(cacheKey, entry);
  return entry.token;
}

// ── Throttle-aware Graph fetch ────────────────────────────────────────────────
// Graph enforces per-app-per-mailbox limits (4 concurrent, 10k req / 10 min)
// and signals throttling with 429 + Retry-After. A long backfill WILL meet
// these on big tenants — a throttle is a "wait", never a job failure.

const GRAPH_MAX_ATTEMPTS = 6;
const RETRY_WAIT_CAP_MS = 5 * 60_000; // never sleep longer than 5 min per attempt

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch → JSON with throttle handling: 429/503/504 wait out Retry-After
 * (exponential fallback when absent) and retry; other failures throw.
 * `headersFn` is re-evaluated on every attempt/page so an access token that
 * expires mid-backfill is transparently refreshed from the token cache.
 */
async function graphFetchJson<T>(
  url: string,
  headersFn: () => Promise<Record<string, string>>,
  context: string,
  timeoutMs = 30_000,
): Promise<T> {
  let lastError = '';

  for (let attempt = 1; attempt <= GRAPH_MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: await headersFn(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const syncError = classifyM365NetworkError(err, context);
      if (attempt < GRAPH_MAX_ATTEMPTS) {
        const waitMs = Math.min(2 ** attempt * 1_000, 60_000);
        logger.warn(
          { ...syncError.details, attempt, waitMs },
          'graph network failure — waiting before retry',
        );
        await sleep(waitMs);
        continue;
      }
      throw syncError;
    }
    if (res.ok) return (await res.json()) as T;

    const body = await res.json().catch(() => undefined);
    const syncError = classifyM365Error({
      status: res.status,
      body,
      requestId: res.headers.get('request-id'),
      clientRequestId: res.headers.get('client-request-id'),
      retryAfter: res.headers.get('retry-after'),
      context,
    });
    lastError = syncError.message;

    if (syncError.details.retryable && attempt < GRAPH_MAX_ATTEMPTS) {
      const waitMs = Math.min(
        syncError.details.retryAfterMs ?? Math.min(2 ** attempt * 1000, 60_000),
        RETRY_WAIT_CAP_MS,
      );
      logger.warn(
        { ...syncError.details, attempt, waitMs },
        'graph retryable failure — waiting before retry',
      );
      await sleep(waitMs);
      continue;
    }
    throw syncError;
  }

  throw new Error(`${context}: gave up after ${GRAPH_MAX_ATTEMPTS} attempts — ${lastError}`);
}

// ── Graph helpers ─────────────────────────────────────────────────────────────

function parseAddresses(raw: unknown): EmailAddress[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: unknown) => {
      const a = r as { emailAddress?: { address?: string; name?: string } };
      return { email: a.emailAddress?.address ?? '', name: a.emailAddress?.name };
    })
    .filter((a) => a.email);
}

function mapImportance(raw: string | undefined): 'low' | 'normal' | 'high' {
  if (raw === 'low') return 'low';
  if (raw === 'high') return 'high';
  return 'normal';
}

// ── M365Connector ─────────────────────────────────────────────────────────────

interface M365Credentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

const SELECT_FIELDS =
  'id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,bccRecipients,body,hasAttachments,receivedDateTime,sentDateTime,importance,isRead,categories';

interface GraphPage {
  value: unknown[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export class M365Connector implements MailConnector {
  readonly provider = 'm365' as const;

  constructor(private readonly creds: M365Credentials) {}

  // Re-evaluated per request — getAccessToken serves from cache until 60s
  // before expiry, so a 90-minute backfill re-authenticates automatically.
  private readonly headers = async (): Promise<Record<string, string>> => ({
    Authorization: `Bearer ${await getAccessToken(this.creds.tenantId, this.creds.clientId, this.creds.clientSecret)}`,
  });

  async *fetchMailbox(mailbox: MailboxRef): MessageStream {
    const userId = mailbox.providerUserId ?? mailbox.address;

    if (mailbox.syncToken) {
      return yield* this.streamIncremental(mailbox);
    }
    return yield* this.streamBackfill(userId, mailbox);
  }

  async *fetchBackfillRange(mailbox: MailboxRef, from: string, to: string): MessageStream {
    const userId = mailbox.providerUserId ?? mailbox.address;
    const fromIso = new Date(from).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const toIso = new Date(to).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const params = new URLSearchParams({
      $select: SELECT_FIELDS,
      $top: '50',
      $orderby: 'receivedDateTime asc',
      $filter: `receivedDateTime ge ${fromIso} and receivedDateTime lt ${toIso}`,
    });
    const initialUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages?${params}`;

    yield* this.streamPages(initialUrl, mailbox.address);

    // Gap-fill only — never advance the forward/incremental cursor.
    logger.debug({ mailbox: mailbox.address, from, to }, 'm365 backfill_extend stream complete');
    return {};
  }

  // ── Backfill ────────────────────────────────────────────────────────────────
  // The delta endpoint does NOT support $filter or $orderby — it returns 400
  // "Change tracking is not supported" when those params are present.
  // Use the regular /messages endpoint for the initial date-filtered load,
  // then obtain a fresh deltaLink so future runs are incremental.

  private async *streamBackfill(userId: string, mailbox: MailboxRef): MessageStream {
    // Capture the delta cursor BEFORE fetching messages: mail arriving during
    // a (potentially long) backfill is then still covered by the next
    // incremental pass, and anything both passes catch is deduped on ingest.
    // Capturing it after would bake those mid-run arrivals into the delta
    // baseline and silently lose them forever.
    const nextSyncToken = await this.fetchLatestDeltaLink(userId, mailbox.address);

    const params = new URLSearchParams({
      $select: SELECT_FIELDS,
      $top: '50',
      $orderby: 'receivedDateTime asc',
    });

    if (mailbox.syncFromDate) {
      const iso = new Date(mailbox.syncFromDate).toISOString().replace(/\.\d{3}Z$/, 'Z');
      params.set('$filter', `receivedDateTime ge ${iso}`);
    }

    const initialUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages?${params}`;
    yield* this.streamPages(initialUrl, mailbox.address);

    logger.debug({ mailbox: mailbox.address }, 'm365 backfill stream complete');
    // The cursor is only surfaced once the stream fully drained — a crash
    // mid-backfill therefore never persists a cursor for a partial fetch.
    return { nextSyncToken };
  }

  /** Streams a Graph /messages URL page-by-page, following @odata.nextLink. */
  private async *streamPages(initialUrl: string, address: string): MessagePageStream {
    let url: string | undefined = initialUrl;

    while (url) {
      const data: GraphPage = await graphFetchJson<GraphPage>(
        url,
        this.headers,
        `Graph messages for ${address}`,
      );
      const page: RawMessage[] = [];
      for (const raw of data.value) {
        const msg = this.mapMessage(raw);
        if (msg) page.push(msg);
      }
      if (page.length > 0) yield page;
      url = data['@odata.nextLink'];
    }
  }

  // ── Incremental ─────────────────────────────────────────────────────────────
  // mailbox.syncToken is whatever deltaLink fetchLatestDeltaLink() last saved,
  // which is Inbox-scoped (see that function's comment) — so this only covers
  // new mail arriving in Inbox, not other folders.

  private async *streamIncremental(mailbox: MailboxRef): MessageStream {
    let nextSyncToken: string | undefined;
    let url: string | undefined = mailbox.syncToken;

    while (url) {
      const data: GraphPage = await graphFetchJson<GraphPage>(
        url,
        this.headers,
        `Graph delta for ${mailbox.address}`,
      );
      const page: RawMessage[] = [];
      for (const raw of data.value) {
        const msg = this.mapMessage(raw);
        if (msg) page.push(msg);
      }
      if (page.length > 0) yield page;

      if (data['@odata.nextLink']) {
        url = data['@odata.nextLink'];
      } else {
        nextSyncToken = data['@odata.deltaLink'];
        break;
      }
    }

    logger.debug({ mailbox: mailbox.address }, 'm365 incremental stream complete');
    return { nextSyncToken };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Obtains the Inbox delta cursor (deltaLink) by running a metadata-only
  // delta round ($select=id) and following @odata.nextLink pages until Graph
  // returns @odata.deltaLink on the final page.
  //
  // $deltaToken=latest is documented to short-circuit this to one empty
  // response carrying just the deltaLink — but real tenants (observed on this
  // one) ignore it and return full pages of message stubs, so following the
  // pagination to the end is required, not defensive.
  //
  // Graph does NOT support change-tracking against the mailbox-wide /messages
  // collection — delta only works when scoped to a single mail folder, so this
  // tracks Inbox only (the folder that receives the vast majority of new
  // mail). Other folders are covered by the initial full backfill but won't
  // pick up new items incrementally afterward.
  //
  // A failure here is high-stakes: without a deltaLink, the mailbox can never
  // graduate to incremental sync and every future run re-does a full,
  // unbounded backfill. So this retries a couple of times before giving up,
  // and logs the full status/body on failure instead of a bare status code.
  private async fetchLatestDeltaLink(userId: string, address: string): Promise<string | undefined> {
    const initialUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/mailFolders/inbox/messages/delta?$select=id&$deltaToken=latest`;
    const MAX_ATTEMPTS = 3;
    // Id-only stub pages are cheap, but cap the round so a pathological
    // mailbox can't spin this loop forever. maxpagesize keeps the page count
    // low (Graph clamps the value if it exceeds the endpoint's maximum).
    const MAX_PAGES = 200;
    const pageHeaders = async (): Promise<Record<string, string>> => ({
      ...(await this.headers()),
      Prefer: 'odata.maxpagesize=500',
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        let url: string | undefined = initialUrl;
        let page = 0;

        while (url && page < MAX_PAGES) {
          page++;
          const data: GraphPage = await graphFetchJson<GraphPage>(
            url,
            pageHeaders,
            `m365 delta round for ${address}`,
            15_000,
          );
          if (data['@odata.deltaLink']) {
            logger.debug({ address, pages: page }, 'm365 delta link obtained');
            return data['@odata.deltaLink'];
          }
          url = data['@odata.nextLink'];
        }

        if (page >= MAX_PAGES) {
          logger.warn(
            { address, attempt, maxPages: MAX_PAGES },
            'm365 delta round exceeded page cap without reaching a deltaLink',
          );
        }
      } catch (err) {
        logger.warn({ err, address, attempt }, 'm365 error during delta round');
      }
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1000);
    }

    logger.error(
      { address },
      'm365 delta link permanently unavailable after retries — mailbox will keep doing full backfills until this succeeds',
    );
    return undefined;
  }

  private mapMessage(raw: unknown): RawMessage | null {
    const m = raw as Record<string, unknown>;
    if (!m['id'] || !m['receivedDateTime']) return null;
    return {
      providerMessageId: m['id'] as string,
      providerThreadId: m['conversationId'] as string | undefined,
      rfcMessageId: m['internetMessageId'] as string | undefined,
      subject: m['subject'] as string | undefined,
      fromAddress:
        (((m['from'] as Record<string, unknown>)?.['emailAddress'] as Record<string, unknown>)?.[
          'address'
        ] as string) ?? '',
      fromName: (
        (m['from'] as Record<string, unknown>)?.['emailAddress'] as Record<string, unknown>
      )?.['name'] as string | undefined,
      toAddresses: parseAddresses(m['toRecipients']),
      ccAddresses: parseAddresses(m['ccRecipients']),
      bccAddresses: parseAddresses(m['bccRecipients']),
      bodyText: (m['body'] as Record<string, unknown>)?.['content'] as string | undefined,
      hasAttachments: !!m['hasAttachments'],
      receivedAt: m['receivedDateTime'] as string,
      sentAt: m['sentDateTime'] as string | undefined,
      sizeBytes: m['size'] as number | undefined,
      importance: mapImportance(m['importance'] as string | undefined),
      isRead: !!m['isRead'],
      labels: (m['categories'] as string[] | undefined) ?? [],
    };
  }

  async probeMailbox(mailbox: MailboxRef): Promise<ProbeResult> {
    const userId = mailbox.providerUserId ?? mailbox.address;

    // Oldest message — use URLSearchParams so OData params are properly encoded
    // (a bare space in $orderby causes Graph API to return HTTP 400).
    const oldestParams = new URLSearchParams({
      $select: 'receivedDateTime',
      $orderby: 'receivedDateTime asc',
      $top: '1',
    });

    let earliestEmailAt: string | undefined;
    try {
      const data = await graphFetchJson<{ value: Array<{ receivedDateTime: string }> }>(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages?${oldestParams}`,
        this.headers,
        `m365 probe oldest for ${mailbox.address}`,
        15_000,
      );
      earliestEmailAt = data.value[0]?.receivedDateTime;
    } catch (err) {
      logger.warn({ err, address: mailbox.address }, 'm365 probe: oldest-message lookup failed');
    }

    // Count estimate — a direct count against the mailbox's messages, never
    // enumerating or reading individual folders.
    const countParams = new URLSearchParams({ $count: 'true', $top: '1', $select: 'id' });
    const countHeaders = async (): Promise<Record<string, string>> => ({
      ...(await this.headers()),
      ConsistencyLevel: 'eventual',
    });

    let emailCountEstimate: number | undefined;
    try {
      const data = await graphFetchJson<{ '@odata.count'?: number }>(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages?${countParams}`,
        countHeaders,
        `m365 probe count for ${mailbox.address}`,
        15_000,
      );
      emailCountEstimate = data['@odata.count'];
    } catch (err) {
      logger.warn({ err, address: mailbox.address }, 'm365 probe: count lookup failed');
    }

    return { earliestEmailAt, emailCountEstimate };
  }
}
