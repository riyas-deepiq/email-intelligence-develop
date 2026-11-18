import type { Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../lib/errors';
import { sendItem, sendList } from '../../lib/respond';
import { sendInviteEmail } from '../../lib/mailer';
import { config } from '../../config/env';
import { PRODUCT_NAME } from '../../config/brand';
import { logger } from '../../lib/logger';
import { actorFromRequest } from '../audit/audit.service';
import type { AuthService } from '../auth/auth.service';
import { parseCreateUserDto, parseInviteUserDto, parseUpdateUserDto } from './user.schema';
import type { UserService } from './user.service';
import type { OrgRepository } from '../organizations/org.repository';
import { isEmailDomainAllowed, parseOrgDomains } from '../organizations/org-domains';

export class UserController {
  constructor(
    private readonly service: UserService,
    private readonly authService?: AuthService,
    private readonly orgRepo?: OrgRepository,
  ) {}

  private async deliverInvite(user: { id: string; email: string; displayName: string }): Promise<boolean> {
    if (!this.authService) return false;
    try {
      const token = await this.authService.generateInviteToken(user.id);
      const orgName = (await this.orgRepo?.findFirst())?.name ?? PRODUCT_NAME;
      const link = `${config.server.corsOrigin}/accept-invite?token=${token}`;
      return await sendInviteEmail(user.email, user.displayName, link, orgName);
    } catch (err) {
      logger.warn({ err, userId: user.id }, 'Failed to send invitation email');
      return false;
    }
  }

  /**
   * Rejects an email whose domain is not in the organisation's allowed-domains
   * list. Only users from the configured org domains may be added to the platform.
   */
  private async assertEmailDomainAllowed(email: string): Promise<void> {
    const org = await this.orgRepo?.findFirst();
    if (org && !isEmailDomainAllowed(email, org.domains)) {
      throw new ValidationError(
        `Email domain is not allowed. Users must belong to one of the organisation's domains: ${parseOrgDomains(org.domains).join(', ')}`,
      );
    }
  }

  list = async (_req: Request, res: Response): Promise<void> => {
    const users = await this.service.listUsers();
    sendList(res, users, 'Users fetched'); // { count, message, data }
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const user = await this.service.getUser(req.params.id);
    sendItem(res, user, 'User fetched'); // { message, data }
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const dto = parseCreateUserDto(req.body);
    await this.assertEmailDomainAllowed(dto.email);
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const user = await this.service.createUser(dto, actor);
    sendItem(res, user, 'User created', 201);
  };

  update = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    const canManageUsers = req.user.permissions.includes('users.manage');
    if (!canManageUsers && req.user.id !== req.params.id) {
      throw new ForbiddenError('You can only update your own profile');
    }
    const dto = parseUpdateUserDto(req.body);
    const actor = actorFromRequest(req.user, req.ip);
    const user = await this.service.updateUser(req.params.id, dto, actor);
    sendItem(res, user, 'User updated');
  };

  invite = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    const dto = parseInviteUserDto(req.body);
    await this.assertEmailDomainAllowed(dto.email);
    const actor = actorFromRequest(req.user, req.ip);

    const invited = await this.service.inviteEmployee(dto.email, actor);
    const emailSent = await this.deliverInvite(invited);
    sendItem(
      res,
      { user: invited, emailSent },
      emailSent ? 'User invited' : 'User invited, but the email could not be sent',
      201,
    );
  };

  resendInvite = async (req: Request, res: Response): Promise<void> => {
    const invited = await this.service.getUser(req.params.id);
    if (invited.status !== 'invited') {
      throw new ForbiddenError('Only pending invitations can be resent');
    }
    const emailSent = await this.deliverInvite(invited);
    sendItem(
      res,
      { emailSent },
      emailSent ? 'Invitation resent' : 'Invitation email could not be sent',
    );
  };

  createFromMailbox = async (req: Request, res: Response): Promise<void> => {
    const { mailboxId } = req.body as { mailboxId?: unknown };
    if (typeof mailboxId !== 'string' || !mailboxId.trim()) {
      throw new ValidationError('mailboxId is required');
    }
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const user = await this.service.createUserFromMailbox(mailboxId.trim(), actor);
    sendItem(res, user, 'User created', 201);
  };

  deactivate = async (req: Request, res: Response): Promise<void> => {
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const user = await this.service.deactivateUser(req.params.id, actor);
    sendItem(res, user, 'User deactivated');
  };

  reactivate = async (req: Request, res: Response): Promise<void> => {
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const user = await this.service.reactivateUser(req.params.id, actor);
    sendItem(res, user, 'User reactivated');
  };

  cancelInvite = async (req: Request, res: Response): Promise<void> => {
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    await this.service.cancelInvite(req.params.id, actor);
    sendItem(res, null, 'Invitation cancelled');
  };
}
