import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { sendAccountDeactivatedEmail, sendAccountReactivatedEmail } from '../../lib/mailer';
import { config } from '../../config/env';
import type { AuditActor, AuditService } from '../audit/audit.service';
import type { MailboxRepository } from '../mailboxes/mailbox.repository';
import type { OrgRepository } from '../organizations/org.repository';
import type { SessionStore } from '../../lib/session-store';
import type { UserRepository } from './user.repository';
import type { CreateUserInput, User } from './user.types';
import type { UpdateUserDto } from './user.schema';

export class UserService {
  constructor(
    private readonly repo: UserRepository,
    private readonly mailboxRepo?: MailboxRepository,
    private readonly audit?: AuditService,
    private readonly sessions?: SessionStore,
    private readonly orgRepo?: OrgRepository,
  ) {}

  /** isOnline reflects whether the user currently holds at least one live (non-expired) login session. */
  async listUsers(): Promise<Array<User & { isOnline: boolean }>> {
    const users = await this.repo.findAll();
    if (!this.sessions) return users.map((u) => ({ ...u, isOnline: false }));

    return Promise.all(
      users.map(async (u) => ({
        ...u,
        isOnline: (await this.sessions!.listByUser(u.id)).length > 0,
      })),
    );
  }

  async getUser(id: string): Promise<User> {
    const user = await this.repo.findById(id);
    if (!user) {
      throw new NotFoundError(`User ${id} not found`);
    }
    return user;
  }

  async createUser(input: CreateUserInput, actor?: AuditActor): Promise<User> {
    const existing = await this.repo.findByEmail(input.email.toLowerCase());
    if (existing) {
      throw new ConflictError(`A user with email ${input.email} already exists`);
    }

    if (input.role === 'employee' && this.mailboxRepo) {
      const count = await this.mailboxRepo.count();
      if (count === 0) {
        throw new ForbiddenError(
          'Connect an email provider before adding employees. No mailboxes are configured.',
        );
      }
    }

    const created = await this.repo.create(input);

    if (actor) {
      await this.audit?.userEvent('user.created', actor, created.id, null, {
        email: created.email,
        displayName: created.displayName,
        role: created.role,
      });
    }

    return created;
  }

  async cancelInvite(id: string, actor?: AuditActor): Promise<void> {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundError(`User ${id} not found`);
    if (user.status !== 'invited')
      throw new ForbiddenError('Only pending invitations can be cancelled');

    await this.repo.deleteById(id);

    if (actor) {
      await this.audit?.userEvent('user.invite_cancelled', actor, id, { status: 'invited' }, null);
    }
  }

  async inviteUser(input: CreateUserInput, actor?: AuditActor): Promise<User> {
    const existing = (await this.repo.findByEmail(input.email.toLowerCase())) as
      | (User & { passwordHash?: string | null })
      | null;

    if (existing) {
      // Safe to re-invite when there's no active account state to clobber:
      // either auto-created from a mailbox import and never logged in, or a
      // previously deactivated account — a deactivated email should be free
      // to invite again, not permanently blocked as "already exists".
      const canReinvite =
        (existing.passwordHash === null && existing.status === 'active') ||
        existing.status === 'inactive';

      if (canReinvite) {
        const invited = await this.repo.updateUser(existing.id, {
          status: 'invited',
          displayName: input.displayName ?? existing.displayName,
          role: input.role ?? existing.role,
        });
        if (actor) {
          await this.audit?.userEvent(
            'user.invited',
            actor,
            existing.id,
            { status: existing.status },
            { status: 'invited', email: invited.email, displayName: invited.displayName },
          );
        }
        return invited;
      }
      throw new ConflictError(`A user with email ${input.email} already exists`);
    }

    const invited = await this.repo.create({ ...input, status: 'invited' });

    if (actor) {
      await this.audit?.userEvent('user.invited', actor, invited.id, null, {
        email: invited.email,
        displayName: invited.displayName,
        role: invited.role,
      });
    }

    return invited;
  }

  async inviteEmployee(email: string, actor?: AuditActor): Promise<User> {
    const mailbox = await this.mailboxRepo?.findByAddress(email.toLowerCase());
    const localPart = email.split('@')[0];
    const displayName =
      mailbox?.displayName?.trim() ||
      localPart
        .split(/[._-]+/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(' ');
    const invited = await this.inviteUser(
      { email, displayName: displayName || email, role: 'employee' },
      actor,
    );
    if (mailbox && mailbox.ownerUserId !== invited.id) {
      await this.mailboxRepo?.linkOwner(mailbox.id, invited.id);
    }
    return invited;
  }

  async deactivateUser(id: string, actor?: AuditActor): Promise<User> {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundError(`User ${id} not found`);
    if (user.role === 'superadmin')
      throw new ForbiddenError('The superadmin account cannot be deactivated.');
    if (user.status === 'inactive') return user; // idempotent

    const updated = await this.repo.updateUser(id, { status: 'inactive' });

    // Revoke all active sessions immediately so the user is kicked out now.
    if (this.sessions) {
      const activeSessions = await this.sessions.listByUser(id);
      await Promise.all(activeSessions.map((s) => this.sessions!.del(s.sessionId)));
    }

    sendAccountDeactivatedEmail(user.email, user.displayName).catch((err) =>
      logger.warn({ err }, 'Failed to send account-deactivated email'),
    );

    if (actor) {
      await this.audit?.userEvent(
        'user.deactivated',
        actor,
        id,
        { status: user.status },
        { status: 'inactive' },
      );
    }

    return updated;
  }

  async reactivateUser(id: string, actor?: AuditActor): Promise<User> {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundError(`User ${id} not found`);
    if (user.status === 'active') return user; // idempotent

    const updated = await this.repo.updateUser(id, { status: 'active' });

    sendAccountReactivatedEmail(user.email, user.displayName, config.server.corsOrigin).catch(
      (err) => logger.warn({ err }, 'Failed to send account-reactivated email'),
    );

    if (actor) {
      await this.audit?.userEvent(
        'user.reactivated',
        actor,
        id,
        { status: user.status },
        { status: 'active' },
      );
    }

    return updated;
  }

  async createUserFromMailbox(mailboxId: string, actor?: AuditActor): Promise<User> {
    if (!this.mailboxRepo) throw new Error('Mailbox repository not available');

    const mailbox = await this.mailboxRepo.findById(mailboxId);
    if (!mailbox) throw new NotFoundError(`Mailbox ${mailboxId} not found`);

    const email = mailbox.address.toLowerCase();
    const existing = await this.repo.findByEmail(email);

    if (existing) {
      // User already exists — just ensure the mailbox is linked and return them
      if (!mailbox.ownerUserId) {
        await this.mailboxRepo.linkOwner(mailboxId, existing.id);
      }
      return existing;
    }

    const created = await this.repo.create({
      email,
      displayName: mailbox.displayName ?? mailbox.address,
      role: 'employee',
    });

    await this.mailboxRepo.linkOwner(mailboxId, created.id);

    if (actor) {
      await this.audit?.userEvent('user.created', actor, created.id, null, {
        email: created.email,
        displayName: created.displayName,
        role: created.role,
        source: 'mailbox',
      });
    }

    return created;
  }

  async updateUser(id: string, dto: UpdateUserDto, actor?: AuditActor): Promise<User> {
    const before = await this.repo.findById(id);
    if (!before) throw new NotFoundError(`User ${id} not found`);

    // Superadmin role cannot be assigned or removed via this endpoint.
    if (dto.role && (dto.role === 'superadmin' || before.role === 'superadmin')) {
      throw new ForbiddenError('The superadmin role cannot be changed.');
    }

    if (dto.email && dto.email.toLowerCase() !== before.email.toLowerCase()) {
      // Validate the new email's domain against the org's allowed domains.
      if (this.orgRepo) {
        const org = await this.orgRepo.findFirst();
        if (org) {
          const emailDomain = dto.email.split('@')[1]?.toLowerCase() ?? '';
          const allowedDomains = org.domains
            .split(',')
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean);
          if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain)) {
            throw new ValidationError(
              `Email domain "${emailDomain}" is not in the organisation's allowed domains: ${allowedDomains.join(', ')}`,
            );
          }
        }
      }

      const existing = await this.repo.findByEmail(dto.email.toLowerCase());
      if (existing && existing.id !== id) {
        throw new ConflictError(`Email ${dto.email} is already taken`);
      }
    }

    const after = await this.repo.updateUser(id, dto);

    if (actor) {
      const eventType =
        dto.role && dto.role !== before.role
          ? 'user.role_changed'
          : dto.email && dto.email !== before.email
            ? 'user.email_changed'
            : 'user.display_name_changed';

      await this.audit?.userEvent(
        eventType,
        actor,
        id,
        { email: before.email, displayName: before.displayName, role: before.role },
        { email: after.email, displayName: after.displayName, role: after.role },
      );
    }

    return after;
  }
}
