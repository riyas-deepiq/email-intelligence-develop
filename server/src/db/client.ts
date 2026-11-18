import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import { config } from '../config/env';
import { logger } from '../lib/logger';
import { seedAuthProviders, seedSuperAdmin } from './seed';
import * as schema from './schema';

let pool: Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

/**
 * Lazily creates the connection pool + Drizzle client on first use. Lazy so that
 * importing this module (e.g. from the repository factory) never opens a connection
 * until a query actually runs — which keeps tests and DB-less local runs working.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (!db) {
    if (!config.database.url) {
      throw new Error('DATABASE_URL is required when DB_DRIVER=postgres');
    }
    pool = new Pool({
      connectionString: config.database.url,
      connectionTimeoutMillis: 5_000, // fail fast if DB is unreachable
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      max: 10,
    });
    pool.on('error', (err) => {
      logger.warn({ err }, 'Postgres idle client error');
    });
    db = drizzle(pool, { schema });
  }
  return db;
}

/**
 * Ensures the app database exists before migrations run.
 * Connects to the built-in "postgres" maintenance DB using the same credentials
 * as DATABASE_URL (no separate admin URL needed), then runs CREATE DATABASE if
 * the target database is missing.
 */
export async function ensureDatabase(): Promise<void> {
  if (!config.database.url) return;

  const appUrl = new URL(config.database.url);
  const targetDb = decodeURIComponent(appUrl.pathname.slice(1));
  const eid = (s: string): string => `"${s.replace(/"/g, '""')}"`;

  // Connect to the "postgres" maintenance DB — it always exists on any PG install.
  const maintenanceUrl = new URL(config.database.url);
  maintenanceUrl.pathname = '/postgres';

  const maintenancePool = new Pool({ connectionString: maintenanceUrl.toString() });
  try {
    const { rowCount } = await maintenancePool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDb],
    );
    if (!rowCount) {
      await maintenancePool.query(`CREATE DATABASE ${eid(targetDb)}`);
      logger.info(`Database "${targetDb}" created automatically`);
    }
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === '42501') {
      // CREATEDB privilege missing — log instructions and continue.
      // Migrations will still succeed if the DB was already created manually.
      logger.warn(
        `DB user lacks CREATEDB privilege. Either grant it:\n` +
          `  psql -U postgres -c "ALTER USER ${decodeURIComponent(new URL(config.database.url!).username)} CREATEDB;"\n` +
          `or create the database manually:\n` +
          `  psql -U postgres -c "CREATE DATABASE \\"${targetDb}\\";"`,
      );
    } else {
      throw err;
    }
  } finally {
    await maintenancePool.end();
  }
}

/**
 * Runs any pending Drizzle migrations so tables are always up-to-date on startup.
 * Migration files live in /drizzle — generated via `npm run db:generate`.
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.join(__dirname, '../../drizzle');
  await migrate(getDb(), { migrationsFolder });
  logger.info('Database migrations applied');
}

/**
 * Full startup sequence: ensure DB exists → run migrations → seed → verify.
 * Skipped when DB_DRIVER=memory (dev / tests).
 */
export async function checkDbConnection(): Promise<void> {
  if (config.database.driver !== 'postgres') return;
  await ensureDatabase();
  await runMigrations();
  await seedSuperAdmin();
  await seedAuthProviders();
  await getDb().execute(sql`SELECT 1`);
}

/** Closes the pool (graceful shutdown / tests). */
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
