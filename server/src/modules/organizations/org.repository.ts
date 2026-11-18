import { randomUUID } from 'node:crypto';
import { config } from '../../config/env';
import { PgOrgRepository } from './org.repository.pg';
import type {
  CreateOrgInput,
  Org,
  SkippableStep,
  UpdateJitConfigInput,
  UpdateOrgSyncConfigInput,
} from './org.types';

export interface OrgRepository {
  findFirst(): Promise<Org | null>;
  upsert(input: CreateOrgInput): Promise<Org>;
  updateJitConfig(id: string, input: UpdateJitConfigInput): Promise<Org>;
  updateSkip(id: string, step: SkippableStep): Promise<Org>;
  updateSyncConfig(id: string, input: UpdateOrgSyncConfigInput): Promise<Org>;
}

export class InMemoryOrgRepository implements OrgRepository {
  private store: Org | null = null;

  async findFirst(): Promise<Org | null> {
    return this.store;
  }

  async upsert(input: CreateOrgInput): Promise<Org> {
    const now = new Date().toISOString();
    this.store = this.store
      ? { ...this.store, ...input, updatedAt: now }
      : {
          id: randomUUID(),
          ...input,
          jitEnabled: false,
          jitDefaultRole: 'employee',
          syncEnabled: true,
          globalSyncFromDate: null,
          ssoSkipped: false,
          hierarchySkipped: false,
          createdAt: now,
          updatedAt: now,
        };
    return this.store;
  }

  async updateJitConfig(id: string, input: UpdateJitConfigInput): Promise<Org> {
    if (!this.store || this.store.id !== id) throw new Error('Organization not found');
    this.store = { ...this.store, ...input, updatedAt: new Date().toISOString() };
    return this.store;
  }

  async updateSkip(id: string, step: SkippableStep): Promise<Org> {
    if (!this.store || this.store.id !== id) throw new Error('Organization not found');
    const patch = step === 'sso' ? { ssoSkipped: true } : { hierarchySkipped: true };
    this.store = { ...this.store, ...patch, updatedAt: new Date().toISOString() };
    return this.store;
  }

  async updateSyncConfig(id: string, input: UpdateOrgSyncConfigInput): Promise<Org> {
    if (!this.store || this.store.id !== id) throw new Error('Organization not found');
    this.store = {
      ...this.store,
      ...(input.syncEnabled !== undefined && { syncEnabled: input.syncEnabled }),
      ...(input.globalSyncFromDate !== undefined && {
        globalSyncFromDate: input.globalSyncFromDate,
      }),
      updatedAt: new Date().toISOString(),
    };
    return this.store;
  }
}

export const sharedMemoryOrgRepo = new InMemoryOrgRepository();

export function createOrgRepository(): OrgRepository {
  if (config.env === 'test' || config.database.driver === 'memory') {
    return sharedMemoryOrgRepo;
  }
  return new PgOrgRepository();
}
