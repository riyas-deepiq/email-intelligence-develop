import { Router } from 'express';
import { send } from '../../lib/respond';
import { asyncHandler } from '../../lib/async-handler';
import { ValidationError, NotFoundError } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth.middleware';
import { actorFromRequest, AuditService } from '../audit/audit.service';
import { createAuditRepository } from '../audit/audit.repository';
import { createOrgRepository } from './org.repository';

const orgRepo = createOrgRepository();
const auditSvc = new AuditService(createAuditRepository());

export const orgRouter = Router();

orgRouter.use(requireAuth);

/** GET /org — current org settings including JIT config (admin + superadmin) */
orgRouter.get(
  '/',
  requirePermission('org.manage'),
  asyncHandler(async (_req, res) => {
    const org = await orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');
    send(res, org);
  }),
);

/** POST /org — create or upsert the organization (superadmin only) */
orgRouter.post(
  '/',
  requirePermission('org.manage'),
  asyncHandler(async (req, res) => {
    const { name, domains, adminEmail } = req.body as {
      name?: unknown;
      domains?: unknown;
      adminEmail?: unknown;
    };
    if (typeof name !== 'string' || !name.trim()) throw new ValidationError('name is required');
    if (typeof domains !== 'string' || !domains.trim())
      throw new ValidationError('domains is required');
    if (typeof adminEmail !== 'string' || !adminEmail.trim())
      throw new ValidationError('adminEmail is required');

    const org = await orgRepo.upsert({
      name: name.trim(),
      domains: domains.trim(),
      adminEmail: adminEmail.trim(),
    });
    send(res, org, 'OK', 201);
  }),
);

/** PATCH /org — update org name and/or domains (superadmin only) */
orgRouter.patch(
  '/',
  requirePermission('org.manage'),
  asyncHandler(async (req, res) => {
    const existing = await orgRepo.findFirst();
    if (!existing) throw new NotFoundError('No organization configured yet');

    const { name, domains } = req.body as { name?: unknown; domains?: unknown };
    if (name !== undefined && (typeof name !== 'string' || !name.trim()))
      throw new ValidationError('name must be a non-empty string');
    if (domains !== undefined && (typeof domains !== 'string' || !domains.trim()))
      throw new ValidationError('domains must be a non-empty string');

    const org = await orgRepo.upsert({
      name: typeof name === 'string' ? name.trim() : existing.name,
      domains: typeof domains === 'string' ? domains.trim() : existing.domains,
      adminEmail: existing.adminEmail,
    });
    send(res, org);
  }),
);

/** PATCH /org/jit — update JIT provisioning config (superadmin only) */
orgRouter.patch(
  '/jit',
  requirePermission('sso.manage'),
  asyncHandler(async (req, res) => {
    const org = await orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');

    const { jitEnabled, jitDefaultRole } = req.body as {
      jitEnabled?: unknown;
      jitDefaultRole?: unknown;
    };

    if (typeof jitEnabled !== 'boolean') {
      throw new ValidationError('jitEnabled must be a boolean');
    }
    if (jitDefaultRole !== 'employee' && jitDefaultRole !== 'admin') {
      throw new ValidationError('jitDefaultRole must be "employee" or "admin"');
    }

    const updated = await orgRepo.updateJitConfig(org.id, { jitEnabled, jitDefaultRole });

    if (req.user) {
      const actor = actorFromRequest(req.user, req.ip);
      const eventType =
        jitEnabled !== org.jitEnabled
          ? jitEnabled
            ? 'org.jit_enabled'
            : 'org.jit_disabled'
          : 'org.updated';
      await auditSvc.orgEvent(
        eventType,
        actor,
        org.id,
        { jitEnabled: org.jitEnabled, jitDefaultRole: org.jitDefaultRole },
        { jitEnabled: updated.jitEnabled, jitDefaultRole: updated.jitDefaultRole },
      );
    }

    send(res, updated);
  }),
);
