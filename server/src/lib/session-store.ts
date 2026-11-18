import { randomUUID } from 'node:crypto';
import { and, eq, gt, like, lt, not } from 'drizzle-orm';
import IORedis, { type Redis } from 'ioredis';
import { config } from '../config/env';
import { getDb } from '../db/client';
import { withDbRetry } from '../db/retry';
import { logger } from './logger';
import { sessions } from '../db/schema';

/**
 * Server-side session store contract.
 * Holds refresh tokens keyed by sessionId so logout can truly revoke them.
 */
export interface SessionStore {
  set(
    sessionId: string,
    userId: string,
    ttlSec: number,
    metadata?: { deviceName?: string | null; userAgent?: string | null },
  ): Promise<void>;
  get(sessionId: string): Promise<string | null>;
  del(sessionId: string): Promise<void>;
  /** List all live login sessions for a user (excludes pwreset/invite tokens). */
  listByUser(userId: string): Promise<
    Array<{
      sessionId: string;
      expiresAt: Date;
      deviceName?: string | null;
      userAgent?: string | null;
    }>
  >;
}

// In-memory (tests / DB-less local runs)

export class MemorySessionStore implements SessionStore {
  private readonly store = new Map<
    string,
    { userId: string; expiresAt: number; deviceName?: string | null; userAgent?: string | null }
  >();

  async set(
    sessionId: string,
    userId: string,
    ttlSec: number,
    metadata?: { deviceName?: string | null; userAgent?: string | null },
  ): Promise<void> {
    this.store.set(sessionId, { userId, expiresAt: Date.now() + ttlSec * 1000, ...metadata });
  }

  async get(sessionId: string): Promise<string | null> {
    const entry = this.store.get(sessionId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(sessionId);
      return null;
    }
    return entry.userId;
  }

  async del(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }

  async listByUser(userId: string): Promise<
    Array<{
      sessionId: string;
      expiresAt: Date;
      deviceName?: string | null;
      userAgent?: string | null;
    }>
  > {
    const now = Date.now();
    const results: Array<{
      sessionId: string;
      expiresAt: Date;
      deviceName?: string | null;
      userAgent?: string | null;
    }> = [];
    for (const [sid, entry] of this.store.entries()) {
      if (
        entry.userId === userId &&
        now < entry.expiresAt &&
        !sid.startsWith('pwreset:') &&
        !sid.startsWith('invite:')
      ) {
        results.push({
          sessionId: sid,
          expiresAt: new Date(entry.expiresAt),
          deviceName: entry.deviceName,
          userAgent: entry.userAgent,
        });
      }
    }
    return results;
  }
}

// Postgres (dev + prod without Redis)
// Sessions are persisted in the `sessions` table so they survive server restarts.

class PgSessionStore implements SessionStore {
  constructor() {
    // Delete expired rows immediately on startup then every hour.
    this.cleanup().catch(() => {});
    setInterval(() => this.cleanup().catch(() => {}), 60 * 60 * 1000).unref();
  }

  private async cleanup(): Promise<void> {
    try {
      await withDbRetry(() => getDb().delete(sessions).where(lt(sessions.expiresAt, new Date())), {
        operationName: 'session cleanup',
      });
    } catch (err) {
      // 3D000 = PostgreSQL "invalid_catalog_name" (database does not exist yet).
      // This fires on startup before checkDbConnection() creates the DB — safe to skip.
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === '3D000') return;
      logger.warn({ err }, 'session cleanup failed');
    }
  }

  async set(
    sessionId: string,
    userId: string,
    ttlSec: number,
    metadata?: { deviceName?: string | null; userAgent?: string | null },
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    await withDbRetry(
      () =>
        getDb()
          .insert(sessions)
          .values({
            sessionId,
            userId,
            expiresAt,
            deviceName: metadata?.deviceName ?? null,
            userAgent: metadata?.userAgent ?? null,
          })
          .onConflictDoUpdate({
            target: sessions.sessionId,
            set: {
              userId,
              expiresAt,
              deviceName: metadata?.deviceName ?? null,
              userAgent: metadata?.userAgent ?? null,
            },
          }),
      { operationName: 'session set' },
    );
  }

  async get(sessionId: string): Promise<string | null> {
    return withDbRetry(
      async () => {
        const [row] = await getDb()
          .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
          .from(sessions)
          .where(eq(sessions.sessionId, sessionId))
          .limit(1);

        if (!row) return null;
        if (row.expiresAt < new Date()) {
          await this.del(sessionId);
          return null;
        }
        return row.userId;
      },
      { operationName: 'session get' },
    );
  }

  async del(sessionId: string): Promise<void> {
    await withDbRetry(() => getDb().delete(sessions).where(eq(sessions.sessionId, sessionId)), {
      operationName: 'session delete',
    });
  }

  async listByUser(userId: string): Promise<
    Array<{
      sessionId: string;
      expiresAt: Date;
      deviceName?: string | null;
      userAgent?: string | null;
    }>
  > {
    return withDbRetry(
      () =>
        getDb()
          .select({
            sessionId: sessions.sessionId,
            expiresAt: sessions.expiresAt,
            deviceName: sessions.deviceName,
            userAgent: sessions.userAgent,
          })
          .from(sessions)
          .where(
            and(
              eq(sessions.userId, userId),
              gt(sessions.expiresAt, new Date()),
              not(like(sessions.sessionId, 'pwreset:%')),
              not(like(sessions.sessionId, 'invite:%')),
            ),
          ),
      { operationName: 'session list by user' },
    );
  }
}

// Redis (production with REDIS_URL set)

class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: Redis) {}

  private key = (id: string): string => `sess:${id}`;
  private userKey = (userId: string): string => `user-sess:${userId}`;

  private isLoginSession(sessionId: string): boolean {
    return (
      !sessionId.startsWith('pwreset:') &&
      !sessionId.startsWith('invite:') &&
      !sessionId.startsWith('oidc:')
    );
  }

  async set(
    sessionId: string,
    userId: string,
    ttlSec: number,
    _metadata?: { deviceName?: string | null; userAgent?: string | null },
  ): Promise<void> {
    const multi = this.redis.multi();
    multi.set(this.key(sessionId), userId, 'EX', ttlSec);
    if (this.isLoginSession(sessionId)) {
      multi.sadd(this.userKey(userId), sessionId);
      multi.expire(this.userKey(userId), ttlSec);
    }
    await multi.exec();
  }

  async get(sessionId: string): Promise<string | null> {
    return this.redis.get(this.key(sessionId));
  }

  async del(sessionId: string): Promise<void> {
    const userId = await this.redis.get(this.key(sessionId));
    const multi = this.redis.multi();
    multi.del(this.key(sessionId));
    if (userId && this.isLoginSession(sessionId)) {
      multi.srem(this.userKey(userId), sessionId);
    }
    await multi.exec();
  }

  async listByUser(userId: string): Promise<
    Array<{
      sessionId: string;
      expiresAt: Date;
      deviceName?: string | null;
      userAgent?: string | null;
    }>
  > {
    const sids = await this.redis.smembers(this.userKey(userId));
    const results: Array<{ sessionId: string; expiresAt: Date }> = [];
    for (const sid of sids) {
      const [val, ttl] = await Promise.all([
        this.redis.get(this.key(sid)),
        this.redis.ttl(this.key(sid)),
      ]);
      if (val === userId && ttl > 0) {
        results.push({ sessionId: sid, expiresAt: new Date(Date.now() + ttl * 1000) });
      } else {
        // Session expired or doesn't belong to this user — prune the index.
        await this.redis.srem(this.userKey(userId), sid);
      }
    }
    return results;
  }
}

// Factory

function createSessionStore(): SessionStore {
  // Tests and DB-less local runs — always use memory regardless of other settings.
  if (config.database.driver === 'memory') {
    return new MemorySessionStore();
  }

  // Production with Redis.
  if (config.session.redisUrl) {
    const redis = new IORedis(config.session.redisUrl, { lazyConnect: true });
    return new RedisSessionStore(redis);
  }

  // Default: Postgres-backed sessions (survives server restarts).
  return new PgSessionStore();
}

export const sessionStore: SessionStore = createSessionStore();

export function newSessionId(): string {
  return randomUUID();
}
