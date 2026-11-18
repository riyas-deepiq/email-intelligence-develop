import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import { createAuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import { createUserRepository } from '../users/user.repository';
import { RoleController } from './role.controller';
import { createRoleRepository } from './role.repository';
import { RoleService } from './role.service';

const auditSvc = new AuditService(createAuditRepository());
const service = new RoleService(createRoleRepository(), createUserRepository(), auditSvc);
const controller = new RoleController(service);

export const roleRouter = Router();

roleRouter.use(requireAuth, requirePermission('roles.manage'));

roleRouter.get('/', asyncHandler(controller.list));
roleRouter.post('/', asyncHandler(controller.create));
roleRouter.patch('/:id', asyncHandler(controller.update));
roleRouter.delete('/:id', asyncHandler(controller.delete));
roleRouter.patch('/users/:userId', asyncHandler(controller.assignUser));
