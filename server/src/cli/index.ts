import { hasFlag, parseArgs } from './args';
import { PRODUCT_NAME } from '../config/brand';
import { runAdminCreate } from './commands/admin-create';
import { runDbTest } from './commands/db-test';
import { runHealth } from './commands/health';
import { runProvision } from './commands/provision';
import { CliError, emitFailure, EXIT, type ExitCode } from './result';

/**
 * Command dispatch for the server executable.
 *
 * Everything here runs *before* config/env.ts builds its config object, which is
 * what lets `db:test` and `provision` work on a machine that has no `.env` yet.
 * Commands that do need the app (admin:create, serve) load it with a deferred
 * require once the config location is known — see docs/cli-provisioning-spec.md.
 */

export const COMMANDS = ['db:test', 'provision', 'admin:create', 'health', 'serve'] as const;
export type Command = (typeof COMMANDS)[number];

const USAGE = `${PRODUCT_NAME} server

Usage: insight-hub-server <command> [options]

Commands:
  serve                     Run the API and web UI (default when no command is given)
  db:test                   Validate a PostgreSQL connection
  provision                 Write .env, generate secrets and run migrations
  admin:create              Create or update the first administrator
  health                    Poll the service health endpoint until it is ready

Common options:
  --json                    Emit a machine-readable result envelope on stdout
  --help                    Show this help

See docs/cli-provisioning-spec.md for the full flag reference.`;

function isCommand(value: string | undefined): value is Command {
  return COMMANDS.includes(value as Command);
}

/**
 * Runs a provisioning command.
 *
 * @returns the process exit code. Nothing here calls `process.exit` itself, which
 *          keeps every command testable in-process.
 */
export async function runCli(argv: readonly string[]): Promise<ExitCode> {
  const [first, ...rest] = argv;

  // A leading token is a command unless it is a flag; `serve` is the default so an
  // argument-free invocation (and existing `ExecStart=…/server` units) still work.
  const looksLikeFlag = first === undefined || first.startsWith('-');
  const command: Command = looksLikeFlag ? 'serve' : (first as Command);
  const args = parseArgs(looksLikeFlag ? argv : rest);
  const json = hasFlag(args, 'json');

  if (hasFlag(args, 'help')) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT.OK;
  }

  try {
    if (!isCommand(command)) {
      throw new CliError(
        `Unknown command "${first}". Run with --help to list commands.`,
        'E_USAGE',
        EXIT.USAGE,
      );
    }

    switch (command) {
      case 'db:test':
        return await runDbTest(args, json);
      case 'provision':
        return await runProvision(args, json);
      case 'admin:create':
        return await runAdminCreate(args, json);
      case 'health':
        return await runHealth(args, json);
      case 'serve':
        return await runServe();
    }
  } catch (err) {
    return emitFailure(isCommand(command) ? command : 'cli', err, json);
  }
}

/**
 * Boots the HTTP service. Deferred so that importing the CLI never pulls in the
 * app's config, database pool or logger — those must not load for `db:test`.
 */
async function runServe(): Promise<ExitCode> {
  const { start } = await import('../server.js');
  await start();

  // The listening server now owns the process lifetime: it exits through its own
  // SIGTERM/SIGINT handlers, so this promise deliberately never settles rather
  // than letting the caller exit out from under a running service.
  return new Promise<ExitCode>(() => undefined);
}
