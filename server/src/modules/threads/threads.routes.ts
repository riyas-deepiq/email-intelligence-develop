import { Router } from 'express';
import { send } from '../../lib/respond';
import { and, count, desc, eq, gte, ilike, inArray, lte, max, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { mailboxes, messages, threads } from '../../db/schema';
import { asyncHandler } from '../../lib/async-handler';
import { parseDateParam } from '../../lib/date-param';
import { parseSearchParam } from '../../lib/search';
import { htmlToText, stripQuotedReply } from '../../lib/html-to-text';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import { getOrIndexAttachments } from '../../services/attachments.service';
import { summarizeThread } from '../../services/summarizer.service';
import { getScopedMailboxIds } from '../../lib/mailbox-scope';

export const threadsRouter = Router();
threadsRouter.use(requireAuth);

/**
 * GET /threads
 * Paginated thread list, filterable by mailbox and last-activity date range.
 * Admins see all; employees see their own mailbox plus any org-hierarchy reports'.
 */
threadsRouter.get(
  '/',
  requirePermission('threads.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const page = Math.max(1, parseInt((req.query['page'] as string) || '1', 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt((req.query['limit'] as string) || '50', 10) || 50),
    );
    const offset = (page - 1) * limit;

    const mailboxId = req.query['mailboxId'] as string | undefined;
    const search = parseSearchParam(req.query['search']);
    const from = parseDateParam(req.query['from'] as string | undefined);
    const to = parseDateParam(req.query['to'] as string | undefined, true);

    const user = req.user!;
    const isAdmin = user.role === 'superadmin'; // admin now hierarchy-scoped too, see mailbox-scope.ts

    let scopeIds: string[] | undefined;
    if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (allowed.length === 0) {
        send(res, { threads: [], total: 0, page, limit, totalPages: 0 });
        return;
      }
      scopeIds = allowed;
    }

    const conditions = [];
    if (scopeIds) conditions.push(inArray(threads.mailboxId, scopeIds));
    // Employees stay inside scopeIds, so a mailboxId filter can never widen their view.
    if (mailboxId) conditions.push(eq(threads.mailboxId, mailboxId));
    if (from) conditions.push(gte(threads.lastMessageAt, from));
    if (to) conditions.push(lte(threads.lastMessageAt, to));
    if (search) {
      const like = `%${search}%`;
      // Match the subject, or any participant email (jsonb array cast to text).
      conditions.push(
        or(ilike(threads.subject, like), sql`${threads.participantEmails}::text ILIKE ${like}`)!,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(threads).where(where);

    const rows = await db
      .select({
        id: threads.id,
        mailboxId: threads.mailboxId,
        subject: threads.subject,
        participantEmails: threads.participantEmails,
        messageCount: threads.messageCount,
        hasAttachments: threads.hasAttachments,
        firstMessageAt: threads.firstMessageAt,
        lastMessageAt: threads.lastMessageAt,
        mailboxAddress: mailboxes.address,
        mailboxProvider: mailboxes.provider,
        mailboxDisplayName: mailboxes.displayName,
        attachmentCount: sql<number>`(select count(*) from ${messages} where ${messages.threadId} = ${threads.id} and ${messages.hasAttachments})::int`,
      })
      .from(threads)
      .innerJoin(mailboxes, eq(threads.mailboxId, mailboxes.id))
      .where(where)
      .orderBy(desc(threads.lastMessageAt))
      .limit(limit)
      .offset(offset);

    send(res, { threads: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  }),
);

/**
 * GET /threads/by-mailbox
 * Per-mailbox thread aggregates for the grouped "user by user" view.
 * Admins see all mailboxes; employees see their own plus any org-hierarchy reports'.
 */
threadsRouter.get(
  '/by-mailbox',
  requirePermission('threads.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = req.user!;
    const isAdmin = user.role === 'superadmin'; // admin now hierarchy-scoped too, see mailbox-scope.ts

    let where;
    if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (allowed.length === 0) {
        send(res, { groups: [] });
        return;
      }
      where = inArray(threads.mailboxId, allowed);
    }

    const groups = await db
      .select({
        mailboxId: threads.mailboxId,
        mailboxAddress: mailboxes.address,
        mailboxProvider: mailboxes.provider,
        mailboxDisplayName: mailboxes.displayName,
        threadCount: count(),
        messageCount: sql<number>`coalesce(sum(${threads.messageCount}), 0)::int`,
        latestMessageAt: max(threads.lastMessageAt),
      })
      .from(threads)
      .innerJoin(mailboxes, eq(threads.mailboxId, mailboxes.id))
      .where(where)
      .groupBy(threads.mailboxId, mailboxes.address, mailboxes.provider, mailboxes.displayName)
      .orderBy(desc(max(threads.lastMessageAt)));

    // Unread and attachment totals are per message, so aggregate them from the
    // messages table and merge by mailbox. attachmentCount is the true total of
    // attachment-bearing emails (not just the number of threads that have any).
    const mailboxIds = groups.map((g) => g.mailboxId);
    const msgAgg = mailboxIds.length
      ? await db
          .select({
            mailboxId: messages.mailboxId,
            unreadCount: sql<number>`count(*) filter (where not ${messages.isRead})::int`,
            attachmentCount: sql<number>`count(*) filter (where ${messages.hasAttachments})::int`,
          })
          .from(messages)
          .where(inArray(messages.mailboxId, mailboxIds))
          .groupBy(messages.mailboxId)
      : [];
    const aggByMailbox = new Map(msgAgg.map((r) => [r.mailboxId, r]));

    const groupsOut = groups.map((g) => ({
      ...g,
      unreadCount: aggByMailbox.get(g.mailboxId)?.unreadCount ?? 0,
      attachmentCount: aggByMailbox.get(g.mailboxId)?.attachmentCount ?? 0,
    }));

    send(res, { groups: groupsOut });
  }),
);

/** Strip HTML, drop the quoted reply chain, collapse whitespace, and cap length for the collapsed card view. */
function bodyPreview(text: string | null, max = 400): string | null {
  if (!text) return null;
  const collapsed = stripQuotedReply(htmlToText(text)).replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/** Full message body as readable plain text — quoted reply chain stripped, since each
 *  earlier message already appears as its own row — capped so payloads stay sane. */
function bodyFull(text: string | null, max = 20_000): string | null {
  if (!text) return null;
  const clean = stripQuotedReply(htmlToText(text));
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * GET /threads/:id
 * Thread detail with all its messages. Admins see any thread; employees only
 * threads belonging to their own mailbox(es).
 */
threadsRouter.get(
  '/:id',
  requirePermission('threads.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = req.user!;
    const isAdmin = user.role === 'superadmin'; // admin now hierarchy-scoped too, see mailbox-scope.ts
    const id = req.params['id'];

    const [thread] = await db
      .select({
        id: threads.id,
        mailboxId: threads.mailboxId,
        subject: threads.subject,
        participantEmails: threads.participantEmails,
        messageCount: threads.messageCount,
        hasAttachments: threads.hasAttachments,
        firstMessageAt: threads.firstMessageAt,
        lastMessageAt: threads.lastMessageAt,
        mailboxAddress: mailboxes.address,
        mailboxProvider: mailboxes.provider,
        mailboxDisplayName: mailboxes.displayName,
        attachmentCount: sql<number>`(select count(*) from ${messages} where ${messages.threadId} = ${threads.id} and ${messages.hasAttachments})::int`,
      })
      .from(threads)
      .innerJoin(mailboxes, eq(threads.mailboxId, mailboxes.id))
      .where(eq(threads.id, id));

    // 404 (not 403) when scoped out, so employees can't probe other users' thread ids.
    if (!thread) {
      res.status(404).json({ error: { code: 'not_found', message: 'Thread not found' } });
      return;
    }
    if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (!allowed.includes(thread.mailboxId)) {
        res.status(404).json({ error: { code: 'not_found', message: 'Thread not found' } });
        return;
      }
    }

    const msgRows = await db
      .select({
        id: messages.id,
        subject: messages.subject,
        fromAddress: messages.fromAddress,
        fromName: messages.fromName,
        toAddresses: messages.toAddresses,
        ccAddresses: messages.ccAddresses,
        bodyText: messages.bodyText,
        hasAttachments: messages.hasAttachments,
        receivedAt: messages.receivedAt,
        sentAt: messages.sentAt,
        sizeBytes: messages.sizeBytes,
        importance: messages.importance,
        isRead: messages.isRead,
        labels: messages.labels,
      })
      .from(messages)
      .where(eq(messages.threadId, id))
      .orderBy(desc(messages.receivedAt));

    send(res, {
      thread,
      messages: msgRows.map(({ bodyText, ...m }) => ({
        ...m,
        bodyPreview: bodyPreview(bodyText),
        bodyText: bodyFull(bodyText),
      })),
    });
  }),
);

/**
 * GET /threads/:id/attachments
 * All attachments across every message in the thread, fetched live from the
 * provider. Messages whose provider lookup fails are skipped and counted in
 * `failedMessages`. Same access scoping as the detail endpoint.
 */
threadsRouter.get(
  '/:id/attachments',
  requirePermission('attachments.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = req.user!;
    const isAdmin = user.role === 'superadmin'; // admin now hierarchy-scoped too, see mailbox-scope.ts
    const id = req.params['id'];

    const [thread] = await db
      .select({
        id: threads.id,
        mailboxId: threads.mailboxId,
        address: mailboxes.address,
        provider: mailboxes.provider,
        providerUserId: mailboxes.providerUserId,
      })
      .from(threads)
      .innerJoin(mailboxes, eq(threads.mailboxId, mailboxes.id))
      .where(eq(threads.id, id));

    if (!thread) {
      res.status(404).json({ error: { code: 'not_found', message: 'Thread not found' } });
      return;
    }
    if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (!allowed.includes(thread.mailboxId)) {
        res.status(404).json({ error: { code: 'not_found', message: 'Thread not found' } });
        return;
      }
    }

    const msgRows = await db
      .select({
        id: messages.id,
        providerMessageId: messages.providerMessageId,
        receivedAt: messages.receivedAt,
        fromName: messages.fromName,
        fromAddress: messages.fromAddress,
      })
      .from(messages)
      .where(and(eq(messages.threadId, id), eq(messages.hasAttachments, true)))
      .orderBy(desc(messages.receivedAt));

    const mailboxRef = {
      address: thread.address,
      provider: thread.provider,
      providerUserId: thread.providerUserId,
    };

    // Fetch per message with modest parallelism so a big thread doesn't hammer the provider.
    const CONCURRENCY = 4;
    const attachments: Array<{
      messageId: string;
      receivedAt: Date;
      fromName: string | null;
      fromAddress: string;
      id: string;
      name: string;
      contentType: string | null;
      sizeBytes: number | null;
      isInline: boolean;
    }> = [];
    let failedMessages = 0;

    for (let i = 0; i < msgRows.length; i += CONCURRENCY) {
      const batch = msgRows.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((m) => getOrIndexAttachments(m.id, mailboxRef, m.providerMessageId)),
      );
      results.forEach((r, idx) => {
        const m = batch[idx];
        if (r.status === 'fulfilled') {
          for (const a of r.value) {
            attachments.push({
              messageId: m.id,
              receivedAt: m.receivedAt,
              fromName: m.fromName,
              fromAddress: m.fromAddress,
              ...a,
            });
          }
        } else {
          failedMessages++;
        }
      });
    }

    if (msgRows.length > 0 && failedMessages === msgRows.length) {
      res.status(502).json({
        error: {
          code: 'attachment_fetch_failed',
          message: 'Could not fetch attachments from the mail provider.',
        },
      });
      return;
    }

    send(res, { attachments, failedMessages });
  }),
);

/**
 * GET /threads/:id/summary
 * AI-generated summary of the thread via the local Ollama instance.
 * Returns 503 when the LLM is unreachable — the client falls back to
 * derived thread facts. Same access scoping as the detail endpoint.
 */
threadsRouter.get(
  '/:id/summary',
  requirePermission('summaries.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = req.user!;
    const isAdmin = user.role === 'superadmin'; // admin now hierarchy-scoped too, see mailbox-scope.ts
    const id = req.params['id'];

    const [thread] = await db
      .select({
        id: threads.id,
        subject: threads.subject,
        mailboxId: threads.mailboxId,
      })
      .from(threads)
      .innerJoin(mailboxes, eq(threads.mailboxId, mailboxes.id))
      .where(eq(threads.id, id));

    if (!thread) {
      res.status(404).json({ error: { code: 'not_found', message: 'Thread not found' } });
      return;
    }
    if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (!allowed.includes(thread.mailboxId)) {
        res.status(404).json({ error: { code: 'not_found', message: 'Thread not found' } });
        return;
      }
    }

    const msgRows = await db
      .select({
        fromName: messages.fromName,
        fromAddress: messages.fromAddress,
        receivedAt: messages.receivedAt,
        bodyText: messages.bodyText,
      })
      .from(messages)
      .where(eq(messages.threadId, id));

    if (msgRows.length === 0) {
      send(res, { summary: null, model: null, cached: false });
      return;
    }

    try {
      const result = await summarizeThread(id, thread.subject, msgRows);
      send(res, result);
    } catch {
      res.status(503).json({
        error: { code: 'summary_unavailable', message: 'AI summary service is unavailable.' },
      });
    }
  }),
);
