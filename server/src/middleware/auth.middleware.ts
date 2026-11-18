import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isTransientDbConnectionError } from '../db/retry';
import { ForbiddenError, ServiceUnavailableError, UnauthorizedError } from '../lib/errors';
import { logger } from '../lib/logger';
import { sessionStore } from '../lib/session-store';
import { createRoleRepository } from '../modules/roles/role.repository';
import { resolvePermissionsForSubject } from '../modules/roles/permission-resolver';
import { createUserRepository } from '../modules/users/user.repository';
import { verifyAccessToken } from '../lib/token';

const userRepo = createUserRepository();
const roleRepo = createRoleRepository();

/**
 * Verifies the Bearer token on every protected route.
 *
 * Two-step check:
 *   1. JWT signature + expiry (stateless, fast).
 *   2. Server-side session exists in Redis/memory (revocation — logout invalidates immediately).
 *
 * On success, attaches `req.user` for downstream handlers.
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return next(new UnauthorizedError('Missing or malformed Authorization header'));
    }

    const token = header.slice(7);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return next(new UnauthorizedError('Invalid or expired access token'));
    }

    let userId: string | null;
    try {
      userId = await sessionStore.get(payload.sessionId);
    } catch (err) {
      // DB temporarily unreachable — log and fail safely rather than crashing.
      logger.error({ err }, 'Session store unavailable during auth');
      if (isTransientDbConnectionError(err)) {
        return next(
          new ServiceUnavailableError('Auth service temporarily unavailable - please try again'),
        );
      }
      return next(new UnauthorizedError('Auth service temporarily unavailable — please try again'));
    }

    if (!userId || userId !== payload.sub) {
      return next(new UnauthorizedError('Session not found or has been revoked'));
    }

    const user = await userRepo.findById(payload.sub);
    if (!user || user.status === 'inactive') {
      await sessionStore.del(payload.sessionId).catch(() => {});
      return next(
        new UnauthorizedError('Your account has been deactivated. Contact your administrator.'),
      );
    }

    req.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      roleId: user.roleId,
      roleName: user.roleName,
      permissions: await resolvePermissionsForSubject(roleRepo, user),
      sessionId: payload.sessionId,
    };

    return next();
  } catch (err) {
    if (isTransientDbConnectionError(err)) {
      logger.error({ err }, 'Database unavailable during auth');
      return next(
        new ServiceUnavailableError('Auth service temporarily unavailable - please try again'),
      );
    }
    return next(err);
  }
};

/** Convenience guard that also checks the caller's role. */
export function requireRole(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('Insufficient permissions'));
    }
    return next();
  };
}

/** Permission guard for custom roles. Superadmin is covered by its resolved permissions. */
export function requirePermission(...permissions: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!permissions.some((permission) => req.user!.permissions.includes(permission))) {
      return next(new ForbiddenError('Insufficient permissions'));
    }
    return next();
  };
}
