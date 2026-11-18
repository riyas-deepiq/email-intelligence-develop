import { describe, expect, it } from 'vitest';
import type {
  AuditLogEntry,
  AuditQueryFilter,
  WriteAuditInput,
} from '../../../../src/modules/audit/audit.types';
import type { AuditRepository } from '../../../../src/modules/audit/audit.repository';
import { actorFromRequest, AuditService } from '../../../../src/modules/audit/audit.service';

// In-memory repository for testing

class SpyAuditRepository implements AuditRepository {
  readonly written: WriteAuditInput[] = [];

  async write(input: WriteAuditInput): Promise<void> {
    this.written.push(input);
  }

  async query(_filter: AuditQueryFilter): Promise<AuditLogEntry[]> {
    return [];
  }

  async count(_filter: AuditQueryFilter): Promise<number> {
    return 0;
  }
}

class ThrowingAuditRepository implements AuditRepository {
  async write(_input: WriteAuditInput): Promise<void> {
    throw new Error('DB connection lost');
  }
  async query(_filter: AuditQueryFilter): Promise<AuditLogEntry[]> {
    return [];
  }

  async count(_filter: AuditQueryFilter): Promise<number> {
    return 0;
  }
}

const actor = {
  actorId: 'user-1',
  actorEmail: 'admin@acme.com',
  actorRole: 'superadmin',
  sessionId: 'sess-abc',
};

// write

describe('AuditService.write', () => {
  it('persists the event to the repository', async () => {
    const repo = new SpyAuditRepository();
    const service = new AuditService(repo);

    await service.write({
      actor,
      eventType: 'auth.login',
      entityType: 'session',
      entityId: 'user-1',
      newValue: { provider: 'native' },
    });

    expect(repo.written).toHaveLength(1);
    expect(repo.written[0]!.eventType).toBe('auth.login');
    expect(repo.written[0]!.actor.actorEmail).toBe('admin@acme.com');
  });

  it('passes oldValue and newValue through', async () => {
    const repo = new SpyAuditRepository();
    const service = new AuditService(repo);

    await service.write({
      actor,
      eventType: 'user.role_changed',
      entityType: 'user',
      entityId: 'user-2',
      oldValue: { role: 'employee' },
      newValue: { role: 'admin' },
    });

    expect(repo.written[0]!.oldValue).toEqual({ role: 'employee' });
    expect(repo.written[0]!.newValue).toEqual({ role: 'admin' });
  });

  it('passes null oldValue / newValue as null', async () => {
    const repo = new SpyAuditRepository();
    const service = new AuditService(repo);

    await service.write({ actor, eventType: 'user.created', entityType: 'user', entityId: 'u1' });

    expect(repo.written[0]!.oldValue).toBeNull();
    expect(repo.written[0]!.newValue).toBeNull();
  });

  it('never throws when the repository fails (fire-and-forget)', async () => {
    const service = new AuditService(new ThrowingAuditRepository());

    await expect(
      service.write({ actor, eventType: 'auth.login', entityType: 'session', entityId: 'u1' }),
    ).resolves.toBeUndefined();
  });
});

// Sensitive field redaction

describe('AuditService sensitive-field redaction', () => {
  const REDACTED = '[redacted]';

  const sensitiveKeys: Array<[string, unknown]> = [
    ['passwordHash', 'secret-hash'],
    ['password_hash', 'secret-hash'],
    ['clientSecret', 'super-secret'],
    ['client_secret', 'super-secret'],
    ['serviceAccountJson', '{"key":"value"}'],
    ['service_account_json', '{"key":"value"}'],
    ['password', 'p@ssw0rd'],
  ];

  for (const [key, value] of sensitiveKeys) {
    it(`redacts "${key}"`, async () => {
      const repo = new SpyAuditRepository();
      const service = new AuditService(repo);

      await service.write({
        actor,
        eventType: 'auth_provider.configured',
        entityType: 'auth_provider',
        entityId: 'm365',
        oldValue: { [key]: value, tenantId: 'tid' },
        newValue: { [key]: value, clientId: 'cid' },
      });

      expect((repo.written[0]!.oldValue as Record<string, unknown>)[key]).toBe(REDACTED);
      expect((repo.written[0]!.newValue as Record<string, unknown>)[key]).toBe(REDACTED);
    });
  }

  it('does not redact non-sensitive keys', async () => {
    const repo = new SpyAuditRepository();
    const service = new AuditService(repo);

    await service.write({
      actor,
      eventType: 'user.created',
      entityType: 'user',
      entityId: 'u1',
      newValue: { email: 'a@b.com', role: 'employee', displayName: 'Ada' },
    });

    const nv = repo.written[0]!.newValue as Record<string, unknown>;
    expect(nv['email']).toBe('a@b.com');
    expect(nv['role']).toBe('employee');
    expect(nv['displayName']).toBe('Ada');
  });
});

// Convenience builders

describe('AuditService convenience builders', () => {
  it('authEvent sets entityType = "session"', async () => {
    const repo = new SpyAuditRepository();
    const service = new AuditService(repo);

    await service.authEvent('auth.login', actor, 'user-1', { newValue: { provider: 'native' } });

    expect(repo.written[0]!.entityType).toBe('session');
    expect(repo.written[0]!.eventType).toBe('auth.login');
    expect(repo.written[0]!.entityId).toBe('user-1');
  });

  it('userEvent sets entityType = "user"', async () => {
    const repo = new SpyAuditRepository();
    const service = new AuditService(repo);

    await service.userEvent('user.created', actor, 'user-2', null, { role: 'employee' });

    expect(repo.written[0]!.entityType).toBe('user');
    expect(repo.written[0]!.eventType).toBe('user.created');
  });

  it('orgEvent sets entityType = "organization"', async () => {
    const repo = new SpyAuditRepository();
    const service = new AuditService(repo);

    await service.orgEvent('org.jit_enabled', actor, 'org-1');

    expect(repo.written[0]!.entityType).toBe('organization');
    expect(repo.written[0]!.entityId).toBe('org-1');
  });

  it('providerEvent sets entityType = "auth_provider" and uses provider as entityId', async () => {
    const repo = new SpyAuditRepository();
    const service = new AuditService(repo);

    await service.providerEvent('auth_provider.configured', actor, 'm365');

    expect(repo.written[0]!.entityType).toBe('auth_provider');
    expect(repo.written[0]!.entityId).toBe('m365');
  });

  it('mailboxEvent sets entityType = "mailbox"', async () => {
    const repo = new SpyAuditRepository();
    const service = new AuditService(repo);

    await service.mailboxEvent('mailbox.connected', actor, 'mbx-1');

    expect(repo.written[0]!.entityType).toBe('mailbox');
    expect(repo.written[0]!.entityId).toBe('mbx-1');
  });
});

// actorFromRequest

describe('actorFromRequest', () => {
  it('maps session user fields onto AuditActor', () => {
    const result = actorFromRequest(
      { id: 'u-1', email: 'x@y.com', role: 'admin', sessionId: 'sess-1' },
      '127.0.0.1',
    );

    expect(result.actorId).toBe('u-1');
    expect(result.actorEmail).toBe('x@y.com');
    expect(result.actorRole).toBe('admin');
    expect(result.sessionId).toBe('sess-1');
    expect(result.ipAddress).toBe('127.0.0.1');
  });

  it('ipAddress is optional', () => {
    const result = actorFromRequest({ id: 'u-1', email: 'x@y.com', role: 'admin', sessionId: 's' });
    expect(result.ipAddress).toBeUndefined();
  });
});
