import type { Request, Response } from 'express';
import { send } from '../../lib/respond';
import { UnauthorizedError } from '../../lib/errors';
import { config } from '../../config/env';
import type { SessionUser, TokenPair } from './auth.types';
import {
  parseAcceptInviteDto,
  parseChangePasswordDto,
  parseForgotPasswordDto,
  parseLoginDto,
  parseResetPasswordDto,
  parseSetupDto,
} from './auth.schema';
import type { AuthService } from './auth.service';
import type { OidcService } from './oidc.service';
import type { ProviderType } from '../auth-providers/auth-provider.types';
import type { MailboxRepository } from '../mailboxes/mailbox.repository';

/** Extend Express Request with the authenticated session user. */
declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

// Cookie helpers

const REFRESH_COOKIE_NAME = 'refresh_token';

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: config.auth.refreshTokenTtlSec * 1000,
    path: '/api/v1/auth',
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
  });
}

/** Read refresh token from HttpOnly cookie; fall back to request body for API clients. */
function extractRefreshToken(req: Request): string | null {
  // Parse cookie header manually — avoids adding cookie-parser as a dependency.
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const match = /(?:^|;\s*)refresh_token=([^;]*)/.exec(cookieHeader);
    if (match) return decodeURIComponent(match[1]);
  }
  return ((req.body as Record<string, unknown>)?.['refreshToken'] as string) ?? null;
}

function publicTokens(tokens: TokenPair): Omit<TokenPair, 'refreshToken'> {
  return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
}

export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly oidcService: OidcService,
    private readonly mailboxRepo?: MailboxRepository,
  ) {}

  // Native auth

  login = async (req: Request, res: Response): Promise<void> => {
    const dto = parseLoginDto(req.body);
    const result = await this.service.login(dto, req.ip, req.get('user-agent'));
    setRefreshCookie(res, result.tokens.refreshToken);
    send(res, { ...result, tokens: publicTokens(result.tokens) });
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    const refreshToken = extractRefreshToken(req);
    if (!refreshToken) throw new UnauthorizedError('refresh_token is required');
    const tokens = await this.service.refresh(refreshToken, req.get('user-agent'));
    setRefreshCookie(res, tokens.refreshToken);
    send(res, publicTokens(tokens));
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const user = req.user;
    if (!user) throw new UnauthorizedError();
    await this.service.logout(
      user.sessionId,
      { id: user.id, email: user.email, role: user.role },
      req.ip,
    );
    clearRefreshCookie(res);
    send(res, { message: 'Logged out successfully' });
  };

  me = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    const { id, email, displayName, role, roleId, roleName, permissions } = req.user;
    const [{ isFirstLogin }, mailbox] = await Promise.all([
      this.service.getMe(id, role),
      this.mailboxRepo?.findByAddress(email),
    ]);
    send(res, {
      id,
      email,
      displayName,
      role,
      roleId,
      roleName,
      permissions,
      mailboxId: mailbox?.id ?? null,
      ...(isFirstLogin && { isFirstLogin: true }),
    });
  };

  setup = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    const dto = parseSetupDto(req.body);
    const result = await this.service.setup(
      req.user.id,
      req.user.sessionId,
      dto,
      req.ip,
      req.get('user-agent'),
    );
    setRefreshCookie(res, result.tokens.refreshToken);
    send(res, {
      message: 'Setup completed successfully',
      ...result,
      tokens: publicTokens(result.tokens),
    });
  };

  // Password reset (public)

  forgotPassword = async (req: Request, res: Response): Promise<void> => {
    const { email } = parseForgotPasswordDto(req.body);
    // Always return 200 regardless of whether the email exists (don't leak account info).
    await this.service.forgotPassword(email, req.ip);
    send(res, { message: 'If that email is registered, a reset link has been sent.' });
  };

  resetPassword = async (req: Request, res: Response): Promise<void> => {
    const { token, newPassword } = parseResetPasswordDto(req.body);
    await this.service.resetPassword(token, newPassword);
    send(res, { message: 'Password reset successfully. You can now log in.' });
  };

  // Change password (authenticated)

  changePassword = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    const { currentPassword, newPassword } = parseChangePasswordDto(req.body);
    await this.service.changePassword(
      req.user.id,
      currentPassword,
      newPassword,
      req.user.sessionId,
      req.ip,
    );
    send(res, { message: 'Password changed successfully.' });
  };

  // Session management

  listSessions = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    const sessions = await this.service.listSessions(req.user.id);
    send(res, sessions);
  };

  revokeSession = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new UnauthorizedError();
    await this.service.revokeSession(req.user.id, req.params.sessionId, req.ip);
    send(res, { message: 'Session revoked.' });
  };

  // Invite accept (public)

  acceptInvite = async (req: Request, res: Response): Promise<void> => {
    const { token, newPassword } = parseAcceptInviteDto(req.body);
    const result = await this.service.acceptInvite(token, newPassword, req.get('user-agent'));
    setRefreshCookie(res, result.tokens.refreshToken);
    send(res, { message: 'Account activated.', ...result, tokens: publicTokens(result.tokens) });
  };

  // OIDC

  /** Public: returns enabled OIDC providers so the login page can render SSO buttons. */
  getProviders = async (_req: Request, res: Response): Promise<void> => {
    const providers = await this.oidcService.getEnabledProviders();
    send(res, providers);
  };

  /** Redirect browser to the provider's authorization endpoint. */
  initiateOidc = async (req: Request, res: Response): Promise<void> => {
    const provider = req.params.provider as ProviderType;
    const url = await this.oidcService.buildAuthorizationUrl(provider);
    res.redirect(url);
  };

  /**
   * Provider calls back here after user authenticates.
   * We exchange the code, create a session, and redirect the browser
   * to the frontend with a short-lived one-time login code.
   */
  oidcCallback = async (req: Request, res: Response): Promise<void> => {
    const { code, state, error, error_description } = req.query as Record<string, string>;

    const frontendBase = config.server.corsOrigin;

    if (error) {
      const msg = encodeURIComponent(error_description ?? error ?? 'Authentication failed');
      res.redirect(`${frontendBase}/auth/callback?error=${msg}`);
      return;
    }

    if (!code || !state) {
      res.redirect(
        `${frontendBase}/auth/callback?error=${encodeURIComponent('Missing code or state')}`,
      );
      return;
    }

    try {
      const loginCode = await this.oidcService.handleCallback(code, state);
      res.redirect(`${frontendBase}/auth/callback?code=${loginCode}`);
    } catch (err) {
      const msg = encodeURIComponent(err instanceof Error ? err.message : 'Authentication failed');
      res.redirect(`${frontendBase}/auth/callback?error=${msg}`);
    }
  };

  /** Exchange the one-time login code for the actual token pair (server-redirect flow). */
  exchangeOidcCode = async (req: Request, res: Response): Promise<void> => {
    const { code } = req.body as { code?: string };
    if (!code) throw new UnauthorizedError('code is required');
    const result = await this.oidcService.exchangeLoginCode(code);
    setRefreshCookie(res, result.tokens.refreshToken);
    send(res, { ...result, tokens: publicTokens(result.tokens) });
  };

  /**
   * Frontend-redirect flow: the browser received code+state from the provider
   * and posts them here so the server can do the secure exchange.
   */
  completeOidc = async (req: Request, res: Response): Promise<void> => {
    const { code, state } = req.body as { code?: string; state?: string };
    if (!code || !state) throw new UnauthorizedError('code and state are required');
    const result = await this.oidcService.completeFromBrowser(code, state);
    setRefreshCookie(res, result.tokens.refreshToken);
    send(res, { ...result, tokens: publicTokens(result.tokens) });
  };
}
