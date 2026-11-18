import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import { createAuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

const auditSvc = new AuditService(createAuditRepository());
const controller = new AuditController(auditSvc);

export const auditRouter = Router();

auditRouter.use(requireAuth, requirePermission('audit.read'));

auditRouter.get('/', asyncHandler(controller.query));
