import { Router } from 'express';
import { send } from '../../lib/respond';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { asyncHandler } from '../../lib/async-handler';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import { UnauthorizedError } from '../../lib/errors';
import { getDb } from '../../db/client';
import { mailboxes as mailboxesTable } from '../../db/schema';
import { getScopedMailboxIds } from '../../lib/mailbox-scope';
import { createOrgRepository } from '../organizations/org.repository';
import { createMailboxRepository } from './mailbox.repository';
import { createMailboxPhotoRepository } from './mailbox-photo.repository';
import { MailboxController } from './mailbox.controller';

const controller = new MailboxController(
  createMailboxRepository(),
  createOrgRepository(),
  createMailboxPhotoRepository(),
);

export const mailboxRouter = Router();

mailboxRouter.use(requireAuth);

mailboxRouter.get(
  '/',
  requirePermission('mailboxes.manage', 'users.manage', 'org.manage'),
  asyncHandler(controller.listAll),
);
mailboxRouter.post('/', requirePermission('mailboxes.manage'), asyncHandler(controller.create));
mailboxRouter.post(
  '/probe',
  requirePermission('mailboxes.manage'),
  asyncHandler(controller.triggerProbe),
);
mailboxRouter.post(
  '/probe/cancel',
  requirePermission('mailboxes.manage'),
  asyncHandler(controller.cancelProbe),
);
mailboxRouter.get(
  '/probe/status',
  requirePermission('mailboxes.manage'),
  asyncHandler(controller.probeStatus),
);

/**
 * GET /mailboxes/accessible
 * Other users' mailboxes (never the caller's own) the caller is allowed to
 * view mail for — the exact same rule GET /messages already enforces:
 * superadmin sees everyone, everyone else (including admin) sees their
 * org-hierarchy reports (direct or transitive), never a peer's or unrelated
 * colleague's mailbox — and plain employees see nobody but themselves, which
 * this endpoint already excludes, so they get an empty "other users" list.
 * Open to any authenticated user (not admin-gated), since it's just the read
 * model for the "other users" panel on the Mails page — it grants no access
 * beyond what /messages already allows that same caller to read.
 * Must be registered before GET /:id so Express doesn't treat "accessible"
 * as an :id.
 */
mailboxRouter.get(
  '/accessible',
  requirePermission('emails.read', 'threads.read', 'attachments.read'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const db = getDb();
    const isAdmin = req.user.role === 'superadmin'; // admin now hierarchy-scoped too, see mailbox-scope.ts

    const fields = {
      id: mailboxesTable.id,
      address: mailboxesTable.address,
      displayName: mailboxesTable.displayName,
      givenName: mailboxesTable.givenName,
      familyName: mailboxesTable.familyName,
      jobTitle: mailboxesTable.jobTitle,
      departmentName: mailboxesTable.departmentName,
    };
    // Shared/unassigned mailboxes (ownerUserId null) must still be included —
    // a bare `ne(ownerUserId, userId)` would silently drop them, since SQL's
    // three-valued logic makes `NULL != x` neither true nor false.
    const notOwnMailbox = or(
      isNull(mailboxesTable.ownerUserId),
      ne(mailboxesTable.ownerUserId, req.user.id),
    );

    // Only mailboxes that have actually been scanned. An unscanned mailbox has
    // nothing indexed behind it, so listing it here offers a person to click
    // whose mail view is guaranteed to be empty. Filtered server-side rather
    // than in the client so the panel can't drift from what /messages can
    // actually return.
    const scanned = eq(mailboxesTable.probeStatus, 'complete');

    if (isAdmin) {
      const rows = await db.select(fields).from(mailboxesTable).where(and(notOwnMailbox, scanned));
      send(res, rows);
      return;
    }

    const allowedIds = await getScopedMailboxIds(req.user.id);
    if (allowedIds.length === 0) {
      send(res, []);
      return;
    }
    const rows = await db
      .select(fields)
      .from(mailboxesTable)
      .where(and(inArray(mailboxesTable.id, allowedIds), notOwnMailbox, scanned));
    send(res, rows);
  }),
);

// Any authenticated user can view a mailbox's photo — it's already shown
// alongside the same mailbox's name/address in non-admin views (Threads,
// Emails, Attachments), so it carries no more exposure than those.
mailboxRouter.get('/:id/photo', asyncHandler(controller.getPhoto));
mailboxRouter.get(
  '/:id',
  requirePermission('mailboxes.manage', 'alerts.manage'),
  asyncHandler(controller.getById),
);
mailboxRouter.patch(
  '/:id',
  requirePermission('mailboxes.manage'),
  asyncHandler(controller.updateSyncConfig),
);
mailboxRouter.delete(
  '/:id',
  requirePermission('mailboxes.manage'),
  asyncHandler(controller.remove),
);
