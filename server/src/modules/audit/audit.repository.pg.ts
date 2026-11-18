import {
  and,
  count as drizzleCount,
  desc,
  eq,
  gte,
  ilike,
  lt,
  lt as ltOp,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { getDb } from '../../db/client';
import { auditLog, mailboxes, users } from '../../db/schema';
import type { AuditLogEntry, AuditQueryFilter, WriteAuditInput } from './audit.types';

function toEntry(
  row: typeof auditLog.$inferSelect,
  mailboxId: string | null,
  actorDisplayName: string | null,
): AuditLogEntry {
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    actorId: row.actorId ?? null,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole,
    ipAddress: row.ipAddress ?? null,
    sessionId: row.sessionId ?? null,
    eventType: row.eventType,
    entityType: row.entityType,
    entityId: row.entityId,
    oldValue: row.oldValue ?? null,
    newValue: row.newValue ?? null,
    mailboxId,
    actorDisplayName,
  };
}

function buildConditions(filter: AuditQueryFilter, includeCursor: boolean): SQL[] {
  const conditions: SQL[] = [];

  if (filter.actorId) conditions.push(eq(auditLog.actorId, filter.actorId));
  if (filter.actorEmail) conditions.push(ilike(auditLog.actorEmail, `%${filter.actorEmail}%`));
  if (filter.entityType) conditions.push(eq(auditLog.entityType, filter.entityType));
  if (filter.entityId) conditions.push(eq(auditLog.entityId, filter.entityId));
  if (filter.eventType) conditions.push(eq(auditLog.eventType, filter.eventType));
  if (filter.search) {
    const like = `%${filter.search}%`;
    conditions.push(
      or(
        ilike(auditLog.actorEmail, like),
        ilike(auditLog.actorRole, like),
        ilike(auditLog.eventType, like),
        ilike(auditLog.entityType, like),
        ilike(auditLog.entityId, like),
        ilike(auditLog.ipAddress, like),
        sql`${auditLog.oldValue}::text ILIKE ${like}`,
        sql`${auditLog.newValue}::text ILIKE ${like}`,
      )!,
    );
  }
  if (filter.from) conditions.push(gte(auditLog.ts, filter.from));
  if (filter.to) conditions.push(lt(auditLog.ts, filter.to));
  if (includeCursor && filter.cursor) conditions.push(ltOp(auditLog.id, filter.cursor));

  return conditions;
}

export class PgAuditRepository {
  async write(input: WriteAuditInput): Promise<void> {
    await getDb()
      .insert(auditLog)
      .values({
        actorId: input.actor.actorId ?? undefined,
        actorEmail: input.actor.actorEmail,
        actorRole: input.actor.actorRole,
        ipAddress: input.actor.ipAddress,
        sessionId: input.actor.sessionId,
        eventType: input.eventType,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValue: (input.oldValue ?? null) as Record<string, unknown> | null,
        newValue: (input.newValue ?? null) as Record<string, unknown> | null,
      });
  }

  async query(filter: AuditQueryFilter): Promise<AuditLogEntry[]> {
    const db = getDb();
    const conditions = buildConditions(filter, true);

    const rows = await db
      .select({ auditLog, mailboxId: mailboxes.id, actorDisplayName: users.displayName })
      .from(auditLog)
      // Resolve the actor's mailbox by ownership link (not by email — survives
      // email changes and avoids case-sensitivity issues) so the Who column
      // can show a real profile photo instead of just initials.
      .leftJoin(mailboxes, eq(mailboxes.ownerUserId, auditLog.actorId))
      // Resolve the actor's current display name too — actorEmail alone is a
      // frozen historical snapshot, this always reflects who they are today.
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.ts))
      .limit(filter.limit ?? 50);

    return rows.map((r) => toEntry(r.auditLog, r.mailboxId ?? null, r.actorDisplayName ?? null));
  }

  async count(filter: AuditQueryFilter): Promise<number> {
    const conditions = buildConditions(filter, false);
    const [{ total }] = await getDb()
      .select({ total: drizzleCount() })
      .from(auditLog)
      .where(conditions.length ? and(...conditions) : undefined);

    return total;
  }
}
