import { logger } from '../../lib/logger';
import type { AuditRepository } from './audit.repository';
import type {
  AuditActor,
  AuditEventType,
  AuditLogEntry,
  AuditQueryFilter,
  WriteAuditInput,
} from './audit.types';

export type { AuditActor } from './audit.types';

const REDACTED = '[redacted]';

const SENSITIVE_KEYS = new Set([
  'passwordHash',
  'password_hash',
  'clientSecret',
  'client_secret',
  'serviceAccountJson',
  'service_account_json',
  'password',
]);

export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  async write(input: WriteAuditInput): Promise<void> {
    try {
      const sanitized: WriteAuditInput = {
        ...input,
        oldValue: input.oldValue ? this.redact(input.oldValue) : null,
        newValue: input.newValue ? this.redact(input.newValue) : null,
      };
      await this.repo.write(sanitized);
    } catch (err) {
      // Audit failures must never break the primary operation.
      logger.error({ err }, 'audit write failed');
    }
  }

  query(filter: AuditQueryFilter): Promise<AuditLogEntry[]> {
    return this.repo.query(filter);
  }

  count(filter: AuditQueryFilter): Promise<number> {
    return this.repo.count(filter);
  }

  // Convenience builders

  authEvent(
    eventType: Extract<AuditEventType, `auth.${string}`>,
    actor: AuditActor,
    entityId: string,
    payload?: { oldValue?: Record<string, unknown>; newValue?: Record<string, unknown> },
  ): Promise<void> {
    return this.write({
      actor,
      eventType,
      entityType: 'session',
      entityId,
      ...payload,
    });
  }

  userEvent(
    eventType: Extract<AuditEventType, `user.${string}`>,
    actor: AuditActor,
    entityId: string,
    oldValue?: Record<string, unknown> | null,
    newValue?: Record<string, unknown> | null,
  ): Promise<void> {
    return this.write({ actor, eventType, entityType: 'user', entityId, oldValue, newValue });
  }

  orgEvent(
    eventType: Extract<AuditEventType, `org.${string}`>,
    actor: AuditActor,
    entityId: string,
    oldValue?: Record<string, unknown> | null,
    newValue?: Record<string, unknown> | null,
  ): Promise<void> {
    return this.write({
      actor,
      eventType,
      entityType: 'organization',
      entityId,
      oldValue,
      newValue,
    });
  }

  providerEvent(
    eventType: Extract<AuditEventType, `auth_provider.${string}`>,
    actor: AuditActor,
    provider: string,
    oldValue?: Record<string, unknown> | null,
    newValue?: Record<string, unknown> | null,
  ): Promise<void> {
    return this.write({
      actor,
      eventType,
      entityType: 'auth_provider',
      entityId: provider,
      oldValue,
      newValue,
    });
  }

  mailboxEvent(
    eventType: Extract<AuditEventType, `mailbox.${string}`>,
    actor: AuditActor,
    mailboxId: string,
    oldValue?: Record<string, unknown> | null,
    newValue?: Record<string, unknown> | null,
  ): Promise<void> {
    return this.write({
      actor,
      eventType,
      entityType: 'mailbox',
      entityId: mailboxId,
      oldValue,
      newValue,
    });
  }

  syncEvent(
    eventType: Extract<AuditEventType, `sync.${string}`>,
    actor: AuditActor,
    orgId: string,
    oldValue?: Record<string, unknown> | null,
    newValue?: Record<string, unknown> | null,
  ): Promise<void> {
    return this.write({
      actor,
      eventType,
      entityType: 'sync',
      entityId: orgId,
      oldValue,
      newValue,
    });
  }

  orgHierarchyEvent(
    eventType: Extract<AuditEventType, `org_hierarchy.${string}`>,
    actor: AuditActor,
    userId: string,
    oldValue?: Record<string, unknown> | null,
    newValue?: Record<string, unknown> | null,
  ): Promise<void> {
    return this.write({
      actor,
      eventType,
      entityType: 'org_hierarchy',
      entityId: userId,
      oldValue,
      newValue,
    });
  }

  attachmentEvent(
    eventType: Extract<AuditEventType, `attachment.${string}`>,
    actor: AuditActor,
    attachmentId: string,
    newValue?: Record<string, unknown> | null,
  ): Promise<void> {
    return this.write({
      actor,
      eventType,
      entityType: 'attachment',
      entityId: attachmentId,
      newValue,
    });
  }

  // Helpers

  private redact(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = REDACTED;
      } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = this.redact(v as Record<string, unknown>);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}

/** Extract a standard AuditActor from an Express session user + request. */
export function actorFromRequest(
  user: {
    id: string;
    email: string;
    role: string;
    sessionId: string;
  },
  ipAddress?: string,
): AuditActor {
  return {
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    sessionId: user.sessionId,
    ipAddress,
  };
}
