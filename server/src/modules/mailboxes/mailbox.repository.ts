import { randomUUID } from 'node:crypto';
import { config } from '../../config/env';
import { PgMailboxRepository } from './mailbox.repository.pg';
import type {
  CreateMailboxInput,
  Mailbox,
  MailboxProvider,
  UpdateMailboxProfileInput,
  UpdateMailboxSyncConfigInput,
} from './mailbox.types';

export interface MailboxRepository {
  findAll(opts?: { limit?: number; offset?: number }): Promise<Mailbox[]>;
  findById(id: string): Promise<Mailbox | null>;
  findByAddress(address: string): Promise<Mailbox | null>;
  create(input: CreateMailboxInput): Promise<Mailbox>;
  createMany(inputs: CreateMailboxInput[]): Promise<Mailbox[]>;
  count(): Promise<number>;
  /** Aggregate sync status across all mailboxes without loading every row. */
  getSyncStatus(): Promise<'not_started' | 'syncing' | 'complete' | 'error'>;
  delete(id: string): Promise<void>;
  /** Delete all mailboxes for the given provider. Returns the count deleted. */
  deleteByProvider(provider: MailboxProvider): Promise<number>;
  /** Reset probe_status to 'pending' for the given mailboxes (or all if omitted). Returns the count updated. */
  resetProbe(mailboxIds?: string[]): Promise<number>;
  /** Update per-mailbox sync configuration fields. Returns the updated mailbox. */
  updateSyncConfig(id: string, input: UpdateMailboxSyncConfigInput): Promise<Mailbox>;
  /** Set owner_user_id for a mailbox. Safe to call multiple times (idempotent). */
  linkOwner(mailboxId: string, userId: string): Promise<void>;
  /** Update directory profile fields (name, title, dept, photo). */
  updateProfile(mailboxId: string, input: UpdateMailboxProfileInput): Promise<void>;
}

const ts = (): string => new Date().toISOString();

export class InMemoryMailboxRepository implements MailboxRepository {
  private readonly store = new Map<string, Mailbox>();

  async findAll(opts?: { limit?: number; offset?: number }): Promise<Mailbox[]> {
    const all = Array.from(this.store.values());
    const start = opts?.offset ?? 0;
    const end = start + (opts?.limit ?? all.length);
    return all.slice(start, end);
  }

  async findById(id: string): Promise<Mailbox | null> {
    return this.store.get(id) ?? null;
  }

  async findByAddress(address: string): Promise<Mailbox | null> {
    for (const m of this.store.values()) {
      if (m.address === address) return m;
    }
    return null;
  }

  async create(input: CreateMailboxInput): Promise<Mailbox> {
    const mailbox: Mailbox = {
      id: randomUUID(),
      orgId: input.orgId,
      ownerUserId: input.ownerUserId ?? null,
      address: input.address,
      provider: input.provider,
      providerUserId: input.providerUserId ?? null,
      syncToken: null,
      status: 'active',
      syncStatus: 'not_started',
      syncEnabled: true,
      syncFromDate: null,
      backfilledFromAt: null,
      syncPriority: 0,
      probeStatus: 'pending',
      earliestEmailAt: null,
      emailCountEstimate: null,
      totalMessages: 0,
      syncedMessages: 0,
      lastSyncAt: null,
      displayName: input.displayName ?? null,
      givenName: input.givenName ?? null,
      familyName: input.familyName ?? null,
      jobTitle: input.jobTitle ?? null,
      departmentName: input.departmentName ?? null,
      createdAt: ts(),
      updatedAt: ts(),
    };
    this.store.set(mailbox.id, mailbox);
    return mailbox;
  }

  async createMany(inputs: CreateMailboxInput[]): Promise<Mailbox[]> {
    return Promise.all(inputs.map((i) => this.create(i)));
  }

  async count(): Promise<number> {
    return this.store.size;
  }

  async getSyncStatus(): Promise<'not_started' | 'syncing' | 'complete' | 'error'> {
    const all = Array.from(this.store.values());
    if (all.length === 0) return 'not_started';
    if (all.some((m) => m.syncStatus === 'error')) return 'error';
    if (all.some((m) => m.syncStatus === 'syncing')) return 'syncing';
    if (all.every((m) => m.syncStatus === 'complete')) return 'complete';
    return 'not_started';
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async deleteByProvider(provider: MailboxProvider): Promise<number> {
    let count = 0;
    for (const [id, m] of this.store.entries()) {
      if (m.provider === provider) {
        this.store.delete(id);
        count++;
      }
    }
    return count;
  }

  async resetProbe(mailboxIds?: string[]): Promise<number> {
    let count = 0;
    for (const [id, mailbox] of this.store.entries()) {
      if (!mailboxIds || mailboxIds.includes(id)) {
        this.store.set(id, { ...mailbox, probeStatus: 'pending', updatedAt: ts() });
        count++;
      }
    }
    return count;
  }

  async updateSyncConfig(id: string, input: UpdateMailboxSyncConfigInput): Promise<Mailbox> {
    const mailbox = this.store.get(id);
    if (!mailbox) throw new Error(`Mailbox ${id} not found`);
    const updated: Mailbox = {
      ...mailbox,
      ...(input.syncEnabled !== undefined && { syncEnabled: input.syncEnabled }),
      ...(input.syncFromDate !== undefined && { syncFromDate: input.syncFromDate }),
      ...(input.syncPriority !== undefined && { syncPriority: input.syncPriority }),
      updatedAt: ts(),
    };
    this.store.set(id, updated);
    return updated;
  }

  async linkOwner(mailboxId: string, userId: string): Promise<void> {
    const mailbox = this.store.get(mailboxId);
    if (mailbox) this.store.set(mailboxId, { ...mailbox, ownerUserId: userId, updatedAt: ts() });
  }

  async updateProfile(mailboxId: string, input: UpdateMailboxProfileInput): Promise<void> {
    const mailbox = this.store.get(mailboxId);
    if (!mailbox) return;
    this.store.set(mailboxId, {
      ...mailbox,
      ...(input.displayName !== undefined && { displayName: input.displayName }),
      ...(input.givenName !== undefined && { givenName: input.givenName }),
      ...(input.familyName !== undefined && { familyName: input.familyName }),
      ...(input.jobTitle !== undefined && { jobTitle: input.jobTitle }),
      ...(input.departmentName !== undefined && { departmentName: input.departmentName }),
      ...(input.ownerUserId !== undefined && { ownerUserId: input.ownerUserId }),
      updatedAt: ts(),
    });
  }
}

// Shared so other in-memory repositories (notably org hierarchy scope
// resolution) see the same mailbox ownership data as the mailbox routes.
export const sharedMemoryMailboxRepo = new InMemoryMailboxRepository();

export function createMailboxRepository(): MailboxRepository {
  if (config.env === 'test' || config.database.driver === 'memory') {
    return sharedMemoryMailboxRepo;
  }
  return new PgMailboxRepository();
}
