import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { organizations, type OrgRow } from '../../db/schema';
import type { OrgRepository } from './org.repository';
import type {
  CreateOrgInput,
  Org,
  SkippableStep,
  UpdateJitConfigInput,
  UpdateOrgSyncConfigInput,
} from './org.types';
import type { UserRole } from '../users/user.types';

function toOrg(row: OrgRow): Org {
  return {
    id: row.id,
    name: row.name,
    domains: row.domains,
    adminEmail: row.adminEmail,
    jitEnabled: row.jitEnabled,
    jitDefaultRole: (row.jitDefaultRole as UserRole) ?? 'employee',
    syncEnabled: row.syncEnabled,
    globalSyncFromDate: row.globalSyncFromDate?.toISOString() ?? null,
    ssoSkipped: row.ssoSkipped,
    hierarchySkipped: row.hierarchySkipped,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PgOrgRepository implements OrgRepository {
  async findFirst(): Promise<Org | null> {
    const [row] = await getDb().select().from(organizations).limit(1);
    return row ? toOrg(row) : null;
  }

  async upsert(input: CreateOrgInput): Promise<Org> {
    const existing = await this.findFirst();
    if (existing) {
      const [row] = await getDb()
        .update(organizations)
        .set({
          name: input.name,
          domains: input.domains,
          adminEmail: input.adminEmail,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, existing.id))
        .returning();
      return toOrg(row);
    }
    const [row] = await getDb()
      .insert(organizations)
      .values({ name: input.name, domains: input.domains, adminEmail: input.adminEmail })
      .returning();
    return toOrg(row);
  }

  async updateJitConfig(id: string, input: UpdateJitConfigInput): Promise<Org> {
    const [row] = await getDb()
      .update(organizations)
      .set({
        jitEnabled: input.jitEnabled,
        jitDefaultRole: input.jitDefaultRole,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id))
      .returning();
    return toOrg(row);
  }

  async updateSkip(id: string, step: SkippableStep): Promise<Org> {
    const patch = step === 'sso' ? { ssoSkipped: true } : { hierarchySkipped: true };
    const [row] = await getDb()
      .update(organizations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    return toOrg(row);
  }

  async updateSyncConfig(id: string, input: UpdateOrgSyncConfigInput): Promise<Org> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.syncEnabled !== undefined) patch['syncEnabled'] = input.syncEnabled;
    if (input.globalSyncFromDate !== undefined)
      patch['globalSyncFromDate'] = input.globalSyncFromDate
        ? new Date(input.globalSyncFromDate)
        : null;
    const [row] = await getDb()
      .update(organizations)
      .set(patch)
      .where(eq(organizations.id, id))
      .returning();
    return toOrg(row);
  }
}
