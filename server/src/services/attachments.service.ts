import { google, type gmail_v1 } from 'googleapis';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { attachments as attachmentsTable, authProviders, mailboxes, messages } from '../db/schema';
import { decrypt } from '../modules/auth-providers/auth-provider.crypto';
import { logger } from '../lib/logger';

// Attachment bytes are not stored in our DB. Metadata is indexed automatically
// after mail sync (with on-demand indexing retained as a fallback), and bytes
// are fetched from the provider using the same credentials as the collector.

export interface AttachmentMeta {
  id: string;
  name: string;
  contentType: string | null;
  sizeBytes: number | null;
  isInline: boolean;
}

export interface AttachmentContent {
  name: string;
  contentType: string;
  data: Buffer;
}

export interface MailboxRef {
  address: string;
  provider: string; // 'm365' | 'google'
  providerUserId: string | null;
}

export interface AttachmentIndexSummary {
  messagesIndexed: number;
  filesIndexed: number;
  failed: number;
}

/** A provider failure with enough information for internal callers to decide
 * whether retrying later can help. */
export class AttachmentDownloadError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly providerStatus?: number,
  ) {
    super(message);
    this.name = 'AttachmentDownloadError';
  }
}

function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const value = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  const raw = value.response?.status ?? value.status ?? value.code;
  const status = typeof raw === 'string' ? Number(raw) : raw;
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}

function classifyDownloadError(err: unknown): AttachmentDownloadError {
  if (err instanceof AttachmentDownloadError) return err;
  const status = errorStatus(err);
  const message = err instanceof Error ? err.message : String(err);
  // A missing provider object will not reappear by repeating the same RAG
  // run. Everything else (auth, throttling, timeout, provider 5xx) is kept
  // retryable because configuration or provider health can recover.
  const retryable = status !== 404 && status !== 410;
  return new AttachmentDownloadError(message, retryable, status);
}

// M365 (Microsoft Graph)

let m365Token: { token: string; expiresAt: number } | null = null;

async function getM365Token(): Promise<string> {
  if (m365Token && m365Token.expiresAt > Date.now()) return m365Token.token;

  const [ap] = await getDb().select().from(authProviders).where(eq(authProviders.provider, 'm365'));
  if (!ap?.tenantId || !ap.clientId || !ap.clientSecret) {
    throw new Error('M365 provider is not configured');
  }

  const res = await fetch(`https://login.microsoftonline.com/${ap.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: ap.clientId,
      client_secret: decrypt(ap.clientSecret),
      scope: 'https://graph.microsoft.com/.default',
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Graph token request failed (${res.status})`);

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  m365Token = {
    token: data.access_token,
    // Refresh 5 minutes before actual expiry.
    expiresAt: Date.now() + ((data.expires_in ?? 3600) - 300) * 1000,
  };
  return m365Token.token;
}

function graphMessageUrl(mailbox: MailboxRef, providerMessageId: string): string {
  const user = encodeURIComponent(mailbox.providerUserId ?? mailbox.address);
  return `https://graph.microsoft.com/v1.0/users/${user}/messages/${encodeURIComponent(providerMessageId)}`;
}

async function listM365Attachments(
  mailbox: MailboxRef,
  providerMessageId: string,
): Promise<AttachmentMeta[]> {
  const token = await getM365Token();
  const res = await fetch(
    `${graphMessageUrl(mailbox, providerMessageId)}/attachments?$select=id,name,contentType,size,isInline`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`Graph attachments list failed (${res.status})`);

  const data = (await res.json()) as {
    value: {
      id: string;
      name: string;
      contentType?: string;
      size?: number;
      isInline?: boolean;
      '@odata.type'?: string;
    }[];
  };
  // itemAttachment and referenceAttachment do not expose contentBytes. Do not
  // create metadata rows that can never be vectorized. Keep rows with no type
  // for compatibility with providers/proxies that omit the annotation.
  return data.value
    .filter((a) => !a['@odata.type'] || a['@odata.type'] === '#microsoft.graph.fileAttachment')
    .map((a) => ({
      id: a.id,
      name: a.name,
      contentType: a.contentType ?? null,
      sizeBytes: a.size ?? null,
      isInline: a.isInline ?? false,
    }));
}

async function downloadM365Attachment(
  mailbox: MailboxRef,
  providerMessageId: string,
  attachmentId: string,
): Promise<AttachmentContent> {
  const token = await getM365Token();
  const res = await fetch(
    `${graphMessageUrl(mailbox, providerMessageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) {
    throw new AttachmentDownloadError(
      `Graph attachment download failed (${res.status})`,
      res.status !== 404 && res.status !== 410,
      res.status,
    );
  }

  const data = (await res.json()) as {
    name: string;
    contentType?: string;
    contentBytes?: string;
    '@odata.type'?: string;
  };
  if (!data.contentBytes) {
    // itemAttachment / referenceAttachment carry no file bytes.
    throw new AttachmentDownloadError(
      `Attachment type ${data['@odata.type'] ?? 'unknown'} has no downloadable file content`,
      false,
    );
  }
  return {
    name: data.name,
    contentType: data.contentType ?? 'application/octet-stream',
    data: Buffer.from(data.contentBytes, 'base64'),
  };
}

// Google (Gmail API, domain-wide delegation)

async function gmailClient(userEmail: string): Promise<gmail_v1.Gmail> {
  const [ap] = await getDb()
    .select()
    .from(authProviders)
    .where(eq(authProviders.provider, 'google'));
  if (!ap?.serviceAccountJson) throw new Error('Google provider is not configured');

  const key = JSON.parse(decrypt(ap.serviceAccountJson)) as Record<string, string>;
  const auth = new google.auth.JWT({
    email: key['client_email'],
    key: key['private_key'],
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    subject: userEmail,
  });
  return google.gmail({ version: 'v1', auth });
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPart[];
  headers?: { name?: string; value?: string }[];
}

function collectGmailAttachments(part: GmailPart | undefined, out: AttachmentMeta[]): void {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) {
    const cd =
      part.headers?.find((h) => h.name?.toLowerCase() === 'content-disposition')?.value ?? '';
    out.push({
      id: part.body.attachmentId,
      name: part.filename,
      contentType: part.mimeType ?? null,
      sizeBytes: part.body.size ?? null,
      isInline: cd.toLowerCase().startsWith('inline'),
    });
  }
  for (const p of part.parts ?? []) collectGmailAttachments(p, out);
}

async function listGoogleAttachments(
  mailbox: MailboxRef,
  providerMessageId: string,
): Promise<AttachmentMeta[]> {
  const gmail = await gmailClient(mailbox.address);
  const res = await gmail.users.messages.get({
    userId: mailbox.address,
    id: providerMessageId,
    format: 'full',
  });
  const out: AttachmentMeta[] = [];
  collectGmailAttachments(res.data.payload as GmailPart | undefined, out);
  return out;
}

async function downloadGoogleAttachment(
  mailbox: MailboxRef,
  providerMessageId: string,
  attachmentId: string,
): Promise<AttachmentContent> {
  // Gmail's attachments.get returns only bytes — name/type come from the message parts.
  const metas = await listGoogleAttachments(mailbox, providerMessageId);
  const meta = metas.find((a) => a.id === attachmentId);
  if (!meta) throw new Error('Attachment not found on message');

  const gmail = await gmailClient(mailbox.address);
  const res = await gmail.users.messages.attachments.get({
    userId: mailbox.address,
    messageId: providerMessageId,
    id: attachmentId,
  });
  const raw = res.data.data;
  if (!raw) throw new Error('Gmail returned no attachment data');

  return {
    name: meta.name,
    contentType: meta.contentType ?? 'application/octet-stream',
    data: Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  };
}

// Public API

export async function listAttachments(
  mailbox: MailboxRef,
  providerMessageId: string,
): Promise<AttachmentMeta[]> {
  try {
    return mailbox.provider === 'google'
      ? await listGoogleAttachments(mailbox, providerMessageId)
      : await listM365Attachments(mailbox, providerMessageId);
  } catch (err) {
    logger.warn({ err, provider: mailbox.provider, providerMessageId }, 'attachment list failed');
    throw err;
  }
}

/**
 * Attachment metadata is immutable once a message exists, so it is indexed
 * into the `attachments` table automatically after sync or on first access as
 * a fallback, then served from the DB. This enables filename search and RAG.
 */
export async function getOrIndexAttachments(
  messageId: string,
  mailbox: MailboxRef,
  providerMessageId: string,
): Promise<AttachmentMeta[]> {
  const db = getDb();

  const [msg] = await db
    .select({ indexedAt: messages.attachmentsIndexedAt })
    .from(messages)
    .where(eq(messages.id, messageId));

  if (msg?.indexedAt) {
    const rows = await db
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.messageId, messageId));
    return rows.map((r) => ({
      id: r.providerAttachmentId,
      name: r.name,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      isInline: r.isInline,
    }));
  }

  const metas = await listAttachments(mailbox, providerMessageId);

  if (metas.length > 0) {
    await db
      .insert(attachmentsTable)
      .values(
        metas.map((a) => ({
          messageId,
          providerAttachmentId: a.id,
          name: a.name,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          isInline: a.isInline,
        })),
      )
      .onConflictDoNothing();
  }
  await db
    .update(messages)
    .set({ attachmentsIndexedAt: new Date() })
    .where(eq(messages.id, messageId));

  return metas;
}

/**
 * Populate attachment metadata for every not-yet-indexed message in one
 * mailbox. Mail sync stores `hasAttachments`, but providers expose filenames
 * and attachment IDs through a second API call. RAG cannot download or
 * vectorize files until this metadata exists, so completed sync jobs run this
 * automatically instead of waiting for a user to open the Attachments page.
 *
 * Keyset pagination keeps memory flat for large initial mailbox imports. A
 * failed provider call remains unmarked and will be retried by the next sync.
 */
export async function indexPendingAttachmentsForMailbox(
  mailboxId: string,
  batchSize = 50,
  concurrency = 4,
): Promise<AttachmentIndexSummary> {
  const db = getDb();
  const summary: AttachmentIndexSummary = { messagesIndexed: 0, filesIndexed: 0, failed: 0 };
  let lastCreatedAt = new Date(0);
  let lastId = '00000000-0000-0000-0000-000000000000';

  const [mailbox] = await db
    .select({
      address: mailboxes.address,
      provider: mailboxes.provider,
      providerUserId: mailboxes.providerUserId,
    })
    .from(mailboxes)
    .where(eq(mailboxes.id, mailboxId));
  if (!mailbox) throw new Error(`Mailbox ${mailboxId} not found while indexing attachments`);

  const mailboxRef: MailboxRef = {
    address: mailbox.address,
    provider: mailbox.provider,
    providerUserId: mailbox.providerUserId,
  };

  for (;;) {
    const pending = await db
      .select({
        id: messages.id,
        createdAt: messages.createdAt,
        providerMessageId: messages.providerMessageId,
      })
      .from(messages)
      .where(
        and(
          eq(messages.mailboxId, mailboxId),
          eq(messages.hasAttachments, true),
          isNull(messages.attachmentsIndexedAt),
          sql`(${messages.createdAt}, ${messages.id}) > (${lastCreatedAt}, ${lastId})`,
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(Math.max(1, Math.min(batchSize, 250)));

    if (pending.length === 0) break;

    const workerCount = Math.max(1, Math.min(concurrency, 8));
    for (let i = 0; i < pending.length; i += workerCount) {
      const page = pending.slice(i, i + workerCount);
      const results = await Promise.allSettled(
        page.map((message) =>
          getOrIndexAttachments(message.id, mailboxRef, message.providerMessageId),
        ),
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          summary.messagesIndexed++;
          summary.filesIndexed += result.value.length;
        } else {
          summary.failed++;
        }
      }
    }

    const last = pending[pending.length - 1]!;
    lastCreatedAt = last.createdAt;
    lastId = last.id;
  }

  logger.info({ mailboxId, ...summary }, 'automatic attachment metadata indexing complete');
  return summary;
}

export async function downloadAttachment(
  mailbox: MailboxRef,
  providerMessageId: string,
  attachmentId: string,
): Promise<AttachmentContent> {
  try {
    return mailbox.provider === 'google'
      ? await downloadGoogleAttachment(mailbox, providerMessageId, attachmentId)
      : await downloadM365Attachment(mailbox, providerMessageId, attachmentId);
  } catch (err) {
    const failure = classifyDownloadError(err);
    logger.warn(
      {
        err: failure,
        provider: mailbox.provider,
        providerMessageId,
        attachmentId,
        providerStatus: failure.providerStatus,
        retryable: failure.retryable,
      },
      'attachment download failed',
    );
    throw failure;
  }
}
