import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { mailboxes, messages } from '../../db/schema';
import { asyncHandler } from '../../lib/async-handler';
import { getScopedMailboxIds } from '../../lib/mailbox-scope';
import { requireAuth } from '../../middleware/auth.middleware';

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

/**
 * GET /documents/:id
 * Resolves a RAG chat citation's documentId (= messages.id) to a URL for
 * "View source". Same RBAC scoping as GET /messages/:id — 404 (not 403) when
 * out of scope, so a user can't probe other people's message ids by testing
 * which ones come back 403 vs 404.
 *
 * Returns a bare `{ url }` (not the app's usual `{ data: ... }` envelope) —
 * matches client/src/features/chat/chat.api.ts's getDocumentLink() exactly.
 */
documentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = req.user!;
    const isAdmin = user.role === 'superadmin'; // admin now hierarchy-scoped too, see mailbox-scope.ts
    const id = req.params['id']!;

    const [row] = await db
      .select({ id: messages.id, mailboxId: messages.mailboxId })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(eq(messages.id, id));

    if (!row) {
      res.status(404).json({ error: { code: 'not_found', message: 'Document not found' } });
      return;
    }
    if (!isAdmin) {
      const allowed = await getScopedMailboxIds(user.id);
      if (!allowed.includes(row.mailboxId)) {
        res.status(404).json({ error: { code: 'not_found', message: 'Document not found' } });
        return;
      }
    }

    res.status(200).json({ url: `/mails?messageId=${row.id}` });
  }),
);
