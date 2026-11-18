import { randomUUID } from 'node:crypto';
import { config } from '../../config/env';
import { PgUserRepository } from './user.repository.pg';
import type { CreateUserInput, User } from './user.types';

export interface UserRepository {
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  /** Auth-only: find a user including status field. */
  findByIdInternal(id: string): Promise<(User & { status: string }) | null>;
  /** Auth-only: find a user including status AND passwordHash for credential verification. */
  findByIdWithHash(
    id: string,
  ): Promise<(User & { status: string; passwordHash: string | null }) | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
  /** Auth-only: create a user and store its pre-hashed password. */
  createWithHash(input: CreateUserInput, passwordHash: string): Promise<User>;
  /** Auth-only: update password hash, email, status, role, custom role, displayName, and/or lastLoginAt for a user. */
  updateUser(
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
  ): Promise<User>;
  deleteById(id: string): Promise<void>;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<
    string,
    User & { passwordHash?: string; status?: string; lastLoginAt?: string | null }
  >();

  async findAll(): Promise<User[]> {
    return [...this.users.values()];
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByIdInternal(id: string): Promise<(User & { status: string }) | null> {
    const user = this.users.get(id);
    if (!user) return null;
    return { ...user, status: user.status ?? 'active' };
  }

  async findByIdWithHash(
    id: string,
  ): Promise<(User & { status: string; passwordHash: string | null }) | null> {
    const user = this.users.get(id);
    if (!user) return null;
    return { ...user, status: user.status ?? 'active', passwordHash: user.passwordHash ?? null };
  }

  async findByEmail(email: string): Promise<User | null> {
    const target = email.toLowerCase();
    return [...this.users.values()].find((u) => u.email === target) ?? null;
  }

  async create(input: CreateUserInput): Promise<User> {
    return this.createWithHash(input, '');
  }

  async createWithHash(input: CreateUserInput, passwordHash: string): Promise<User> {
    const user = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      role: input.role ?? 'employee',
      roleId: input.roleId ?? null,
      roleName: null,
      createdAt: new Date().toISOString(),
      passwordHash,
      status: input.status ?? 'active',
      lastLoginAt: null as string | null,
    };
    this.users.set(user.id, user);
    return user;
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
    const user = this.users.get(id);
    if (!user) throw new Error(`User ${id} not found`);
    if (updates.passwordHash !== undefined) user.passwordHash = updates.passwordHash;
    if (updates.email !== undefined) user.email = updates.email.toLowerCase();
    if (updates.status !== undefined) user.status = updates.status;
    if (updates.displayName !== undefined) user.displayName = updates.displayName;
    if (updates.role !== undefined) {
      user.role = updates.role as User['role'];
      if (updates.roleId === undefined) user.roleId = null;
      if (updates.roleId === undefined) user.roleName = null;
    }
    if (updates.roleId !== undefined) {
      user.roleId = updates.roleId;
      if (updates.roleId === null) user.roleName = null;
    }
    if (updates.lastLoginAt !== undefined) user.lastLoginAt = updates.lastLoginAt.toISOString();
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      roleId: user.roleId ?? null,
      roleName: user.roleName ?? null,
      status: user.status ?? 'active',
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt,
    };
  }

  async deleteById(id: string): Promise<void> {
    this.users.delete(id);
  }
}

// Single shared instance so multiple createUserRepository() calls in the same
// process share the same store. Exported for e2e test seeding only.
export const sharedMemoryRepo = new InMemoryUserRepository();

/**
 * Selects the repository implementation. Tests and DB-less local runs use the
 * in-memory store; everything else uses PostgreSQL (Drizzle). Swap behavior via
 * the DB_DRIVER env var.
 */
export function createUserRepository(): UserRepository {
  if (config.env === 'test' || config.database.driver === 'memory') {
    return sharedMemoryRepo;
  }
  return new PgUserRepository();
}
