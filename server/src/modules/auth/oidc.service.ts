import { randomUUID } from 'node:crypto';
import { config } from '../../config/env';
import { UnauthorizedError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { sendJitProvisionedEmail } from '../../lib/mailer';
import { newSessionId, type SessionStore } from '../../lib/session-store';
import { collectorService } from '../../services/collector.service';
import { signAccessToken, signRefreshToken } from '../../lib/token';
import type { AuditService } from '../audit/audit.service';
import type { AuthProviderRepository } from '../auth-providers/auth-provider.repository';
import type { ProviderType } from '../auth-providers/auth-provider.types';
import type { MailboxRepository } from '../mailboxes/mailbox.repository';
import type { OrgRepository } from '../organizations/org.repository';
import { resolvePermissionsForSubject } from '../roles/permission-resolver';
import type { RoleRepository } from '../roles/role.repository';
import type { UserRepository } from '../users/user.repository';
import type { User } from '../users/user.types';
import type { TokenPair } from './auth.types';

// TTLs for transient OIDC keys stored in the session store.
const OIDC_STATE_TTL_SEC = 5 * 60; // 5 minutes
const OIDC_CODE_TTL_SEC = 30; // 30 seconds

interface OidcStateData {
  provider: ProviderType;
  nonce: string;
}
interface OidcCodeData {
  tokens: TokenPair;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    roleId: string | null;
    roleName: string | null;
    permissions: string[];
    mailboxId: string | null;
  };
}

type IdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  sub: string;
};

function validateIdTokenClaims(
  payload: IdTokenPayload,
  nonce: string,
  clientId: string,
  expectedIssuers: string[],
): void {
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp !== undefined && payload.exp < now) {
    throw new UnauthorizedError('id_token has expired');
  }
  if (payload.nonce !== nonce) {
    throw new UnauthorizedError('id_token nonce mismatch — possible replay attack');
  }
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) {
    throw new UnauthorizedError('id_token audience does not match our client_id');
  }
  if (payload.iss && expectedIssuers.length > 0 && !expectedIssuers.includes(payload.iss)) {
    throw new UnauthorizedError(`id_token issuer "${payload.iss}" is not in the trusted list`);
  }
}

export class OidcService {
  constructor(
    private readonly authProviderRepo: AuthProviderRepository,
    private readonly userRepo: UserRepository,
    private readonly sessions: SessionStore,
    private readonly orgRepo: OrgRepository,
    private readonly audit?: AuditService,
    private readonly mailboxRepo?: MailboxRepository,
    private readonly roleRepo?: RoleRepository,
  ) {}

  /** Public: which OIDC providers are enabled (for the login page). */
  async getEnabledProviders(): Promise<{ provider: ProviderType }[]> {
    const all = await this.authProviderRepo.findAll();
    return all
      .filter((p) => p.enabled && p.provider !== 'email_password')
      .map((p) => ({ provider: p.provider }));
  }

  /**
   * Build the provider's authorization URL and return it.
   * The caller (controller) should redirect the browser there.
   */
  async buildAuthorizationUrl(provider: ProviderType): Promise<string> {
    const ap = await this.authProviderRepo.findWithSecret(provider);
    if (!ap?.enabled || !ap.clientId || !ap.redirectUri) {
      throw new Error(`Provider '${provider}' is not enabled or not fully configured`);
    }

    const state = randomUUID();
    const nonce = randomUUID();
    await this.sessions.set(
      `oidc:state:${state}`,
      JSON.stringify({ provider, nonce } satisfies OidcStateData),
      OIDC_STATE_TTL_SEC,
    );

    if (provider === 'm365') {
      if (!ap.tenantId) throw new Error('tenantId is required for Microsoft 365');
      const base = `https://login.microsoftonline.com/${ap.tenantId}/oauth2/v2.0/authorize`;
      return `${base}?${new URLSearchParams({
        client_id: ap.clientId,
        response_type: 'code',
        redirect_uri: ap.redirectUri,
        scope: 'openid profile email',
        state,
        nonce,
        response_mode: 'query',
      })}`;
    }

    if (provider === 'google') {
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: ap.clientId,
        response_type: 'code',
        redirect_uri: ap.redirectUri,
        scope: 'openid profile email',
        state,
        nonce,
        access_type: 'offline',
        prompt: 'select_account',
      })}`;
    }

    throw new Error(`Unsupported OIDC provider: ${provider}`);
  }

  /**
   * Handle the OAuth2 authorization-code callback.
   * Returns a short-lived one-time login code (not the actual JWT) so
   * tokens are never exposed in the redirect URL.
   */
  async handleCallback(code: string, state: string): Promise<string> {
    const raw = await this.sessions.get(`oidc:state:${state}`);
    if (!raw) {
      throw new UnauthorizedError('Invalid or expired state parameter');
    }
    await this.sessions.del(`oidc:state:${state}`);

    const { provider, nonce } = JSON.parse(raw) as OidcStateData;
    const ap = await this.authProviderRepo.findWithSecret(provider);
    if (!ap?.enabled || !ap.clientId || !ap.clientSecret || !ap.redirectUri) {
      throw new UnauthorizedError('Provider credentials are incomplete');
    }

    // Exchange the authorization code for provider tokens.
    const tokenEndpoint =
      provider === 'm365' && ap.tenantId
        ? `https://login.microsoftonline.com/${ap.tenantId}/oauth2/v2.0/token`
        : 'https://oauth2.googleapis.com/token';

    const tokenRes = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ap.clientId,
        client_secret: ap.clientSecret,
        code,
        redirect_uri: ap.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => '');
      throw new UnauthorizedError(
        `Token exchange failed (${tokenRes.status}): ${detail.slice(0, 200)}`,
      );
    }

    const { id_token } = (await tokenRes.json()) as { id_token: string };
    if (!id_token) throw new UnauthorizedError('No id_token in provider response');

    const idPayload = JSON.parse(
      Buffer.from(id_token.split('.')[1], 'base64url').toString('utf8'),
    ) as IdTokenPayload;

    const expectedIssuers =
      provider === 'm365' && ap.tenantId
        ? [`https://login.microsoftonline.com/${ap.tenantId}/v2.0`]
        : ['https://accounts.google.com'];
    validateIdTokenClaims(idPayload, nonce, ap.clientId, expectedIssuers);

    const email = (idPayload.email ?? idPayload.preferred_username ?? '').toLowerCase();
    const displayName = idPayload.name;

    if (!email) throw new UnauthorizedError('Identity provider did not return an email address');

    const user = await this.resolveOrProvisionUser(email, displayName);
    await this.linkMailboxToUser(user.id, user.email).catch(() => {});
    const mailbox = await this.mailboxRepo?.findByAddress(user.email);
    if (mailbox?.id) void collectorService.triggerInitialSyncIfNeeded(mailbox.id);

    // Issue our own session + JWT pair.
    const sessionId = newSessionId();
    const jwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      sessionId,
    };
    const accessToken = signAccessToken(jwtPayload);
    const refreshToken = signRefreshToken(jwtPayload);
    await this.sessions.set(sessionId, user.id, config.auth.refreshTokenTtlSec);

    const tokens: TokenPair = { accessToken, refreshToken, expiresIn: config.auth.jwtExpiresIn };

    await this.audit?.authEvent(
      'auth.oidc_login',
      { actorId: user.id, actorEmail: user.email, actorRole: user.role, sessionId },
      user.id,
      { newValue: { provider, flow: 'server_redirect' } },
    );

    // Store tokens under a one-time login code (30 s TTL).
    const loginCode = randomUUID();
    const codeData: OidcCodeData = {
      tokens,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        roleId: user.roleId,
        roleName: user.roleName,
        permissions: await resolvePermissionsForSubject(this.roleRepo, user),
        mailboxId: mailbox?.id ?? null,
      },
    };
    await this.sessions.set(`oidc:code:${loginCode}`, JSON.stringify(codeData), OIDC_CODE_TTL_SEC);

    return loginCode;
  }

  /** Exchange the one-time login code for the actual token pair. Clears the code immediately. */
  async exchangeLoginCode(code: string): Promise<OidcCodeData> {
    const raw = await this.sessions.get(`oidc:code:${code}`);
    if (!raw) {
      throw new UnauthorizedError('Invalid or expired login code');
    }
    await this.sessions.del(`oidc:code:${code}`);
    return JSON.parse(raw) as OidcCodeData;
  }

  /**
   * Called when the redirect_uri points to the FRONTEND.
   * Microsoft sends code+state to the browser; the frontend posts them here
   * so the server can exchange using the client secret (never exposed to the browser).
   * Returns tokens + user directly (no intermediate login code needed).
   */
  async completeFromBrowser(code: string, state: string): Promise<OidcCodeData> {
    const raw = await this.sessions.get(`oidc:state:${state}`);
    if (!raw) {
      throw new UnauthorizedError('Invalid or expired state parameter');
    }
    await this.sessions.del(`oidc:state:${state}`);

    const { provider, nonce } = JSON.parse(raw) as OidcStateData;
    const ap = await this.authProviderRepo.findWithSecret(provider);
    if (!ap?.enabled || !ap.clientId || !ap.clientSecret || !ap.redirectUri) {
      throw new UnauthorizedError('Provider credentials are incomplete');
    }

    const tokenEndpoint =
      provider === 'm365' && ap.tenantId
        ? `https://login.microsoftonline.com/${ap.tenantId}/oauth2/v2.0/token`
        : 'https://oauth2.googleapis.com/token';

    const tokenRes = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ap.clientId,
        client_secret: ap.clientSecret,
        code,
        redirect_uri: ap.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => '');
      throw new UnauthorizedError(
        `Token exchange failed (${tokenRes.status}): ${detail.slice(0, 300)}`,
      );
    }

    const { id_token } = (await tokenRes.json()) as { id_token: string };
    if (!id_token) throw new UnauthorizedError('No id_token in provider response');

    const idPayload = JSON.parse(
      Buffer.from(id_token.split('.')[1], 'base64url').toString('utf8'),
    ) as IdTokenPayload;

    const expectedIssuers =
      provider === 'm365' && ap.tenantId
        ? [`https://login.microsoftonline.com/${ap.tenantId}/v2.0`]
        : ['https://accounts.google.com'];
    validateIdTokenClaims(idPayload, nonce, ap.clientId, expectedIssuers);

    const email = (idPayload.email ?? idPayload.preferred_username ?? '').toLowerCase();
    const displayName = idPayload.name;
    if (!email) throw new UnauthorizedError('Identity provider did not return an email address');

    const user = await this.resolveOrProvisionUser(email, displayName);
    await this.linkMailboxToUser(user.id, user.email).catch(() => {});
    const mailbox = await this.mailboxRepo?.findByAddress(user.email);
    if (mailbox?.id) void collectorService.triggerInitialSyncIfNeeded(mailbox.id);

    const sessionId = newSessionId();
    const jwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      sessionId,
    };
    const accessToken = signAccessToken(jwtPayload);
    const refreshToken = signRefreshToken(jwtPayload);
    await this.sessions.set(sessionId, user.id, config.auth.refreshTokenTtlSec);

    await this.audit?.authEvent(
      'auth.oidc_login',
      { actorId: user.id, actorEmail: user.email, actorRole: user.role, sessionId },
      user.id,
      { newValue: { provider, flow: 'frontend_redirect' } },
    );

    return {
      tokens: { accessToken, refreshToken, expiresIn: config.auth.jwtExpiresIn },
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        roleId: user.roleId,
        roleName: user.roleName,
        permissions: await resolvePermissionsForSubject(this.roleRepo, user),
        mailboxId: mailbox?.id ?? null,
      },
    };
  }

  // Private helpers

  /**
   * Find an existing user by email, or JIT-provision a new one if:
   *   1. The org has jitEnabled = true
   *   2. The email domain is in the org's allowed domains list
   */
  private async resolveOrProvisionUser(email: string, displayName?: string): Promise<User> {
    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      return this.userRepo.updateUser(existing.id, {
        lastLoginAt: new Date(),
        status: existing.status === 'invited' ? 'active' : undefined,
      });
    }

    const org = await this.orgRepo.findFirst();

    if (!org?.jitEnabled) {
      throw new UnauthorizedError(
        `No account found for ${email}. Ask your administrator to add you to the platform.`,
      );
    }

    const emailDomain = email.split('@')[1]?.toLowerCase() ?? '';
    const allowedDomains = org.domains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    if (!allowedDomains.includes(emailDomain)) {
      throw new UnauthorizedError(
        `Your domain (${emailDomain}) is not authorised for this platform.`,
      );
    }

    // Provision the user with the org's default JIT role. Creation happens at the
    // moment of their first successful SSO login, so lastLoginAt is set immediately.
    const provisioned = await this.userRepo.create({
      email,
      displayName: displayName ?? email,
      role: org.jitDefaultRole,
      status: 'active',
    });
    const activated = await this.userRepo.updateUser(provisioned.id, { lastLoginAt: new Date() });

    sendJitProvisionedEmail(org.adminEmail, email, org.jitDefaultRole, org.name).catch((err) =>
      logger.warn({ err }, 'Failed to send JIT-provisioned admin alert'),
    );

    return activated;
  }

  /** Forward link: after SSO login, find the user's mailbox and set owner_user_id. Fire-and-forget. */
  private async linkMailboxToUser(userId: string, email: string): Promise<void> {
    if (!this.mailboxRepo) return;
    const mailbox = await this.mailboxRepo.findByAddress(email);
    if (mailbox && !mailbox.ownerUserId) {
      await this.mailboxRepo.linkOwner(mailbox.id, userId);
    }
  }
}
