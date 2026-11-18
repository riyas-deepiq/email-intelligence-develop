import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import { sessionStore } from '../../lib/session-store';
import { createAuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { createMailboxRepository } from '../mailboxes/mailbox.repository';
import { createOrgRepository } from '../organizations/org.repository';
import { UserController } from './user.controller';
import { createUserRepository } from './user.repository';
import { UserService } from './user.service';

const orgRepo = createOrgRepository();
const repository = createUserRepository();
const auditSvc = new AuditService(createAuditRepository());
const authSvc = new AuthService(repository, sessionStore, orgRepo, auditSvc);
const service = new UserService(
  repository,
  createMailboxRepository(),
  auditSvc,
  sessionStore,
  orgRepo,
);
const controller = new UserController(service, authSvc, orgRepo);

export const userRouter = Router();

userRouter.get('/', requireAuth, asyncHandler(controller.list));
userRouter.get('/:id', requireAuth, asyncHandler(controller.getById));
userRouter.post(
  '/',
  requireAuth,
  requirePermission('users.manage'),
  asyncHandler(controller.create),
);
// Users may only update their own profile; admins can update anyone.
userRouter.patch('/:id', requireAuth, asyncHandler(controller.update));

// Invite — creates user with status 'invited' + sends email
userRouter.post(
  '/invite',
  requireAuth,
  requirePermission('users.manage'),
  asyncHandler(controller.invite),
);

// Create a platform user from an existing mailbox (copies email + display name, links owner)
userRouter.post(
  '/from-mailbox',
  requireAuth,
  requirePermission('users.manage', 'org.manage'),
  asyncHandler(controller.createFromMailbox),
);

// Deactivate / reactivate / cancel invite
userRouter.post(
  '/:id/deactivate',
  requireAuth,
  requirePermission('users.manage'),
  asyncHandler(controller.deactivate),
);
userRouter.post(
  '/:id/reactivate',
  requireAuth,
  requirePermission('users.manage'),
  asyncHandler(controller.reactivate),
);
userRouter.delete(
  '/:id/invite',
  requireAuth,
  requirePermission('users.manage'),
  asyncHandler(controller.cancelInvite),
);
userRouter.post(
  '/:id/invite/resend',
  requireAuth,
  requirePermission('users.manage'),
  asyncHandler(controller.resendInvite),
);
