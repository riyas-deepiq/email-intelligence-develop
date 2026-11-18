import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { PRODUCT_NAME } from '../../config/brand';
import {
  optionalInt,
  optionalString,
  requireInt,
  requireString,
  resolvePassword,
  type ParsedArgs,
} from '../args';
import { readEnvFile, renderEnvFile, writeEnvFileSecurely } from '../env-writer';
import { CliError, emitSuccess, type ExitCode } from '../result';

/**
 * `provision` — write the configuration and bring the schema up to date (wizard step 7).
 *
 * This is the command that makes "never requires manual editing post-install" true:
 * it composes DATABASE_URL, generates every secret the production guards in
 * config/env.ts insist on, writes a locked-down `.env`, and runs the migrations.
 * Re-running it is safe — existing secrets are reused, not rotated.
 */
export interface ProvisionResult {
  envPath: string;
  migrationsApplied: number;
  secretsGenerated: string[];
  /** Present only when the Collector component is being installed. */
  collectorEnvPath?: string;
}

const VALID_ENVIRONMENTS = ['production', 'testing', 'development'] as const;
type Environment = (typeof VALID_ENVIRONMENTS)[number];

/** A URL-safe secret: base64url of 48 bytes → 64 characters. */
function generateSecret(): string {
  return randomBytes(48).toString('base64url');
}

/** 64 lowercase hex characters — the AES-256-GCM key format config/env.ts validates. */
function generateHexKey(): string {
  return randomBytes(32).toString('hex');
}

/** postgres://user:pass@host:port/db with credentials percent-encoded. */
export function composeDatabaseUrl(opts: {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}): string {
  const user = encodeURIComponent(opts.user);
  const pass = encodeURIComponent(opts.password);
  const name = encodeURIComponent(opts.name);
  return `postgres://${user}:${pass}@${opts.host}:${opts.port}/${name}`;
}

function parseEnvironment(raw: string | undefined): Environment {
  const value = (raw ?? 'production') as Environment;
  if (!VALID_ENVIRONMENTS.includes(value)) {
    throw new CliError(
      `--env must be one of ${VALID_ENVIRONMENTS.join(', ')} (got "${raw}")`,
      'E_USAGE',
    );
  }
  return value;
}

export async function runProvision(args: ParsedArgs, json: boolean): Promise<ExitCode> {
  const configDir = path.resolve(requireString(args, 'config-dir'));
  const port = requireInt(args, 'port');
  const dbHost = requireString(args, 'db-host', 'host');
  const dbPort = requireInt(args, 'db-port');
  const dbName = requireString(args, 'db-name', 'name');
  const dbUser = requireString(args, 'db-user', 'user');
  const environment = parseEnvironment(optionalString(args, 'env'));
  const dbPassword = await resolvePassword(args, 'db-');

  // Optional Collector component (see components/collector/component.json).
  const collectorConfigDirArg = optionalString(args, 'collector-config-dir');
  const collectorConfigDir = collectorConfigDirArg
    ? path.resolve(collectorConfigDirArg)
    : undefined;
  const collectorPort = optionalInt(args, 'collector-port', 3001);

  const uploadPath = path.resolve(
    optionalString(args, 'upload-path') ?? path.join(configDir, '../uploads'),
  );
  const logPath = path.resolve(optionalString(args, 'log-path') ?? path.join(configDir, '../logs'));
  const backupPath = path.resolve(
    optionalString(args, 'backup-path') ?? path.join(configDir, '../backups'),
  );

  // 1. Data directories.
  for (const dir of [configDir, uploadPath, logPath, backupPath]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 2/3. Compose the URL and reuse or generate secrets.
  const envPath = path.join(configDir, '.env');
  const existing = readEnvFile(envPath);
  const secretsGenerated: string[] = [];

  const keepOrGenerate = (key: string, generate: () => string): string => {
    const current = existing[key];
    if (current && current.trim()) return current;
    secretsGenerated.push(key);
    return generate();
  };

  const managed: Record<string, string> = {
    NODE_ENV: environment === 'testing' ? 'test' : environment,
    PORT: String(port),
    DATABASE_URL: composeDatabaseUrl({
      host: dbHost,
      port: dbPort,
      name: dbName,
      user: dbUser,
      password: dbPassword,
    }),
    JWT_SECRET: keepOrGenerate('JWT_SECRET', generateSecret),
    OIDC_ENCRYPTION_KEY: keepOrGenerate('OIDC_ENCRYPTION_KEY', generateHexKey),
    // config/env.ts refuses to start in production while this is the dev default.
    COLLECTOR_SECRET: keepOrGenerate('COLLECTOR_SECRET', generateSecret),
    UPLOAD_PATH: uploadPath,
    LOG_PATH: logPath,
    BACKUP_PATH: backupPath,
    // The client is served from this same origin, so the API only ever needs to
    // trust itself.
    CORS_ORIGIN: existing.CORS_ORIGIN ?? `http://localhost:${port}`,
    // The real administrator is created by `admin:create`; the built-in
    // well-known-password fallback must never exist on an installed system.
    SEED_DEFAULT_ADMIN: 'false',
  };

  // The Collector is an optional component. When it is being installed the server
  // needs to know where to reach it for on-demand sync triggers, and the collector
  // needs the same shared secret — which is generated here and must never travel
  // over a command line, so this command writes both files itself.
  if (collectorConfigDir) {
    managed.COLLECTOR_URL = `http://127.0.0.1:${collectorPort}`;
  }

  // 4. Write it with restricted permissions.
  writeEnvFileSecurely(
    envPath,
    renderEnvFile({
      managed,
      existing,
      header:
        `${PRODUCT_NAME} — generated by the installer. Secrets are unique to this\n` +
        'installation; keep this file private and back it up before reinstalling.',
    }),
  );

  // 4b. The Collector's own config, written from here so the shared secret is
  // copied in-process rather than passed between two command invocations.
  if (collectorConfigDir) {
    fs.mkdirSync(collectorConfigDir, { recursive: true });
    const collectorEnvPath = path.join(collectorConfigDir, '.env');
    const collectorExisting = readEnvFile(collectorEnvPath);

    writeEnvFileSecurely(
      collectorEnvPath,
      renderEnvFile({
        managed: {
          NODE_ENV: managed.NODE_ENV,
          PORT: String(collectorPort),
          // The collector polls the server's internal API; on a single-node install
          // that is the loopback address, never the public hostname.
          SERVER_URL: `http://127.0.0.1:${port}`,
          // Must match the server's value or every poll is rejected as unauthorised.
          COLLECTOR_SECRET: managed.COLLECTOR_SECRET,
          LOG_PATH: logPath,
        },
        existing: collectorExisting,
        header:
          `${PRODUCT_NAME} Collector — generated by the installer.\n` +
          "COLLECTOR_SECRET must stay identical to the server's value.",
      }),
    );
  }

  // 5. Migrate. Loading the app's own modules has to happen *after* the config
  // exists and INSIGHT_HUB_CONFIG_DIR points at it, hence the deferred require.
  process.env.INSIGHT_HUB_CONFIG_DIR = configDir;
  process.env.DATABASE_URL = managed.DATABASE_URL;
  process.env.LOG_LEVEL = 'silent'; // keep stdout to a single JSON envelope
  // Everything the config needs is already in process.env, and the file just
  // written is readable only by SYSTEM/Administrators — don't read it back.
  process.env.INSIGHT_HUB_SKIP_ENV_FILE = '1';

  const { ensureDatabase, runMigrations, getDb, closeDb } = await import('../../db/client.js');

  /**
   * Rows in Drizzle's own bookkeeping table, so the wizard can report how many
   * migrations this run actually applied. A missing table means a fresh database.
   */
  const countAppliedMigrations = async (): Promise<number> => {
    try {
      const result = await getDb().execute(
        sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
      );
      const rows = (result as unknown as { rows?: Array<{ count: number }> }).rows;
      return Number(rows?.[0]?.count ?? 0);
    } catch {
      return 0;
    }
  };

  let migrationsApplied = 0;
  try {
    await ensureDatabase();
    const before = await countAppliedMigrations();
    await runMigrations();
    const after = await countAppliedMigrations();
    migrationsApplied = Math.max(after - before, 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Database migration failed: ${message}`, 'E_MIGRATION');
  } finally {
    await closeDb().catch(() => undefined);
  }

  const result: ProvisionResult = {
    envPath,
    migrationsApplied,
    secretsGenerated,
    ...(collectorConfigDir && { collectorEnvPath: path.join(collectorConfigDir, '.env') }),
  };

  return emitSuccess(
    'provision',
    result,
    json,
    `Configuration written to ${envPath}\n` +
      `Applied ${migrationsApplied} migration(s).` +
      (secretsGenerated.length > 0 ? `\nGenerated: ${secretsGenerated.join(', ')}.` : ''),
  );
}
