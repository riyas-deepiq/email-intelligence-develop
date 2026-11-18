import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { alerts } from '../../db/schema';
import type { AlertEntry, CreateAlertInput } from './alert.types';

function toEntry(row: typeof alerts.$inferSelect): AlertEntry {
  return {
    id: row.id,
    severity: row.severity,
    category: row.category,
    title: row.title,
    description: row.description,
    source: row.source,
    mailboxId: row.mailboxId ?? null,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PgAlertRepository {
  async create(input: CreateAlertInput): Promise<AlertEntry> {
    const [row] = await getDb()
      .insert(alerts)
      .values({
        orgId: input.orgId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        description: input.description,
        source: input.source,
        mailboxId: input.mailboxId ?? undefined,
      })
      .returning();
    return toEntry(row!);
  }

  async findAll(orgId: string, limit = 200): Promise<AlertEntry[]> {
    const rows = await getDb()
      .select()
      .from(alerts)
      .where(eq(alerts.orgId, orgId))
      .orderBy(desc(alerts.createdAt))
      .limit(limit);
    return rows.map(toEntry);
  }

  async markAllRead(orgId: string): Promise<void> {
    await getDb()
      .update(alerts)
      .set({ read: true })
      .where(and(eq(alerts.orgId, orgId), eq(alerts.read, false)));
  }

  async markRead(id: string, orgId: string): Promise<boolean> {
    const rows = await getDb()
      .update(alerts)
      .set({ read: true })
      .where(and(eq(alerts.id, id), eq(alerts.orgId, orgId)))
      .returning({ id: alerts.id });
    return rows.length > 0;
  }
}
