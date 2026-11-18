import { randomUUID } from 'node:crypto';
import { PRODUCT_NAME } from '../../config/brand';
import { config } from '../../config/env';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getDeviceName } from '../../lib/device-name';
import {
  sendPasswordChangedEmail,
  sendPasswordResetConfirmEmail,
  sendPasswordResetEmail,
  sendWelcomeAfterActivationEmail,
  sendWelcomeEmail,
} from '../../lib/mailer';
import { hashPassword, verifyPassword } from '../../lib/password';
import { newSessionId, type SessionStore } from '../../lib/session-store';
import { collectorService } from '../../services/collector.service';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/token';
import type { AuditService } from '../audit/audit.service';
import type { MailboxRepository } from '../mailboxes/mailbox.repository';
import type { OrgRepository } from '../organizations/org.repository';
import { resolvePermissionsForSubject } from '../roles/permission-resolver';
import type { RoleRepository } from '../roles/role.repository';
import { isEmailDomainAllowed, parseOrgDomains } from '../organizations/org-domains';
import type { UserRepository } from '../users/user.repository';
import type { User } from '../users/user.types';
import type {
  LoginRequest,
  LoginResponse,
  SetupRequest,
  SetupResponse,
  TokenPair,
} from './auth.types';

const PWRESET_TTL_SEC = 60 * 60; // 1 hour
const INVITE_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export class AuthService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly sessions: SessionStore,
    private readonly orgRepo?: OrgRepository,
    private readonly audit?: AuditService,
    private readonly mailboxRepo?: MailboxRepository,
    private readonly roleRepo?: RoleRepository,
  ) {}

  async login(req: LoginRequest, ipAddress?: string, userAgent?: string): Promise<LoginResponse> {
    const user = await this.userRepo.findByEmail(req.email);

    const noAccountActor = {
      actorId: null,
      actorEmail: req.email,
      actorRole: 'unauthenticated',
      ipAddress,
    };

    if (!user) {
      await this.audit?.authEvent('auth.login_failed', noAccountActor, req.email, {
        newValue: { reason: 'user_not_found' },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    const storedHash = (user as { passwordHash?: string }).passwordHash;
    if (!storedHash) {
      await this.audit?.authEvent('auth.login_failed', noAccountActor, user.id, {
        newValue: { reason: 'no_native_password' },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    const valid = await verifyPassword(storedHash, req.password);
    if (!valid) {
      await this.audit?.authEvent('auth.login_failed', noAccountActor, user.id, {
        newValue: { reason: 'invalid_password' },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    // Reject deactivated accounts after credential check (don't leak account existence).
    if (user.status === 'inactive') {
      await this.audit?.authEvent('auth.login_failed', noAccountActor, user.id, {
        newValue: { reason: 'account_inactive' },
      });
      throw new UnauthorizedError('Your account has been deactivated. Contact your administrator.');
    }

    const sessionId = newSessionId();
    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.displayName,
      user.role,
      sessionId,
      userAgent,
    );

    const updated = await this.userRepo.updateUser(user.id, {
      lastLoginAt: new Date(),
      status: user.status === 'invited' ? 'active' : undefined,
    });

    const isFirstLogin = user.status === 'pending_setup' && user.role === 'superadmin';

    await this.audit?.authEvent(
      'auth.login',
      { actorId: user.id, actorEmail: user.email, actorRole: user.role, sessionId, ipAddress },
      user.id,
      { newValue: { provider: 'native' } },
    );

    const mailbox = await this.mailboxRepo?.findByAddress(user.email);
    if (mailbox?.id) void collectorService.triggerInitialSyncIfNeeded(mailbox.id);

    return {
      user: {
        id: user.id,
        email: updated.email,
        displayName: updated.displayName,
        role: updated.role,
        roleId: updated.roleId,
        roleName: updated.roleName,
        permissions: await this.permissionsForUser(updated),
        mailboxId: mailbox?.id ?? null,
      },
      tokens,
      ...(isFirstLogin && { isFirstLogin: true }),
    };
  }

  async setup(
    userId: string,
    sessionId: string,
    req: SetupRequest,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<SetupResponse> {
    const existing = await this.userRepo.findByIdInternal(userId);
    if (!existing) throw new NotFoundError('User not found');
    if (existing.status !== 'pending_setup') {
      throw new ForbiddenError('Setup has already been completed');
    }

    if (!isEmailDomainAllowed(req.email, req.domains)) {
      throw new ValidationError(
        `Admin email domain must match one of the organisation's domains: ${parseOrgDomains(req.domains).join(', ')}`,
      );
    }

    const passwordHash = await hashPassword(req.newPassword);
    const updated = await this.userRepo.updateUser(userId, {
      passwordHash,
      email: req.email,
      status: 'active',
      lastLoginAt: new Date(),
    });

    let orgId = '';
    if (this.orgRepo) {
      const org = await this.orgRepo.upsert({
        name: req.companyName,
        domains: req.domains,
        adminEmail: req.email,
      });
      orgId = org.id;
    }

    // Fire-and-forget — don't fail setup if mail delivery fails.
    sendWelcomeEmail(req.companyName, req.domains, req.email).catch((err) =>
      logger.warn({ err }, 'Failed to send setup welcome email'),
    );

    const actor = {
      actorId: userId,
      actorEmail: req.email,
      actorRole: 'superadmin',
      sessionId,
      ipAddress,
    };

    await this.audit?.authEvent('auth.setup_completed', actor, userId, {
      newValue: {
        companyName: req.companyName,
        domains: req.domains,
        adminEmail: req.email,
        orgId,
      },
    });

    // Revoke the pre-setup session so the old access token cannot be reused.
    await this.sessions.del(sessionId);
    const freshSession = newSessionId();
    const tokens = await this.issueTokens(
      updated.id,
      updated.email,
      updated.displayName,
      updated.role,
      freshSession,
      userAgent,
    );

    return {
      tokens,
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        role: updated.role,
        roleId: updated.roleId,
        roleName: updated.roleName,
        permissions: await this.permissionsForUser(updated),
        mailboxId: null,
      },
    };
  }

  async getMe(userId: string, role: string): Promise<{ isFirstLogin: boolean }> {
    if (role !== 'superadmin') return { isFirstLogin: false };
    const user = await this.userRepo.findByIdInternal(userId);
    return { isFirstLogin: user?.status === 'pending_setup' };
  }

  async refresh(refreshToken: string, userAgent?: string): Promise<TokenPair> {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const userId = await this.sessions.get(payload.sessionId);
    if (!userId || userId !== payload.sub) {
      throw new UnauthorizedError('Session not found or revoked');
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user || user.status === 'inactive') {
      await this.sessions.del(payload.sessionId);
      throw new UnauthorizedError('Your account has been deactivated. Contact your administrator.');
    }

    // Rotate: delete old session, issue new pair.
    await this.sessions.del(payload.sessionId);
    const newSession = newSessionId();
    // payload.displayName may be absent on tokens issued before the field was added.
    return this.issueTokens(
      user.id,
      user.email,
      user.displayName,
      user.role,
      newSession,
      userAgent,
    );
  }

  async logout(
    sessionId: string,
    actor?: { id: string; email: string; role: string },
    ipAddress?: string,
  ): Promise<void> {
    await this.sessions.del(sessionId);
    if (actor) {
      await this.audit?.authEvent(
        'auth.logout',
        { actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, sessionId, ipAddress },
        actor.id,
      );
    }
  }

  async verifySession(sessionId: string, userId: string): Promise<boolean> {
    const stored = await this.sessions.get(sessionId);
    return stored === userId;
  }

  // Password reset

  async forgotPassword(email: string, ipAddress?: string): Promise<void> {
    const user = await this.userRepo.findByEmail(email);
    if (!user) return; // silently ignore — don't reveal whether the email exists

    const token = randomUUID();
    await this.sessions.set(`pwreset:${token}`, user.id, PWRESET_TTL_SEC);

    const frontendUrl = config.server.corsOrigin;
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    // Fire-and-forget — never fail the request if mail delivery fails.
    sendPasswordResetEmail(user.email, resetLink).catch((err) =>
      logger.warn({ err }, 'Failed to send password reset email'),
    );

    await this.audit?.authEvent(
      'auth.password_reset_requested',
      { actorId: user.id, actorEmail: user.email, actorRole: user.role, ipAddress },
      user.id,
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.sessions.get(`pwreset:${token}`);
    if (!userId) throw new UnauthorizedError('Reset link is invalid or has expired');

    const user = await this.userRepo.findByIdInternal(userId);
    if (!user) throw new NotFoundError('User not found');

    const passwordHash = await hashPassword(newPassword);
    await this.userRepo.updateUser(userId, { passwordHash });
    await this.sessions.del(`pwreset:${token}`); // consume token — one-time use

    sendPasswordResetConfirmEmail(user.email).catch((err) =>
      logger.warn({ err }, 'Failed to send password reset confirmation email'),
    );

    await this.audit?.authEvent(
      'auth.password_reset',
      { actorId: userId, actorEmail: user.email, actorRole: user.role },
      userId,
    );
  }

  // Change password (authenticated)

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    sessionId: string,
    ipAddress?: string,
  ): Promise<void> {
    const user = await this.userRepo.findByIdWithHash(userId);
    if (!user) throw new NotFoundError('User not found');

    if (!user.passwordHash) {
      throw new ForbiddenError('This account uses SSO — password cannot be changed here');
    }

    const valid = await verifyPassword(user.passwordHash, currentPassword);
    if (!valid) throw new UnauthorizedError('Current password is incorrect');

    const passwordHash = await hashPassword(newPassword);
    await this.userRepo.updateUser(userId, { passwordHash });

    sendPasswordChangedEmail(user.email).catch((err) =>
      logger.warn({ err }, 'Failed to send password changed email'),
    );

    await this.audit?.authEvent(
      'auth.password_changed',
      { actorId: userId, actorEmail: user.email, actorRole: user.role, sessionId, ipAddress },
      userId,
    );
  }

  // Session management

  async listSessions(
    userId: string,
  ): Promise<Array<{ sessionId: string; expiresAt: string; deviceName: string }>> {
    const rows = await this.sessions.listByUser(userId);
    return rows.map((r, index) => ({
      sessionId: r.sessionId,
      expiresAt: r.expiresAt.toISOString(),
      deviceName: r.deviceName ?? getDeviceName(r.userAgent) ?? `Unknown device ${index + 1}`,
    }));
  }

  async revokeSession(
    requestingUserId: string,
    targetSessionId: string,
    ipAddress?: string,
  ): Promise<void> {
    const owner = await this.sessions.get(targetSessionId);
    if (!owner || owner !== requestingUserId) {
      throw new NotFoundError('Session not found');
    }
    await this.sessions.del(targetSessionId);

    const user = await this.userRepo.findById(requestingUserId);
    if (user) {
      await this.audit?.authEvent(
        'auth.session_revoked',
        { actorId: requestingUserId, actorEmail: user.email, actorRole: user.role, ipAddress },
        requestingUserId,
        { newValue: { revokedSessionId: targetSessionId } },
      );
    }
  }

  // Invite token

  /** Generate a one-time invite token for a newly created user. */
  async generateInviteToken(userId: string): Promise<string> {
    const token = randomUUID();
    await this.sessions.set(`invite:${token}`, userId, INVITE_TTL_SEC);
    return token;
  }

  /** Verify + consume an invite token. Returns the userId. */
  async acceptInvite(
    token: string,
    newPassword: string,
    userAgent?: string,
  ): Promise<LoginResponse> {
    const userId = await this.sessions.get(`invite:${token}`);
    if (!userId) throw new UnauthorizedError('Invite link is invalid or has expired');

    const user = await this.userRepo.findByIdInternal(userId);
    if (!user) throw new NotFoundError('User not found');
    if (user.status !== 'invited') throw new UnauthorizedError('Invite has already been accepted');

    const passwordHash = await hashPassword(newPassword);
    const updated = await this.userRepo.updateUser(userId, {
      passwordHash,
      status: 'active',
      lastLoginAt: new Date(),
    });
    await this.sessions.del(`invite:${token}`);

    // Look up org name for the welcome email (best-effort, no org = generic name).
    const orgName = this.orgRepo
      ? ((await this.orgRepo.findFirst())?.name ?? PRODUCT_NAME)
      : PRODUCT_NAME;
    const loginUrl = config.server.corsOrigin;

    sendWelcomeAfterActivationEmail(updated.email, updated.displayName, orgName, loginUrl).catch(
      (err) => logger.warn({ err }, 'Failed to send welcome-after-activation email'),
    );

    await this.audit?.userEvent(
      'user.invite_accepted',
      { actorId: userId, actorEmail: updated.email, actorRole: updated.role },
      userId,
      { status: 'invited' },
      { status: 'active' },
    );

    const sessionId = newSessionId();
    const tokens = await this.issueTokens(
      updated.id,
      updated.email,
      updated.displayName,
      updated.role,
      sessionId,
      userAgent,
    );
    const mailbox = await this.mailboxRepo?.findByAddress(updated.email);
    return {
      tokens,
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        role: updated.role,
        roleId: updated.roleId,
        roleName: updated.roleName,
        permissions: await this.permissionsForUser(updated),
        mailboxId: mailbox?.id ?? null,
      },
    };
  }

  private permissionsForUser(user: Pick<User, 'role' | 'roleId'>): Promise<string[]> {
    return resolvePermissionsForSubject(this.roleRepo, user);
  }

  private async issueTokens(
    userId: string,
    email: string,
    displayName: string,
    role: string,
    sessionId: string,
    userAgent?: string,
  ): Promise<TokenPair> {
    const jwtPayload = { sub: userId, email, displayName, role, sessionId };

    // Access token — short-lived, used by the client on every request.
    const accessToken = signAccessToken(jwtPayload);

    // Refresh token — long-lived, carries the same sessionId so refresh() can validate it
    // against the session store without a separate lookup key.
    const refreshToken = signRefreshToken(jwtPayload);

    await this.sessions.set(sessionId, userId, config.auth.refreshTokenTtlSec, {
      deviceName: getDeviceName(userAgent),
      userAgent: userAgent ?? null,
    });

    return { accessToken, refreshToken, expiresIn: config.auth.jwtExpiresIn };
  }
}
