import { config } from '../../config/env';
import { PgAuditRepository } from './audit.repository.pg';
import type { AuditLogEntry, AuditQueryFilter, WriteAuditInput } from './audit.types';

export interface AuditRepository {
  write(input: WriteAuditInput): Promise<void>;
  query(filter: AuditQueryFilter): Promise<AuditLogEntry[]>;
  count(filter: AuditQueryFilter): Promise<number>;
}

export class InMemoryAuditRepository implements AuditRepository {
  async write(_input: WriteAuditInput): Promise<void> {
    // no-op in memory mode — audit writes are silently dropped
  }
  async query(_filter: AuditQueryFilter): Promise<AuditLogEntry[]> {
    return [];
  }

  async count(_filter: AuditQueryFilter): Promise<number> {
    return 0;
  }
}

export function createAuditRepository(): AuditRepository {
  if (config.env === 'test' || config.database.driver === 'memory') {
    return new InMemoryAuditRepository();
  }
  return new PgAuditRepository();
}
