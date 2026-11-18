import { Client } from 'pg';
import {
  hasFlag,
  optionalInt,
  requireInt,
  requireString,
  resolvePassword,
  type ParsedArgs,
} from '../args';
import { describePgError, type PgTarget } from '../pg-errors';
import { CliError, emitSuccess, type ExitCode } from '../result';

/**
 * `db:test` — validate the PostgreSQL connection (wizard step 4).
 *
 * Runs before any config exists, so it builds its own connection from flags rather
 * than going through config/env. It connects straight to the target database: that
 * answers "reachable?" and "does the database exist?" in a single round trip and
 * does not require the caller to have access to the `postgres` maintenance DB —
 * which is only touched when the database actually has to be created.
 */
export interface DbTestResult {
  reachable: boolean;
  databaseExists: boolean;
  databaseCreated: boolean;
  serverVersion: string;
  latencyMs: number;
}

const PG_INVALID_CATALOG = '3D000';

async function probe(
  target: PgTarget,
  password: string,
  timeoutSec: number,
): Promise<{ serverVersion: string; latencyMs: number }> {
  const client = new Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password,
    connectionTimeoutMillis: timeoutSec * 1000,
    // The probe must not hang forever on an unresponsive server.
    statement_timeout: timeoutSec * 1000,
  });

  const startedAt = Date.now();
  await client.connect();
  try {
    await client.query('SELECT 1');
    const latencyMs = Date.now() - startedAt;
    const { rows } = await client.query<{ version: string }>('SHOW server_version');
    return { serverVersion: rows[0]?.version ?? 'unknown', latencyMs };
  } finally {
    await client.end();
  }
}

/** Creates the target database via the `postgres` maintenance DB, which always exists. */
async function createDatabase(
  target: PgTarget,
  password: string,
  timeoutSec: number,
): Promise<void> {
  const maintenance = new Client({
    host: target.host,
    port: target.port,
    database: 'postgres',
    user: target.user,
    password,
    connectionTimeoutMillis: timeoutSec * 1000,
  });

  await maintenance.connect();
  try {
    // Identifier quoting only — CREATE DATABASE cannot take a bind parameter.
    const quoted = `"${target.database.replace(/"/g, '""')}"`;
    await maintenance.query(`CREATE DATABASE ${quoted}`);
  } finally {
    await maintenance.end();
  }
}

export async function runDbTest(args: ParsedArgs, json: boolean): Promise<ExitCode> {
  const target: PgTarget = {
    host: requireString(args, 'host', 'db-host'),
    port: requireInt(args, 'port', 'db-port'),
    database: requireString(args, 'name', 'db-name'),
    user: requireString(args, 'user', 'db-user'),
  };
  const timeoutSec = optionalInt(args, 'timeout', 5);
  const createIfMissing = hasFlag(args, 'create-if-missing');
  const password = await resolvePassword(args);

  let databaseCreated = false;

  const attempt = async (): Promise<{ serverVersion: string; latencyMs: number }> => {
    try {
      return await probe(target, password, timeoutSec);
    } catch (err) {
      const isMissingDb = (err as { code?: string }).code === PG_INVALID_CATALOG;
      if (!isMissingDb || !createIfMissing) throw describePgError(err, target);

      // The server is reachable and the credentials are good — only the DB is absent.
      try {
        await createDatabase(target, password, timeoutSec);
      } catch (createErr) {
        throw describePgError(createErr, target);
      }
      databaseCreated = true;
      return probe(target, password, timeoutSec).catch((verifyErr) => {
        throw describePgError(verifyErr, target);
      });
    }
  };

  const { serverVersion, latencyMs } = await attempt().catch((err) => {
    throw err instanceof CliError ? err : describePgError(err, target);
  });

  const result: DbTestResult = {
    reachable: true,
    databaseExists: true,
    databaseCreated,
    serverVersion,
    latencyMs,
  };

  return emitSuccess(
    'db:test',
    result,
    json,
    `Connected to PostgreSQL ${serverVersion} at ${target.host}:${target.port} in ${latencyMs} ms` +
      (databaseCreated ? `\nDatabase "${target.database}" was created.` : ''),
  );
}
