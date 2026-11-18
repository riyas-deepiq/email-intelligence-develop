import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import { createAuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import { createAuthProviderRepository } from '../auth-providers/auth-provider.repository';
import { createMailboxRepository } from '../mailboxes/mailbox.repository';
import { createMailboxPhotoRepository } from '../mailboxes/mailbox-photo.repository';
import { createOrgRepository } from '../organizations/org.repository';
import { createUserRepository } from '../users/user.repository';
import { createAlertRepository } from '../alerts/alert.repository';
import { AlertService } from '../alerts/alert.service';
import { ProviderConnectionController } from './provider-connection.controller';
import { ProviderConnectionService } from './provider-connection.service';
import { collectorService } from '../../services/collector.service';

const auditSvc = new AuditService(createAuditRepository());
const alertsSvc = new AlertService(createAlertRepository());
const service = new ProviderConnectionService(
  createAuthProviderRepository(),
  createMailboxRepository(),
  createOrgRepository(),
  auditSvc,
  createUserRepository(),
  createMailboxPhotoRepository(),
  alertsSvc,
  collectorService,
);
const ctrl = new ProviderConnectionController(service);

export const providerConnectionRouter = Router();

providerConnectionRouter.post(
  '/test',
  requireAuth,
  requirePermission('providers.manage'),
  ctrl.testConnection,
);
providerConnectionRouter.post(
  '/connect',
  requireAuth,
  requirePermission('providers.manage'),
  ctrl.connect,
);
providerConnectionRouter.post(
  '/resync',
  requireAuth,
  requirePermission('providers.manage'),
  ctrl.resync,
);
providerConnectionRouter.get('/status', requireAuth, ctrl.getStatus);
providerConnectionRouter.get(
  '/config',
  requireAuth,
  requirePermission('providers.manage'),
  ctrl.getConfig,
);
