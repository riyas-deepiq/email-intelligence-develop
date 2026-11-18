import { eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { mailboxes, type MailboxRow } from '../../db/schema';
import type { MailboxRepository } from './mailbox.repository';
import type {
  CreateMailboxInput,
  Mailbox,
  MailboxProvider,
  MailboxStatus,
  MailboxSyncStatus,
  ProbeStatus,
  UpdateMailboxProfileInput,
  UpdateMailboxSyncConfigInput,
} from './mailbox.types';

function toMailbox(row: MailboxRow): Mailbox {
  return {
    id: row.id,
    orgId: row.orgId,
    ownerUserId: row.ownerUserId ?? null,
    address: row.address,
    provider: row.provider as MailboxProvider,
    providerUserId: row.providerUserId ?? null,
    syncToken: row.syncToken ?? null,
    status: row.status as MailboxStatus,
    syncStatus: row.syncStatus as MailboxSyncStatus,
    syncEnabled: row.syncEnabled,
    syncFromDate: row.syncFromDate?.toISOString() ?? null,
    backfilledFromAt: row.backfilledFromAt?.toISOString() ?? null,
    syncPriority: row.syncPriority,
    probeStatus: row.probeStatus as ProbeStatus,
    earliestEmailAt: row.earliestEmailAt?.toISOString() ?? null,
    emailCountEstimate: row.emailCountEstimate ?? null,
    totalMessages: row.totalMessages,
    syncedMessages: row.syncedMessages,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    displayName: row.displayName ?? null,
    givenName: row.givenName ?? null,
    familyName: row.familyName ?? null,
    jobTitle: row.jobTitle ?? null,
    departmentName: row.departmentName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PgMailboxRepository implements MailboxRepository {
  async findAll(opts?: { limit?: number; offset?: number }): Promise<Mailbox[]> {
    const rows = await getDb()
      .select()
      .from(mailboxes)
      .orderBy(mailboxes.id)
      .limit(opts?.limit ?? 100)
      .offset(opts?.offset ?? 0);
    return rows.map(toMailbox);
  }

  async findById(id: string): Promise<Mailbox | null> {
    const [row] = await getDb().select().from(mailboxes).where(eq(mailboxes.id, id));
    return row ? toMailbox(row) : null;
  }

  async findByAddress(address: string): Promise<Mailbox | null> {
    const [row] = await getDb().select().from(mailboxes).where(eq(mailboxes.address, address));
    return row ? toMailbox(row) : null;
  }

  async create(input: CreateMailboxInput): Promise<Mailbox> {
    const [row] = await getDb()
      .insert(mailboxes)
      .values({
        orgId: input.orgId,
        ownerUserId: input.ownerUserId ?? null,
        address: input.address,
        provider: input.provider,
        providerUserId: input.providerUserId ?? null,
        displayName: input.displayName ?? null,
        givenName: input.givenName ?? null,
        familyName: input.familyName ?? null,
        jobTitle: input.jobTitle ?? null,
        departmentName: input.departmentName ?? null,
      })
      .returning();
    return toMailbox(row);
  }

  async createMany(inputs: CreateMailboxInput[]): Promise<Mailbox[]> {
    if (inputs.length === 0) return [];
    const rows = await getDb()
      .insert(mailboxes)
      .values(
        inputs.map((i) => ({
          orgId: i.orgId,
          ownerUserId: i.ownerUserId ?? null,
          address: i.address,
          provider: i.provider,
          providerUserId: i.providerUserId ?? null,
          displayName: i.displayName ?? null,
          givenName: i.givenName ?? null,
          familyName: i.familyName ?? null,
          jobTitle: i.jobTitle ?? null,
          departmentName: i.departmentName ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning();
    return rows.map(toMailbox);
  }

  async count(): Promise<number> {
    const [row] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(mailboxes);
    return row?.n ?? 0;
  }

  async getSyncStatus(): Promise<'not_started' | 'syncing' | 'complete' | 'error'> {
    const [row] = await getDb()
      .select({
        hasError: sql<boolean>`bool_or(${mailboxes.syncStatus} = 'error')`,
        hasSyncing: sql<boolean>`bool_or(${mailboxes.syncStatus} = 'syncing')`,
        allComplete: sql<boolean>`bool_and(${mailboxes.syncStatus} = 'complete')`,
      })
      .from(mailboxes);
    if (!row) return 'not_started';
    if (row.hasError) return 'error';
    if (row.hasSyncing) return 'syncing';
    if (row.allComplete) return 'complete';
    return 'not_started';
  }

  async delete(id: string): Promise<void> {
    await getDb().delete(mailboxes).where(eq(mailboxes.id, id));
  }

  async deleteByProvider(provider: MailboxProvider): Promise<number> {
    const rows = await getDb()
      .delete(mailboxes)
      .where(eq(mailboxes.provider, provider))
      .returning({ id: mailboxes.id });
    return rows.length;
  }

  async resetProbe(mailboxIds?: string[]): Promise<number> {
    const patch = { probeStatus: 'pending', updatedAt: new Date() };
    const rows =
      mailboxIds && mailboxIds.length > 0
        ? await getDb()
            .update(mailboxes)
            .set(patch)
            .where(inArray(mailboxes.id, mailboxIds))
            .returning({ id: mailboxes.id })
        : await getDb().update(mailboxes).set(patch).returning({ id: mailboxes.id });
    return rows.length;
  }

  async updateSyncConfig(id: string, input: UpdateMailboxSyncConfigInput): Promise<Mailbox> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.syncEnabled !== undefined) patch['syncEnabled'] = input.syncEnabled;
    if (input.syncPriority !== undefined) patch['syncPriority'] = input.syncPriority;
    if (input.syncFromDate !== undefined) {
      patch['syncFromDate'] = input.syncFromDate ? new Date(input.syncFromDate) : null;
    }
    const [row] = await getDb()
      .update(mailboxes)
      .set(patch)
      .where(eq(mailboxes.id, id))
      .returning();
    if (!row) throw new Error(`Mailbox ${id} not found`);
    return toMailbox(row);
  }

  async linkOwner(mailboxId: string, userId: string): Promise<void> {
    await getDb()
      .update(mailboxes)
      .set({ ownerUserId: userId, updatedAt: new Date() })
      .where(eq(mailboxes.id, mailboxId));
  }

  async updateProfile(mailboxId: string, input: UpdateMailboxProfileInput): Promise<void> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.displayName !== undefined) patch['displayName'] = input.displayName;
    if (input.givenName !== undefined) patch['givenName'] = input.givenName;
    if (input.familyName !== undefined) patch['familyName'] = input.familyName;
    if (input.jobTitle !== undefined) patch['jobTitle'] = input.jobTitle;
    if (input.departmentName !== undefined) patch['departmentName'] = input.departmentName;
    if (input.ownerUserId !== undefined) patch['ownerUserId'] = input.ownerUserId;
    await getDb().update(mailboxes).set(patch).where(eq(mailboxes.id, mailboxId));
  }
}
