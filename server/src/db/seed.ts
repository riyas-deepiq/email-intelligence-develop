import { eq } from 'drizzle-orm';
import { config } from '../config/env';
import { hashPassword } from '../lib/password';
import { logger } from '../lib/logger';
import { getDb } from './client';
import { authProviders, users } from './schema';

/**
 * Seeds the default Super Admin on first startup.
 * Idempotent — does nothing if a superadmin already exists in the users table.
 * Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in .env.
 */
export async function seedSuperAdmin(): Promise<void> {
  if (config.database.driver !== 'postgres') return;
  // Installed deployments provision their own administrator (SEED_DEFAULT_ADMIN=false)
  // — creating the default-password account there would be a standing vulnerability.
  if (!config.auth.seed.enabled) return;

  const db = getDb();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'superadmin'))
    .limit(1);

  if (existing.length > 0) return; // already seeded

  const passwordHash = await hashPassword(config.auth.seed.adminPassword);

  await db.insert(users).values({
    email: config.auth.seed.adminEmail.toLowerCase(),
    displayName: 'Super Admin',
    role: 'superadmin',
    passwordHash,
    status: 'pending_setup',
  });

  logger.info(
    { email: config.auth.seed.adminEmail },
    'Default Super Admin created - change the password after first login',
  );
}

/**
 * Inserts the three default auth provider rows if they don't already exist.
 * Idempotent — safe to call on every startup.
 */
export async function seedAuthProviders(): Promise<void> {
  if (config.database.driver !== 'postgres') return;

  const db = getDb();

  const existing = await db.select({ provider: authProviders.provider }).from(authProviders);

  const existingSet = new Set(existing.map((r) => r.provider));

  const defaults = [{ provider: 'email_password' as const, enabled: true }] as const;

  for (const row of defaults) {
    if (!existingSet.has(row.provider)) {
      await db.insert(authProviders).values(row);
    }
  }

  logger.info('Auth provider defaults ensured');
}
