import { Router } from 'express';
import { send } from '../../lib/respond';
import { asyncHandler } from '../../lib/async-handler';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth.middleware';
import { createAuthProviderRepository } from '../auth-providers/auth-provider.repository';
import { createMailboxRepository } from '../mailboxes/mailbox.repository';
import { createOrgRepository } from '../organizations/org.repository';
import type { SkippableStep } from '../organizations/org.types';
import { createUserRepository } from '../users/user.repository';
import { SetupService } from './setup.service';

const SKIPPABLE: SkippableStep[] = ['sso', 'hierarchy'];

const orgRepo = createOrgRepository();
const userRepo = createUserRepository();
const providerRepo = createAuthProviderRepository();
const mailboxRepo = createMailboxRepository();
const setupSvc = new SetupService(orgRepo, userRepo, providerRepo, mailboxRepo);

export const setupRouter = Router();

setupRouter.use(requireAuth, requireRole('superadmin'));

/** GET /setup/status — computed step completion derived from actual data */
setupRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const status = await setupSvc.getStatus();
    send(res, status);
  }),
);

/** PATCH /setup/skip — mark an optional step as skipped */
setupRouter.patch(
  '/skip',
  asyncHandler(async (req, res) => {
    const { step } = req.body as { step?: unknown };

    if (!SKIPPABLE.includes(step as SkippableStep)) {
      throw new ValidationError(`step must be one of: ${SKIPPABLE.join(', ')}`);
    }

    const org = await orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');

    await orgRepo.updateSkip(org.id, step as SkippableStep);

    const status = await setupSvc.getStatus();
    send(res, status);
  }),
);
