import { randomUUID } from 'node:crypto';
import { config } from '../../config/env';
import { PgAlertRepository } from './alert.repository.pg';
import type { AlertEntry, CreateAlertInput } from './alert.types';

export interface AlertRepository {
  create(input: CreateAlertInput): Promise<AlertEntry>;
  findAll(orgId: string, limit?: number): Promise<AlertEntry[]>;
  markAllRead(orgId: string): Promise<void>;
  markRead(id: string, orgId: string): Promise<boolean>;
}

export class InMemoryAlertRepository implements AlertRepository {
  private readonly store = new Map<string, AlertEntry>();

  async create(input: CreateAlertInput): Promise<AlertEntry> {
    const entry: AlertEntry = {
      id: randomUUID(),
      severity: input.severity,
      category: input.category,
      title: input.title,
      description: input.description,
      source: input.source,
      mailboxId: input.mailboxId ?? null,
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.store.set(entry.id, entry);
    return entry;
  }

  async findAll(_orgId: string, limit = 200): Promise<AlertEntry[]> {
    return Array.from(this.store.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async markAllRead(_orgId: string): Promise<void> {
    for (const entry of this.store.values()) entry.read = true;
  }

  async markRead(id: string, _orgId: string): Promise<boolean> {
    const entry = this.store.get(id);
    if (!entry) return false;
    entry.read = true;
    return true;
  }
}

export function createAlertRepository(): AlertRepository {
  if (config.env === 'test' || config.database.driver === 'memory') {
    return new InMemoryAlertRepository();
  }
  return new PgAlertRepository();
}
