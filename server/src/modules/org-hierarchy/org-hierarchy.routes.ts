import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireAuth, requirePermission, requireRole } from '../../middleware/auth.middleware';
import { createOrgRepository } from '../organizations/org.repository';
import { OrgHierarchyController } from './org-hierarchy.controller';
import { createOrgHierarchyRepository } from './org-hierarchy.repository';
import { OrgHierarchyService } from './org-hierarchy.service';

const controller = new OrgHierarchyController(
  new OrgHierarchyService(createOrgHierarchyRepository(), createOrgRepository()),
);
export const orgHierarchyRouter = Router();
orgHierarchyRouter.use(requireAuth);
orgHierarchyRouter.get('/scope/:userId', asyncHandler(controller.getScope));
orgHierarchyRouter.get('/', requirePermission('org.manage'), asyncHandler(controller.getTree));
orgHierarchyRouter.use(requireRole('superadmin'));
orgHierarchyRouter.post('/nodes', asyncHandler(controller.addNode));
orgHierarchyRouter.patch('/nodes/:nodeId', asyncHandler(controller.updateNode));
orgHierarchyRouter.put('/nodes/:nodeId/managers', asyncHandler(controller.managers));
orgHierarchyRouter.put('/nodes/:nodeId/assignment', asyncHandler(controller.assignment));
orgHierarchyRouter.delete('/nodes/:nodeId', asyncHandler(controller.removeNode));
