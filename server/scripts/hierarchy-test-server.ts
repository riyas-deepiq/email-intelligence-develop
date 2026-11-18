/**
 * Local browser rehearsal only. Refuses any non-empty database and non-test name.
 * See docs/11-org-hierarchy-rollout.md. No collector/provider/SMTP calls are needed.
 */
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { config } from '../src/config/env';
import { closeDb, getDb, runMigrations } from '../src/db/client';
import { users, organizations, mailboxes } from '../src/db/schema';
import { hashPassword } from '../src/lib/password';

async function main(): Promise<void> {
  if (
    !config.database.url ||
    !/^hierarchy_test_[a-z0-9_]+$/.test(new URL(config.database.url).pathname.slice(1)) ||
    config.database.driver !== 'postgres' ||
    config.env === 'production'
  ) {
    throw new Error('Use a NEW dedicated hierarchy_test_* PostgreSQL database, never production');
  }
  const db = getDb();
  const existing = await db.execute(
    sql`SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1`,
  );
  if (existing.rowCount) throw new Error('Refusing non-empty database');
  await runMigrations();
  const [org] = await db
    .insert(organizations)
    .values({
      name: 'Hierarchy browser rehearsal',
      domains: 'hierarchy.test',
      adminEmail: 'admin@hierarchy.test',
    })
    .returning();
  const passwordHash = await hashPassword('HierarchyTest-only-2026!');
  await db
    .insert(users)
    .values({
      email: 'admin@hierarchy.test',
      displayName: 'Test Administrator',
      role: 'superadmin',
      passwordHash,
      status: 'active',
    });
  const people = await db
    .insert(users)
    .values(
      ['CEO', 'CTO', 'Employee'].map((displayName) => ({
        email: displayName.toLowerCase() + '@hierarchy.test',
        displayName,
        role: 'employee' as const,
        status: 'active',
      })),
    )
    .returning();
  await db
    .insert(mailboxes)
    .values([
      ...people.map((u) => ({
        orgId: org.id,
        ownerUserId: u.id,
        address: u.email,
        provider: 'm365',
      })),
      ...Array.from({ length: 205 }, (_, i) => ({
        orgId: org.id,
        address: 'mailbox-' + String(i).padStart(3, '0') + '@hierarchy.test',
        displayName: 'Mailbox ' + i,
        provider: 'm365',
      })),
    ]);
  const server = createApp().listen(config.port, '127.0.0.1', () =>
    process.stdout.write('Dedicated hierarchy browser fixture ready\n'),
  );
  const stop = (): void => {
    server.close(() => {
      void closeDb().then(() => process.exit(0));
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
void main().catch((error: unknown) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
  void closeDb();
});
