import type { Request, Response } from 'express';
import { send } from '../../lib/respond';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { sendMailboxRemovedEmail } from '../../lib/mailer';
import { actorFromRequest, AuditService } from '../audit/audit.service';
import { createAuditRepository } from '../audit/audit.repository';
import { createAlertRepository } from '../alerts/alert.repository';
import { AlertService } from '../alerts/alert.service';
import { collectorService } from '../../services/collector.service';
import { parseCreateMailboxDto, parseUpdateMailboxSyncConfigDto } from './mailbox.schema';
import type { MailboxRepository } from './mailbox.repository';
import type { MailboxPhotoRepository } from './mailbox-photo.repository';
import type { OrgRepository } from '../organizations/org.repository';

const DEFAULT_PAGE_LIMIT = 100;
const auditSvc = new AuditService(createAuditRepository());
const alertsSvc = new AlertService(createAlertRepository());

export class MailboxController {
  constructor(
    private readonly mailboxRepo: MailboxRepository,
    private readonly orgRepo: OrgRepository,
    private readonly photoRepo?: MailboxPhotoRepository,
  ) {}

  listAll = async (req: Request, res: Response): Promise<void> => {
    const limit = Math.min(Number(req.query['limit']) || DEFAULT_PAGE_LIMIT, 500);
    const offset = Math.max(Number(req.query['offset']) || 0, 0);
    const mailboxes = await this.mailboxRepo.findAll({ limit, offset });
    send(res, mailboxes);
  };

  /** Returns the mailbox's profile photo as a Base64 data URI, or null if none. */
  getPhoto = async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'];
    if (!id) throw new ValidationError('Mailbox id is required');
    const photo = this.photoRepo ? await this.photoRepo.findByMailboxId(id) : null;
    send(res, photo ? `data:${photo.contentType};base64,${photo.data}` : null);
  };

  create = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    const dto = parseCreateMailboxDto(req.body);

    const org = await this.orgRepo.findFirst();
    if (!org) throw new NotFoundError('Organization not configured yet');

    // Verify the mailbox address domain belongs to the org's configured domains.
    const addressDomain = dto.address.split('@')[1]?.toLowerCase();
    const orgDomains = org.domains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (!addressDomain || !orgDomains.includes(addressDomain)) {
      throw new ValidationError(
        `Address domain "${addressDomain}" is not in the organisation's allowed domains: ${orgDomains.join(', ')}`,
      );
    }

    const mailbox = await this.mailboxRepo.create({
      orgId: org.id,
      address: dto.address,
      provider: dto.provider,
    });
    send(res, mailbox, 'OK', 201);
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const mailbox = await this.mailboxRepo.findById(id);
    if (!mailbox) throw new NotFoundError(`Mailbox ${id} not found`);
    send(res, mailbox);
  };

  updateSyncConfig = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    const { id } = req.params;
    const existing = await this.mailboxRepo.findById(id);
    if (!existing) throw new NotFoundError(`Mailbox ${id} not found`);

    const dto = parseUpdateMailboxSyncConfigDto(req.body);
    const updated = await this.mailboxRepo.updateSyncConfig(id, dto);

    await auditSvc.mailboxEvent(
      'mailbox.updated',
      actorFromRequest(req.user, req.ip),
      id,
      {
        syncEnabled: existing.syncEnabled,
        syncPriority: existing.syncPriority,
        syncFromDate: existing.syncFromDate,
      },
      {
        syncEnabled: updated.syncEnabled,
        syncPriority: updated.syncPriority,
        syncFromDate: updated.syncFromDate,
      },
    );

    send(res, updated);
  };

  /** POST /mailboxes/probe — queue a probe run for all or specified mailboxes. */
  triggerProbe = async (req: Request, res: Response): Promise<void> => {
    const { mailboxIds } = req.body as { mailboxIds?: unknown };
    const ids = Array.isArray(mailboxIds)
      ? (mailboxIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined;

    try {
      const queued = await collectorService.triggerProbe(ids);

      if (ids?.length && queued === 0) {
        throw new ValidationError(
          'Could not queue a probe for the selected mailbox(es) — a probe may already be running.',
        );
      }

      if (req.user) {
        const actor = actorFromRequest(req.user, req.ip);
        await auditSvc.mailboxEvent(
          'mailbox.probe_triggered',
          actor,
          ids?.join(',') ?? 'all',
          null,
          { mailboxIds: ids ?? null, queued },
        );
      }
      send(res, { message: `Probe queued for ${queued} mailbox(es)`, queued }, 'OK', 202);
    } catch (err: unknown) {
      const org = await this.orgRepo.findFirst();
      if (org) {
        const message =
          err instanceof ValidationError
            ? err.message
            : 'An unexpected error occurred while triggering the probe.';
        await alertsSvc.record({
          orgId: org.id,
          severity: 'warning',
          category: 'Probe',
          title: 'Probe failed to start',
          description: message,
          source: req.user?.email ?? 'System',
          mailboxId: ids?.length === 1 ? ids[0]! : null,
        });
      }
      throw err;
    }
  };

  /** POST /mailboxes/probe/cancel — stop any pending/in-flight probe jobs. */
  cancelProbe = async (req: Request, res: Response): Promise<void> => {
    const cancelled = await collectorService.cancelProbe();

    if (req.user) {
      const actor = actorFromRequest(req.user, req.ip);
      await auditSvc.mailboxEvent('mailbox.probe_cancelled', actor, 'all', null, { cancelled });
    }

    send(res, { message: `Probe cancelled. ${cancelled} job(s) stopped.`, cancelled });
  };

  /** GET /mailboxes/probe/status — current probe progress across all mailboxes. */
  probeStatus = async (_req: Request, res: Response): Promise<void> => {
    const all = await this.mailboxRepo.findAll();
    const counts = { not_started: 0, pending: 0, running: 0, complete: 0, error: 0 };
    for (const m of all) {
      const key = m.probeStatus as keyof typeof counts;
      if (key in counts) counts[key]++;
    }
    send(res, {
      total: all.length,
      probed: counts.complete + counts.error,
      pending: counts.pending + counts.running,
      byStatus: counts,
      mailboxes: all.map((m) => ({
        id: m.id,
        address: m.address,
        provider: m.provider,
        probeStatus: m.probeStatus,
        earliestEmailAt: m.earliestEmailAt,
        emailCountEstimate: m.emailCountEstimate,
      })),
    });
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    const { id } = req.params;
    const existing = await this.mailboxRepo.findById(id);
    if (!existing) throw new NotFoundError(`Mailbox ${id} not found`);
    await this.mailboxRepo.delete(id);

    // Send admin alert (best-effort).
    const org = await this.orgRepo.findFirst();
    if (org) {
      sendMailboxRemovedEmail(org.adminEmail, existing.address, org.name).catch((err) =>
        logger.warn({ err }, 'Failed to send mailbox-removed admin alert'),
      );
    }

    await auditSvc.mailboxEvent(
      'mailbox.deleted',
      actorFromRequest(req.user, req.ip),
      id,
      { address: existing.address, provider: existing.provider },
      null,
    );
    send(res, { message: 'Mailbox removed' });
  };
}
