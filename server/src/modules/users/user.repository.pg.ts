import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { NotFoundError } from '../../lib/errors';
import { users, mailboxes, roles, type UserRow } from '../../db/schema';
import type { UserRepository } from './user.repository';
import type { CreateUserInput, User } from './user.types';

/** Map a DB row to the public domain `User` (strips sensitive fields). */
function toUser(row: UserRow, roleName: string | null = null): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    roleId: row.roleId ?? null,
    roleName,
    status: row.status,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Map a DB row including passwordHash — only used internally by auth. */
function toUserWithHash(
  row: UserRow,
  roleName: string | null = null,
): User & { passwordHash: string | null } {
  return { ...toUser(row, roleName), passwordHash: row.passwordHash };
}

/**
 * PostgreSQL-backed user repository (Drizzle). Implements exactly the same
 * `UserRepository` contract as the in-memory version, so the service and controller
 * are unaffected by the swap.
 */
export class PgUserRepository implements UserRepository {
  async findAll(): Promise<User[]> {
    const rows = await getDb()
      .select({ user: users, mailboxId: mailboxes.id, roleName: roles.name })
      .from(users)
      .leftJoin(mailboxes, eq(mailboxes.ownerUserId, users.id))
      .leftJoin(roles, eq(users.roleId, roles.id));
    return rows.map((r) => ({
      ...toUser(r.user, r.roleName ?? null),
      mailboxId: r.mailboxId ?? null,
    }));
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await getDb()
      .select({ user: users, roleName: roles.name })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, id))
      .limit(1);
    return row ? toUser(row.user, row.roleName ?? null) : null;
  }

  async findByIdInternal(id: string): Promise<(User & { status: string }) | null> {
    const [row] = await getDb()
      .select({ user: users, roleName: roles.name })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, id))
      .limit(1);
    return row ? toUser(row.user, row.roleName ?? null) : null;
  }

  async findByIdWithHash(
    id: string,
  ): Promise<(User & { status: string; passwordHash: string | null }) | null> {
    const [row] = await getDb()
      .select({ user: users, roleName: roles.name })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, id))
      .limit(1);
    return row ? toUserWithHash(row.user, row.roleName ?? null) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await getDb()
      .select({ user: users, roleName: roles.name })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    // Return with passwordHash so the auth service can verify credentials.
    return row ? toUserWithHash(row.user, row.roleName ?? null) : null;
  }

  async create(input: CreateUserInput): Promise<User> {
    return this.createWithHash(input, '');
  }

  async createWithHash(input: CreateUserInput, passwordHash: string): Promise<User> {
    const [row] = await getDb()
      .insert(users)
      .values({
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        role: input.role ?? 'employee',
        roleId: input.roleId ?? null,
        passwordHash: passwordHash || null,
        status: input.status ?? 'active',
      })
      .returning();
    return toUser(row);
  }

  async deleteById(id: string): Promise<void> {
    await getDb().delete(users).where(eq(users.id, id));
  }

  async updateUser(
    id: string,
    updates: {
      passwordHash?: string;
      email?: string;
      status?: string;
      displayName?: string;
      role?: string;
      roleId?: string | null;
      lastLoginAt?: Date;
    },
  ): Promise<User> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.passwordHash !== undefined) values.passwordHash = updates.passwordHash;
    if (updates.email !== undefined) values.email = updates.email.toLowerCase();
    if (updates.status !== undefined) values.status = updates.status;
    if (updates.displayName !== undefined) values.displayName = updates.displayName;
    if (updates.role !== undefined) {
      values.role = updates.role;
      if (updates.roleId === undefined) values.roleId = null;
    }
    if (updates.roleId !== undefined) values.roleId = updates.roleId;
    if (updates.lastLoginAt !== undefined) values.lastLoginAt = updates.lastLoginAt;

    const [row] = await getDb().update(users).set(values).where(eq(users.id, id)).returning();
    if (!row) throw new NotFoundError(`User ${id} not found`);
    const updated = await this.findById(row.id);
    return updated ?? toUser(row);
  }
}
