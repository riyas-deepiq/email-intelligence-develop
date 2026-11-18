import { Router } from 'express';
import { send } from '../../lib/respond';
import { and, count, desc, eq, gte, ilike, inArray, lte, max, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { mailboxes, messages } from '../../db/schema';
import { asyncHandler } from '../../lib/async-handler';
import { parseDateParam } from '../../lib/date-param';
import { parseSearchParam } from '../../lib/search';
import { htmlToText, stripQuotedReply } from '../../lib/html-to-text';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import {
  downloadAttachment,
  getOrIndexAttachments,
  type MailboxRef,
} from '../../services/attachments.service';
import { actorFromRequest, AuditService } from '../audit/audit.service';
import { createAuditRepository } from '../audit/audit.repository';
import { getScopedMailboxIds } from '../../lib/mailbox-scope';
import type { Request, Response } from 'express';

// `isAdmin` below means superadmin only - the single reserved owner-level account
// (see role.service.ts SYSTEM_ROLES) is the sole full-org-wide bypass. 'admin' now
// falls through to getScopedMailboxIds() like everyone else, so two admin-tier
// peers with no reporting relationship can no longer see each other's mailbox.

const auditSvc = new AuditService(createAuditRepository());

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

/**
 * GET /messages
 * Paginated message list. Admins see all mailboxes (filterable by mailboxId).
 * Employees see only messages from their own linked mailbox.
 */
messagesRouter.get(
  '/',
  requirePermission('emails.read'),
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
    const importanceQ = req.query['importance'] as string | undefined;
    const ownScope = req.query['scope'] === 'own';
    const from = parseDateParam(req.query['from'] as string | undefined);
    const to = parseDateParam(req.query['to'] as string | undefined, true);

    const user = req.user!;
    const isAdmin = user.role === 'superadmin';

    // scope=own is a literal "just my mailbox" request (used by the Mailbox page for
    // everyone, admins included) — never widened to org-hierarchy reports. Otherwise,
    // non-admins are scoped to their own mailbox plus any reports' mailboxes.
    let scopeIds: string[] | undefined;
    if (ownScope) {
      const owned = await db
        .select({ id: mailboxes.id })
        .from(mailboxes)
        .where(eq(mailboxes.ownerUserId, user.id));
      if (owned.length === 0) {
        send(res, { messages: [], total: 0, page, limit, totalPages: 0 });
        return;
      }
      scopeIds = owned.map((m) => m.id);
    } else if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (allowed.length === 0) {
        send(res, { messages: [], total: 0, page, limit, totalPages: 0 });
        return;
      }
      scopeIds = allowed;
    }

    const conditions = [];
    if (scopeIds) conditions.push(inArray(messages.mailboxId, scopeIds));
    // Employees stay inside scopeIds, so a mailboxId filter can never widen their view.
    if (mailboxId) conditions.push(eq(messages.mailboxId, mailboxId));
    if (importanceQ) conditions.push(eq(messages.importance, importanceQ));
    if (from) conditions.push(gte(messages.receivedAt, from));
    if (to) conditions.push(lte(messages.receivedAt, to));
    if (search) {
      conditions.push(
        or(ilike(messages.subject, `%${search}%`), ilike(messages.fromAddress, `%${search}%`))!,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(messages).where(where);

    const rows = await db
      .select({
        id: messages.id,
        mailboxId: messages.mailboxId,
        threadId: messages.threadId,
        subject: messages.subject,
        fromAddress: messages.fromAddress,
        fromName: messages.fromName,
        toAddresses: messages.toAddresses,
        hasAttachments: messages.hasAttachments,
        receivedAt: messages.receivedAt,
        isRead: messages.isRead,
        importance: messages.importance,
        labels: messages.labels,
        mailboxAddress: mailboxes.address,
        mailboxProvider: mailboxes.provider,
      })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(where)
      .orderBy(desc(messages.receivedAt))
      .limit(limit)
      .offset(offset);

    send(res, { messages: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  }),
);

/**
 * GET /messages/by-mailbox
 * Per-mailbox message aggregates for the grouped "user by user" view.
 * Admins see all mailboxes; employees see their own plus any org-hierarchy reports'.
 */
messagesRouter.get(
  '/by-mailbox',
  requirePermission('emails.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = req.user!;
    const isAdmin = user.role === 'superadmin';

    let where;
    if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (allowed.length === 0) {
        send(res, { groups: [] });
        return;
      }
      where = inArray(messages.mailboxId, allowed);
    }

    const groups = await db
      .select({
        mailboxId: messages.mailboxId,
        mailboxAddress: mailboxes.address,
        mailboxProvider: mailboxes.provider,
        mailboxDisplayName: mailboxes.displayName,
        messageCount: count(),
        unreadCount: sql<number>`count(*) filter (where not ${messages.isRead})::int`,
        attachmentCount: sql<number>`count(*) filter (where ${messages.hasAttachments})::int`,
        latestReceivedAt: max(messages.receivedAt),
      })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(where)
      .groupBy(messages.mailboxId, mailboxes.address, mailboxes.provider, mailboxes.displayName)
      .orderBy(desc(max(messages.receivedAt)));

    send(res, { groups });
  }),
);

/** Full message body as readable plain text — quoted reply chain stripped, capped so payloads stay sane. */
function bodyFull(text: string | null, max = 20_000): string | null {
  if (!text) return null;
  const clean = stripQuotedReply(htmlToText(text));
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * GET /messages/:id
 * Full single-message detail (body + recipients) for the Mailbox page's
 * "open an email" action. Same access scoping as the attachment endpoints below.
 */
messagesRouter.get(
  '/:id',
  requirePermission('emails.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = req.user!;
    const isAdmin = user.role === 'superadmin';
    const id = req.params['id'];

    const [row] = await db
      .select({
        id: messages.id,
        mailboxId: messages.mailboxId,
        threadId: messages.threadId,
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
        mailboxAddress: mailboxes.address,
        mailboxProvider: mailboxes.provider,
        mailboxDisplayName: mailboxes.displayName,
      })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(eq(messages.id, id));

    if (!row) {
      res.status(404).json({ error: { code: 'not_found', message: 'Message not found' } });
      return;
    }
    if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (!allowed.includes(row.mailboxId)) {
        res.status(404).json({ error: { code: 'not_found', message: 'Message not found' } });
        return;
      }
    }

    const { bodyText, ...rest } = row;
    send(res, { ...rest, bodyText: bodyFull(bodyText) });
  }),
);

// Attachments (fetched on demand from the provider)

/** Load a message + its mailbox with role scoping; sends 404 and returns null when denied. */
type ScopedMessage = MailboxRef & { providerMessageId: string; mailboxId: string };

async function loadScopedMessage(req: Request, res: Response): Promise<ScopedMessage | null> {
  const db = getDb();
  const user = req.user!;
  const isAdmin = user.role === 'superadmin';

  const [row] = await db
    .select({
      providerMessageId: messages.providerMessageId,
      address: mailboxes.address,
      provider: mailboxes.provider,
      providerUserId: mailboxes.providerUserId,
      mailboxId: mailboxes.id,
    })
    .from(messages)
    .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
    .where(eq(messages.id, req.params['id']!));

  // 404 (not 403) when scoped out, so employees can't probe other users' message ids.
  if (!row) {
    res.status(404).json({ error: { code: 'not_found', message: 'Message not found' } });
    return null;
  }
  if (!isAdmin) {
    const allowed = await getScopedMailboxIds(user.id);
    if (!allowed.includes(row.mailboxId)) {
      res.status(404).json({ error: { code: 'not_found', message: 'Message not found' } });
      return null;
    }
  }
  return row;
}

/**
 * GET /messages/:id/attachments
 * Attachment metadata for a message, fetched live from M365/Google.
 */
messagesRouter.get(
  '/:id/attachments',
  requirePermission('attachments.read'),
  asyncHandler(async (req, res) => {
    const msg = await loadScopedMessage(req, res);
    if (!msg) return;

    try {
      const attachments = await getOrIndexAttachments(
        req.params['id']!,
        msg,
        msg.providerMessageId,
      );
      send(res, { attachments });
    } catch {
      res.status(502).json({
        error: {
          code: 'attachment_fetch_failed',
          message: 'Could not fetch attachments from the mail provider.',
        },
      });
    }
  }),
);

/**
 * GET /messages/:id/attachments/:attachmentId
 * Download one attachment's bytes, streamed through the server.
 */
messagesRouter.get(
  '/:id/attachments/:attachmentId',
  requirePermission('attachments.read'),
  asyncHandler(async (req, res) => {
    const msg = await loadScopedMessage(req, res);
    if (!msg) return;

    try {
      const file = await downloadAttachment(
        msg,
        msg.providerMessageId,
        req.params['attachmentId']!,
      );
      const shouldAuditDownload = req.query['audit'] === 'download';
      if (shouldAuditDownload && req.user) {
        const actor = actorFromRequest(req.user, req.ip);
        await auditSvc.attachmentEvent(
          'attachment.downloaded',
          actor,
          req.params['attachmentId']!,
          {
            fileName: file.name,
            messageId: req.params['id'],
          },
        );
      }
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Length', file.data.length);
      // RFC 5987 encoding so unicode filenames survive.
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      res.status(200).send(file.data);
    } catch {
      res.status(502).json({
        error: {
          code: 'attachment_fetch_failed',
          message: 'Could not download the attachment from the mail provider.',
        },
      });
    }
  }),
);
