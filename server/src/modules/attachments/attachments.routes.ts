import { Router } from 'express';
import { send } from '../../lib/respond';
import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, max, or } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { attachments, mailboxes, messages } from '../../db/schema';
import { asyncHandler } from '../../lib/async-handler';
import { parseDateParam } from '../../lib/date-param';
import { parseSearchParam } from '../../lib/search';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import { getOrIndexAttachments } from '../../services/attachments.service';
import { getScopedMailboxIds } from '../../lib/mailbox-scope';

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth);

/**
 * GET /attachments
 * Org-wide attachment listing. Pages over non-inline attachment rows. Attachment
 * metadata is indexed lazily from matching messages until the requested page
 * can be filled, so "Show 25" means 25 attachment rows, not 25 emails.
 */
attachmentsRouter.get(
  '/',
  requirePermission('attachments.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const page = Math.max(1, parseInt((req.query['page'] as string) || '1', 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt((req.query['limit'] as string) || '20', 10) || 20),
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
        send(res, { files: [], total: 0, page, limit, totalPages: 0, failedMessages: 0 });
        return;
      }
      scopeIds = allowed;
    }

    const conditions = [eq(messages.hasAttachments, true)];
    if (scopeIds) conditions.push(inArray(messages.mailboxId, scopeIds));
    // Employees stay inside scopeIds, so a mailboxId filter can never widen their view.
    if (mailboxId) conditions.push(eq(messages.mailboxId, mailboxId));
    if (from) conditions.push(gte(messages.receivedAt, from));
    if (to) conditions.push(lte(messages.receivedAt, to));
    if (search) {
      const like = `%${search}%`;
      // Filename matches come from the attachments index (see POST /attachments/index).
      const nameMatch = getDb()
        .select({ id: attachments.messageId })
        .from(attachments)
        .where(ilike(attachments.name, like));
      conditions.push(
        or(
          ilike(messages.subject, like),
          ilike(messages.fromAddress, like),
          ilike(mailboxes.address, like),
          inArray(messages.id, nameMatch),
        )!,
      );
    }
    const where = and(...conditions);

    const CONCURRENCY = 4;
    let failedMessages = 0;

    for (;;) {
      const [{ indexedTotal }] = await db
        .select({ indexedTotal: count() })
        .from(attachments)
        .innerJoin(messages, eq(attachments.messageId, messages.id))
        .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
        .where(and(where, eq(attachments.isInline, false)));

      if (indexedTotal >= offset + limit) break;

      const pending = await db
        .select({
          id: messages.id,
          providerMessageId: messages.providerMessageId,
          mailboxAddress: mailboxes.address,
          mailboxProvider: mailboxes.provider,
          providerUserId: mailboxes.providerUserId,
        })
        .from(messages)
        .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
        .where(and(where, isNull(messages.attachmentsIndexedAt)))
        .orderBy(desc(messages.receivedAt))
        .limit(limit);

      if (pending.length === 0) break;

      let indexedMessages = 0;
      for (let i = 0; i < pending.length; i += CONCURRENCY) {
        const batch = pending.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((m) =>
            getOrIndexAttachments(
              m.id,
              {
                address: m.mailboxAddress,
                provider: m.mailboxProvider,
                providerUserId: m.providerUserId,
              },
              m.providerMessageId,
            ),
          ),
        );
        indexedMessages += results.filter((r) => r.status === 'fulfilled').length;
        failedMessages += results.filter((r) => r.status === 'rejected').length;
      }
      if (indexedMessages === 0) break;
    }

    const [{ total }] = await db
      .select({ total: count() })
      .from(attachments)
      .innerJoin(messages, eq(attachments.messageId, messages.id))
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(and(where, eq(attachments.isInline, false)));

    const files = await db
      .select({
        messageId: messages.id,
        id: attachments.providerAttachmentId,
        name: attachments.name,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
        subject: messages.subject,
        fromAddress: messages.fromAddress,
        fromName: messages.fromName,
        mailboxAddress: mailboxes.address,
        ownerName: mailboxes.displayName,
        department: mailboxes.departmentName,
        receivedAt: messages.receivedAt,
      })
      .from(attachments)
      .innerJoin(messages, eq(attachments.messageId, messages.id))
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(and(where, eq(attachments.isInline, false)))
      .orderBy(desc(messages.receivedAt), desc(attachments.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ pendingRemaining }] = await db
      .select({ pendingRemaining: count() })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(and(where, isNull(messages.attachmentsIndexedAt)));

    const visibleTotal =
      pendingRemaining > 0 && files.length === limit ? Math.max(total, page * limit + 1) : total;

    send(res, {
      files,
      total: visibleTotal,
      page,
      limit,
      totalPages: Math.ceil(visibleTotal / limit),
      failedMessages,
    });
  }),
);

/**
 * GET /attachments/by-mailbox
 * Per-mailbox attachment-message aggregates for the grouped "user by user" view.
 * Admins see all mailboxes; employees see their own plus any org-hierarchy reports'.
 * Counts messages that carry attachments (not individual files — those require a
 * live provider fetch, done lazily once a user drills into a specific mailbox).
 */
attachmentsRouter.get(
  '/by-mailbox',
  requirePermission('attachments.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = req.user!;
    const isAdmin = user.role === 'superadmin'; // admin now hierarchy-scoped too, see mailbox-scope.ts

    const conditions = [eq(messages.hasAttachments, true)];
    if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (allowed.length === 0) {
        send(res, { groups: [] });
        return;
      }
      conditions.push(inArray(messages.mailboxId, allowed));
    }

    const groups = await db
      .select({
        mailboxId: messages.mailboxId,
        mailboxAddress: mailboxes.address,
        mailboxProvider: mailboxes.provider,
        mailboxDisplayName: mailboxes.displayName,
        department: mailboxes.departmentName,
        fileMessageCount: count(),
        latestReceivedAt: max(messages.receivedAt),
      })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(and(...conditions))
      .groupBy(
        messages.mailboxId,
        mailboxes.address,
        mailboxes.provider,
        mailboxes.displayName,
        mailboxes.departmentName,
      )
      .orderBy(desc(max(messages.receivedAt)));

    send(res, { groups });
  }),
);

/**
 * POST /attachments/index
 * Index the next batch of not-yet-indexed attachment messages from the
 * provider into the attachments table, so filename search can find files that
 * were never loaded in the UI. The client calls this in a loop while a search
 * is active until `remaining` reaches 0.
 */
attachmentsRouter.post(
  '/index',
  requirePermission('attachments.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = req.user!;
    const isAdmin = user.role === 'superadmin'; // admin now hierarchy-scoped too, see mailbox-scope.ts
    const budget = Math.min(
      50,
      Math.max(1, parseInt((req.query['budget'] as string) || '25', 10) || 25),
    );

    let scopeIds: string[] | undefined;
    if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (allowed.length === 0) {
        send(res, { indexed: 0, failed: 0, remaining: 0 });
        return;
      }
      scopeIds = allowed;
    }

    const pendingWhere = and(
      eq(messages.hasAttachments, true),
      isNull(messages.attachmentsIndexedAt),
      ...(scopeIds ? [inArray(messages.mailboxId, scopeIds)] : []),
    );

    const pending = await db
      .select({
        id: messages.id,
        providerMessageId: messages.providerMessageId,
        mailboxAddress: mailboxes.address,
        mailboxProvider: mailboxes.provider,
        providerUserId: mailboxes.providerUserId,
      })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(pendingWhere)
      .orderBy(desc(messages.receivedAt))
      .limit(budget);

    let indexed = 0;
    let failed = 0;
    const CONCURRENCY = 4;

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((m) =>
          getOrIndexAttachments(
            m.id,
            {
              address: m.mailboxAddress,
              provider: m.mailboxProvider,
              providerUserId: m.providerUserId,
            },
            m.providerMessageId,
          ),
        ),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') indexed++;
        else failed++;
      }
    }

    const [{ remaining }] = await db
      .select({ remaining: count() })
      .from(messages)
      .where(pendingWhere);

    send(res, { indexed, failed, remaining });
  }),
);
