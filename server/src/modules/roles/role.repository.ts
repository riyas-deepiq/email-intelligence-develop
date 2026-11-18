import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { config } from '../../config/env';
import { getDb } from '../../db/client';
import { roles, type RoleRow } from '../../db/schema';
import type { CreateRoleInput, CustomRole, UpdateRoleInput } from './role.types';

export interface RoleRepository {
  listCustomRoles(): Promise<CustomRole[]>;
  findById(id: string): Promise<CustomRole | null>;
  create(input: CreateRoleInput): Promise<CustomRole>;
  update(id: string, input: UpdateRoleInput): Promise<CustomRole | null>;
  delete(id: string): Promise<void>;
}

function toCustomRole(row: RoleRow): CustomRole {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    baseRole: row.baseRole === 'admin' ? 'admin' : 'employee',
    permissions: row.permissions ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PgRoleRepository implements RoleRepository {
  async listCustomRoles(): Promise<CustomRole[]> {
    const rows = await getDb().select().from(roles).orderBy(asc(roles.name));
    return rows.map(toCustomRole);
  }

  async findById(id: string): Promise<CustomRole | null> {
    const [row] = await getDb().select().from(roles).where(eq(roles.id, id)).limit(1);
    return row ? toCustomRole(row) : null;
  }

  async create(input: CreateRoleInput): Promise<CustomRole> {
    const [row] = await getDb()
      .insert(roles)
      .values({
        name: input.name,
        description: input.description,
        baseRole: input.baseRole,
        permissions: input.permissions,
      })
      .returning();
    return toCustomRole(row);
  }

  async update(id: string, input: UpdateRoleInput): Promise<CustomRole | null> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) values.name = input.name;
    if (input.description !== undefined) values.description = input.description;
    if (input.baseRole !== undefined) values.baseRole = input.baseRole;
    if (input.permissions !== undefined) values.permissions = input.permissions;

    const [row] = await getDb().update(roles).set(values).where(eq(roles.id, id)).returning();
    return row ? toCustomRole(row) : null;
  }

  async delete(id: string): Promise<void> {
    await getDb().delete(roles).where(eq(roles.id, id));
  }
}

export class InMemoryRoleRepository implements RoleRepository {
  private readonly roles = new Map<string, CustomRole>();

  async listCustomRoles(): Promise<CustomRole[]> {
    return [...this.roles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<CustomRole | null> {
    return this.roles.get(id) ?? null;
  }

  async create(input: CreateRoleInput): Promise<CustomRole> {
    const now = new Date().toISOString();
    const role: CustomRole = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      baseRole: input.baseRole,
      permissions: input.permissions,
      createdAt: now,
      updatedAt: now,
    };
    this.roles.set(role.id, role);
    return role;
  }

  async update(id: string, input: UpdateRoleInput): Promise<CustomRole | null> {
    const current = this.roles.get(id);
    if (!current) return null;
    const updated: CustomRole = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    this.roles.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.roles.delete(id);
  }
}

export const sharedMemoryRoleRepo = new InMemoryRoleRepository();

export function createRoleRepository(): RoleRepository {
  if (config.env === 'test' || config.database.driver === 'memory') {
    return sharedMemoryRoleRepo;
  }
  return new PgRoleRepository();
}
