import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import { createAuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import { createMailboxRepository } from '../mailboxes/mailbox.repository';
import { createAuthProviderRepository } from './auth-provider.repository';
import { AuthProviderController } from './auth-provider.controller';
import { AuthProviderService } from './auth-provider.service';

const auditSvc = new AuditService(createAuditRepository());
const service = new AuthProviderService(
  createAuthProviderRepository(),
  auditSvc,
  createMailboxRepository(),
);
const controller = new AuthProviderController(service);

export const authProviderRouter = Router();

authProviderRouter.use(requireAuth, requirePermission('sso.manage'));

authProviderRouter.get('/', asyncHandler(controller.listAll));
authProviderRouter.put('/:provider', asyncHandler(controller.update));
authProviderRouter.delete('/:provider', asyncHandler(controller.disconnect));
