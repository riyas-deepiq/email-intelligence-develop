import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../lib/async-handler';
import { sessionStore } from '../../lib/session-store';
import { requireAuth, requireRole } from '../../middleware/auth.middleware';

// Tight limit for brute-force-sensitive endpoints (login, password reset, invite accept).
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'rate_limited', message: 'Too many attempts. Please try again later.' },
  },
});

// Looser limit for token refresh — no credential guessing risk, just session continuity.
// Every page reload triggers one refresh call, so this needs headroom for normal use.
const refreshRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'rate_limited', message: 'Too many refresh attempts. Please try again later.' },
  },
});

// Looser limit for forgot-password to prevent email flooding.
const forgotPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many password reset requests. Please try again later.',
    },
  },
});
import { createAuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import { createAuthProviderRepository } from '../auth-providers/auth-provider.repository';
import { createMailboxRepository } from '../mailboxes/mailbox.repository';
import { createOrgRepository } from '../organizations/org.repository';
import { createRoleRepository } from '../roles/role.repository';
import { createUserRepository } from '../users/user.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OidcService } from './oidc.service';

const userRepo = createUserRepository();
const authProviderRepo = createAuthProviderRepository();
const auditSvc = new AuditService(createAuditRepository());

const mailboxRepo = createMailboxRepository();
const roleRepo = createRoleRepository();
const authService = new AuthService(
  userRepo,
  sessionStore,
  createOrgRepository(),
  auditSvc,
  mailboxRepo,
  roleRepo,
);
const oidcService = new OidcService(
  authProviderRepo,
  userRepo,
  sessionStore,
  createOrgRepository(),
  auditSvc,
  mailboxRepo,
  roleRepo,
);
const controller = new AuthController(authService, oidcService, mailboxRepo);

export const authRouter = Router();

// Native auth (public)
authRouter.post('/login', authRateLimit, asyncHandler(controller.login));
authRouter.post('/refresh', refreshRateLimit, asyncHandler(controller.refresh));

// Password reset (public — no auth required)
authRouter.post(
  '/forgot-password',
  forgotPasswordRateLimit,
  asyncHandler(controller.forgotPassword),
);
authRouter.post('/reset-password', authRateLimit, asyncHandler(controller.resetPassword));

// Invite accept (public)
authRouter.post('/accept-invite', authRateLimit, asyncHandler(controller.acceptInvite));

// Protected auth
authRouter.post('/logout', requireAuth, asyncHandler(controller.logout));
authRouter.get('/me', requireAuth, asyncHandler(controller.me));
authRouter.post('/setup', requireAuth, requireRole('superadmin'), asyncHandler(controller.setup));
authRouter.post('/change-password', requireAuth, asyncHandler(controller.changePassword));

// Session management
authRouter.get('/sessions', requireAuth, asyncHandler(controller.listSessions));
authRouter.delete('/sessions/:sessionId', requireAuth, asyncHandler(controller.revokeSession));

// OIDC (public)
authRouter.get('/providers', asyncHandler(controller.getProviders));
authRouter.get('/oidc/callback', asyncHandler(controller.oidcCallback));
authRouter.get('/oidc/:provider', asyncHandler(controller.initiateOidc));
authRouter.post('/oidc/exchange', asyncHandler(controller.exchangeOidcCode));
authRouter.post('/oidc/complete', asyncHandler(controller.completeOidc));
