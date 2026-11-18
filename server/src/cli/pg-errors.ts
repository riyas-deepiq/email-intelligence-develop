import { CliError, EXIT } from './result';

/**
 * Turns a raw driver/socket error into a message an end user standing in front of
 * the installer can act on. The wizard prints these verbatim under the DB fields,
 * so they name the thing to fix rather than the exception that was thrown.
 */
interface PgLikeError {
  code?: string;
  message?: string;
}

export interface PgTarget {
  host: string;
  port: number;
  database: string;
  user: string;
}

export function describePgError(err: unknown, target: PgTarget): CliError {
  const { code, message } = (err ?? {}) as PgLikeError;
  const at = `${target.host}:${target.port}`;

  switch (code) {
    case 'ECONNREFUSED':
      return new CliError(
        `No PostgreSQL server is accepting connections at ${at}. Check that PostgreSQL is running and that the port is correct.`,
        code,
      );
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new CliError(
        `The host "${target.host}" could not be resolved. Check the hostname or use an IP address.`,
        code,
      );
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return new CliError(
        `Timed out connecting to PostgreSQL at ${at}. A firewall may be blocking the port.`,
        code,
      );
    case '28P01':
      return new CliError(`The password for user "${target.user}" is incorrect.`, code);
    case '28000':
      return new CliError(
        `PostgreSQL refused the connection for user "${target.user}". Check the server's pg_hba.conf allows connections from this machine.`,
        code,
      );
    case '3D000':
      return new CliError(
        `The database "${target.database}" does not exist. Create it, or re-run with --create-if-missing.`,
        code,
      );
    case '42501':
      return new CliError(
        `User "${target.user}" is not allowed to create databases. Grant CREATEDB, or create "${target.database}" manually.`,
        code,
      );
    case '53300':
      return new CliError('The PostgreSQL server has too many open connections.', code);
    default:
      return new CliError(
        message ? `PostgreSQL error: ${message}` : `Could not connect to PostgreSQL at ${at}.`,
        code ?? 'E_DB',
        EXIT.FAILURE,
      );
  }
}
