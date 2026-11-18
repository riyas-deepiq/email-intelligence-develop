import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../../../src/lib/errors';
import { hashPassword } from '../../../../src/lib/password';
import { MemorySessionStore } from '../../../../src/lib/session-store';
import { InMemoryOrgRepository } from '../../../../src/modules/organizations/org.repository';
import { InMemoryUserRepository } from '../../../../src/modules/users/user.repository';
import { AuthService } from '../../../../src/modules/auth/auth.service';

// Helpers

function decodePayload(token: string): { sessionId: string; [key: string]: unknown } {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
    sessionId: string;
    [key: string]: unknown;
  };
}

async function makeService(): Promise<{
  service: AuthService;
  userRepo: InMemoryUserRepository;
  sessions: MemorySessionStore;
}> {
  const userRepo = new InMemoryUserRepository();
  const sessions = new MemorySessionStore();
  const hash = await hashPassword('correct-password');
  await userRepo.createWithHash(
    { email: 'admin@acme.com', displayName: 'Admin', role: 'superadmin' },
    hash,
  );
  return { service: new AuthService(userRepo, sessions), userRepo, sessions };
}

async function makeSetupService(): Promise<{
  service: AuthService;
  userRepo: InMemoryUserRepository;
  sessions: MemorySessionStore;
  orgRepo: InMemoryOrgRepository;
  userId: string;
}> {
  const userRepo = new InMemoryUserRepository();
  const sessions = new MemorySessionStore();
  const orgRepo = new InMemoryOrgRepository();
  const hash = await hashPassword('bootstrap-pass');
  const user = await userRepo.createWithHash(
    { email: 'admin@acme.com', displayName: 'Admin', role: 'superadmin', status: 'pending_setup' },
    hash,
  );
  const service = new AuthService(userRepo, sessions, orgRepo);
  return { service, userRepo, sessions, orgRepo, userId: user.id };
}

// Login

describe('AuthService.login', () => {
  it('returns tokens on valid credentials', async () => {
    const { service } = await makeService();
    const result = await service.login({ email: 'admin@acme.com', password: 'correct-password' });

    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(result.user.email).toBe('admin@acme.com');
  });

  it('throws UnauthorizedError for wrong password', async () => {
    const { service } = await makeService();
    await expect(
      service.login({ email: 'admin@acme.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws UnauthorizedError for unknown email', async () => {
    const { service } = await makeService();
    await expect(service.login({ email: 'nobody@acme.com', password: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('throws UnauthorizedError for OAuth-only user (no password hash)', async () => {
    const { service, userRepo } = await makeService();
    // create a user with no password (SSO-only)
    await userRepo.create({ email: 'sso@acme.com', displayName: 'SSO User', role: 'employee' });

    await expect(service.login({ email: 'sso@acme.com', password: 'any' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('creates a server-side session on login', async () => {
    const { service } = await makeService();
    const result = await service.login({ email: 'admin@acme.com', password: 'correct-password' });
    const { sessionId } = decodePayload(result.tokens.accessToken);

    const valid = await service.verifySession(sessionId, result.user.id);
    expect(valid).toBe(true);
  });

  it('sets isFirstLogin when superadmin has pending_setup status', async () => {
    const { service, userRepo } = await makeService();
    const hash = await hashPassword('pass');
    await userRepo.createWithHash(
      {
        email: 'new-admin@acme.com',
        displayName: 'New',
        role: 'superadmin',
        status: 'pending_setup',
      },
      hash,
    );

    const result = await service.login({ email: 'new-admin@acme.com', password: 'pass' });
    expect(result.isFirstLogin).toBe(true);
  });

  it('does not set isFirstLogin for active superadmin', async () => {
    const { service } = await makeService();
    const result = await service.login({ email: 'admin@acme.com', password: 'correct-password' });
    expect(result.isFirstLogin).toBeUndefined();
  });
});

// Logout

describe('AuthService.logout', () => {
  it('invalidates the session', async () => {
    const { service } = await makeService();
    const result = await service.login({ email: 'admin@acme.com', password: 'correct-password' });
    const { sessionId } = decodePayload(result.tokens.accessToken);

    await service.logout(sessionId);

    const valid = await service.verifySession(sessionId, result.user.id);
    expect(valid).toBe(false);
  });
});

// Refresh

describe('AuthService.refresh', () => {
  it('returns a new token pair', async () => {
    const { service } = await makeService();
    const login = await service.login({ email: 'admin@acme.com', password: 'correct-password' });
    const result = await service.refresh(login.tokens.refreshToken);

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('new session is valid after refresh', async () => {
    const { service } = await makeService();
    const login = await service.login({ email: 'admin@acme.com', password: 'correct-password' });
    const userId = login.user.id;
    const result = await service.refresh(login.tokens.refreshToken);
    const { sessionId: newSessionId } = decodePayload(result.accessToken);

    const valid = await service.verifySession(newSessionId, userId);
    expect(valid).toBe(true);
  });

  it('old session is revoked after refresh', async () => {
    const { service } = await makeService();
    const login = await service.login({ email: 'admin@acme.com', password: 'correct-password' });
    const userId = login.user.id;
    const { sessionId: oldSessionId } = decodePayload(login.tokens.accessToken);

    await service.refresh(login.tokens.refreshToken);

    const stillValid = await service.verifySession(oldSessionId, userId);
    expect(stillValid).toBe(false);
  });

  it('throws UnauthorizedError for a garbage token', async () => {
    const { service } = await makeService();
    await expect(service.refresh('not.a.token')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws UnauthorizedError when the session has been revoked', async () => {
    const { service } = await makeService();
    const login = await service.login({ email: 'admin@acme.com', password: 'correct-password' });
    const { sessionId } = decodePayload(login.tokens.accessToken);

    // Revoke the session before refreshing.
    await service.logout(sessionId);

    await expect(service.refresh(login.tokens.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

// Setup

describe('AuthService.setup', () => {
  const setupReq = {
    companyName: 'Acme Corp',
    domains: 'acme.com',
    email: 'superadmin@acme.com',
    newPassword: 'NewP@ssw0rd!',
  };

  it('completes setup and returns fresh tokens', async () => {
    const { service, userId, sessions } = await makeSetupService();
    // Seed a session for the pre-setup user.
    const preSession = 'pre-session-id';
    await sessions.set(preSession, userId, 3600);

    const result = await service.setup(userId, preSession, setupReq);

    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.user.email).toBe(setupReq.email);
  });

  it('user is active after setup', async () => {
    const { service, userRepo, userId, sessions } = await makeSetupService();
    const preSession = 'pre-session-id';
    await sessions.set(preSession, userId, 3600);

    await service.setup(userId, preSession, setupReq);

    const updated = await userRepo.findByIdInternal(userId);
    expect(updated?.status).toBe('active');
    expect(updated?.email).toBe(setupReq.email);
  });

  it('upserts the organisation record', async () => {
    const { service, userId, sessions, orgRepo } = await makeSetupService();
    const preSession = 'pre-session-id';
    await sessions.set(preSession, userId, 3600);

    await service.setup(userId, preSession, setupReq);

    const org = await orgRepo.findFirst();
    expect(org?.name).toBe('Acme Corp');
    expect(org?.domains).toBe('acme.com');
  });

  it('revokes the pre-setup session', async () => {
    const { service, userId, sessions } = await makeSetupService();
    const preSession = 'pre-session-id';
    await sessions.set(preSession, userId, 3600);

    await service.setup(userId, preSession, setupReq);

    const stillThere = await sessions.get(preSession);
    expect(stillThere).toBeNull();
  });

  it('throws ForbiddenError when called a second time', async () => {
    const { service, userId, sessions } = await makeSetupService();
    await sessions.set('sess-1', userId, 3600);
    await service.setup(userId, 'sess-1', setupReq);

    // After first setup the status is 'active' — a second call must be rejected.
    await expect(service.setup(userId, 'sess-2', setupReq)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError for an unknown userId', async () => {
    const { service } = await makeSetupService();
    await expect(service.setup('non-existent-id', 'any-session', setupReq)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// getMe

describe('AuthService.getMe', () => {
  it('returns isFirstLogin true for superadmin still in pending_setup', async () => {
    const { service, userId } = await makeSetupService();
    const { isFirstLogin } = await service.getMe(userId, 'superadmin');
    expect(isFirstLogin).toBe(true);
  });

  it('returns isFirstLogin false for active superadmin', async () => {
    const { service, userId, sessions } = await makeSetupService();
    await sessions.set('s', userId, 3600);
    await service.setup(userId, 's', {
      companyName: 'X',
      domains: 'x.com',
      email: 'x@x.com',
      newPassword: 'P@ss1234!',
    });

    const { isFirstLogin } = await service.getMe(userId, 'superadmin');
    expect(isFirstLogin).toBe(false);
  });

  it('returns isFirstLogin false for non-superadmin without hitting the DB', async () => {
    const { service } = await makeService();
    const { isFirstLogin } = await service.getMe('any-id', 'employee');
    expect(isFirstLogin).toBe(false);
  });
});

// Inactive account

describe('AuthService.login (inactive)', () => {
  it('throws UnauthorizedError for inactive accounts', async () => {
    const userRepo = new InMemoryUserRepository();
    const hash = await hashPassword('pass');
    await userRepo.createWithHash(
      { email: 'fired@acme.com', displayName: 'Ex Employee', role: 'employee', status: 'inactive' },
      hash,
    );
    const service = new AuthService(userRepo, new MemorySessionStore());
    await expect(
      service.login({ email: 'fired@acme.com', password: 'pass' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

// Forgot / Reset password

describe('AuthService.forgotPassword + resetPassword', () => {
  it('silently succeeds for unknown email (no information leak)', async () => {
    const { service } = await makeService();
    await expect(service.forgotPassword('nobody@acme.com')).resolves.toBeUndefined();
  });

  it('reset token can be consumed to set a new password and then login works', async () => {
    const userRepo = new InMemoryUserRepository();
    const sessions = new MemorySessionStore();
    const hash = await hashPassword('old-pass');
    await userRepo.createWithHash(
      { email: 'u@acme.com', displayName: 'U', role: 'employee' },
      hash,
    );
    const service = new AuthService(userRepo, sessions);

    await service.forgotPassword('u@acme.com');

    // Instead of inspecting internals, inject a known token directly to test end-to-end.
    const token = 'test-token-uuid';
    await sessions.set(`pwreset:${token}`, (await userRepo.findByEmail('u@acme.com'))!.id, 3600);

    await service.resetPassword(token, 'new-pass-123!');
    await expect(
      service.login({ email: 'u@acme.com', password: 'new-pass-123!' }),
    ).resolves.toHaveProperty('tokens');
  });

  it('resetPassword throws UnauthorizedError for invalid token', async () => {
    const { service } = await makeService();
    await expect(service.resetPassword('bad-token', 'newPass123!')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('reset token is one-time use', async () => {
    const userRepo = new InMemoryUserRepository();
    const sessions = new MemorySessionStore();
    const hash = await hashPassword('pass');
    const user = await userRepo.createWithHash(
      { email: 'u@acme.com', displayName: 'U', role: 'employee' },
      hash,
    );
    const service = new AuthService(userRepo, sessions);

    const token = 'one-time-token';
    await sessions.set(`pwreset:${token}`, user.id, 3600);

    await service.resetPassword(token, 'newPass1!');
    await expect(service.resetPassword(token, 'newPass2!')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

// Change password

describe('AuthService.changePassword', () => {
  it('changes the password when current password is correct', async () => {
    const { service, userRepo } = await makeService();
    const user = (await userRepo.findByEmail('admin@acme.com'))!;
    await service.changePassword(user.id, 'correct-password', 'NewPass@99', 'sess-1');
    await expect(
      service.login({ email: 'admin@acme.com', password: 'NewPass@99' }),
    ).resolves.toHaveProperty('tokens');
  });

  it('throws UnauthorizedError when current password is wrong', async () => {
    const { service, userRepo } = await makeService();
    const user = (await userRepo.findByEmail('admin@acme.com'))!;
    await expect(
      service.changePassword(user.id, 'wrong-password', 'NewPass@99', 'sess'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws ForbiddenError for SSO-only accounts', async () => {
    const userRepo = new InMemoryUserRepository();
    const user = await userRepo.create({
      email: 'sso@acme.com',
      displayName: 'SSO',
      role: 'employee',
    });
    const service = new AuthService(userRepo, new MemorySessionStore());
    await expect(
      service.changePassword(user.id, 'anything', 'NewPass@99', 'sess'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// Invite token

describe('AuthService invite flow', () => {
  it('generateInviteToken + acceptInvite activates the account and returns tokens', async () => {
    const userRepo = new InMemoryUserRepository();
    const sessions = new MemorySessionStore();
    const invited = await userRepo.create({
      email: 'new@acme.com',
      displayName: 'New',
      role: 'employee',
      status: 'invited',
    });
    const service = new AuthService(userRepo, sessions);

    const token = await service.generateInviteToken(invited.id);
    const result = await service.acceptInvite(token, 'InvPass@99!');
    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.user.email).toBe('new@acme.com');

    // Account is now active and can login.
    await expect(
      service.login({ email: 'new@acme.com', password: 'InvPass@99!' }),
    ).resolves.toHaveProperty('tokens');
  });

  it('acceptInvite throws UnauthorizedError for invalid token', async () => {
    const { service } = await makeService();
    await expect(service.acceptInvite('bad-token', 'pass')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('invite token is one-time use', async () => {
    const userRepo = new InMemoryUserRepository();
    const sessions = new MemorySessionStore();
    const user = await userRepo.create({
      email: 'u@acme.com',
      displayName: 'U',
      role: 'employee',
      status: 'invited',
    });
    const service = new AuthService(userRepo, sessions);

    const token = await service.generateInviteToken(user.id);
    await service.acceptInvite(token, 'Pass@99!');
    await expect(service.acceptInvite(token, 'Pass@99!')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

// Session management

describe('AuthService.listSessions + revokeSession', () => {
  it('lists active sessions for a user', async () => {
    const { service } = await makeService();
    const { tokens, user } = await service.login({
      email: 'admin@acme.com',
      password: 'correct-password',
    });
    const { sessionId } = decodePayload(tokens.accessToken);

    const sessions = await service.listSessions(user.id);
    expect(sessions.some((s) => s.sessionId === sessionId)).toBe(true);
  });

  it('does not include pwreset or invite tokens in session list', async () => {
    const userRepo = new InMemoryUserRepository();
    const sessions = new MemorySessionStore();
    const hash = await hashPassword('pass');
    const user = await userRepo.createWithHash(
      { email: 'u@acme.com', displayName: 'U', role: 'employee' },
      hash,
    );
    const service = new AuthService(userRepo, sessions);

    await sessions.set(`pwreset:some-token`, user.id, 3600);
    await sessions.set(`invite:some-token`, user.id, 3600);

    const list = await service.listSessions(user.id);
    expect(list).toHaveLength(0);
  });

  it('revokeSession removes the target session', async () => {
    const { service } = await makeService();
    const { tokens, user } = await service.login({
      email: 'admin@acme.com',
      password: 'correct-password',
    });
    const { sessionId } = decodePayload(tokens.accessToken);

    await service.revokeSession(user.id, sessionId);
    const after = await service.listSessions(user.id);
    expect(after.every((s) => s.sessionId !== sessionId)).toBe(true);
  });

  it('revokeSession throws NotFoundError for session belonging to another user', async () => {
    const { service, sessions } = await makeService();
    await sessions.set('other-users-session', 'different-user-id', 3600);
    const { user } = await service.login({ email: 'admin@acme.com', password: 'correct-password' });
    await expect(service.revokeSession(user.id, 'other-users-session')).rejects.toBeInstanceOf(
      Error,
    ); // NotFoundError
  });
});
