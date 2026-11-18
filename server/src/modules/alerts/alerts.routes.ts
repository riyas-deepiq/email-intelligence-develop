import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import { createOrgRepository } from '../organizations/org.repository';
import { createAlertRepository } from './alert.repository';
import { AlertService } from './alert.service';
import { AlertController } from './alert.controller';

const alertsSvc = new AlertService(createAlertRepository());
const controller = new AlertController(alertsSvc, createOrgRepository());

export const alertsRouter = Router();

alertsRouter.use(requireAuth, requirePermission('alerts.manage'));

alertsRouter.get('/', asyncHandler(controller.list));
alertsRouter.post('/mark-all-read', asyncHandler(controller.markAllRead));
alertsRouter.patch('/:id/read', asyncHandler(controller.markRead));
