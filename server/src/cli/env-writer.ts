import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { CliError } from './result';

/**
 * Reads/writes the installed `.env`.
 *
 * Two properties matter here and are the reason this isn't a `join('=')`:
 *  - **Idempotence.** Re-running `provision` (repair, upgrade) must not rotate the
 *    generated secrets or drop keys an operator added by hand, or every existing
 *    session and every stored OAuth secret would be invalidated.
 *  - **Round-tripping Windows paths.** dotenv expands `\n`/`\r` inside
 *    double-quoted values, so `C:\ProgramData\...\new` would come back with a
 *    newline in it. Values are therefore written unquoted whenever that parses
 *    back identically, which is the case for every path and URL we emit.
 */

/** Parses an existing `.env`, or `{}` when there is none. */
export function readEnvFile(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

/** Serialises one `KEY=value` line, quoting only when it is actually needed. */
export function formatEnvValue(key: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new CliError(`Value for ${key} must not contain a line break`, 'E_INVALID_VALUE');
  }

  // Unquoted is literal to end-of-line, which is exactly what backslash paths need.
  const needsQuoting = /^\s|\s$/.test(value) || value.includes('#');
  if (!needsQuoting) return `${key}=${value}`;

  if (!value.includes("'")) return `${key}='${value}'`;

  throw new CliError(
    `Value for ${key} contains both a quote and a character that requires quoting; ` +
      'please choose a value without a single quote.',
    'E_INVALID_VALUE',
  );
}

export interface WriteEnvOptions {
  /** Keys this install manages, written first and in this order. */
  managed: Record<string, string>;
  /** Everything already in the file; unmanaged keys are preserved verbatim. */
  existing: Record<string, string>;
  header?: string;
}

export function renderEnvFile({ managed, existing, header }: WriteEnvOptions): string {
  const lines: string[] = [];
  if (header) lines.push(...header.split('\n').map((l) => `# ${l}`.trimEnd()), '');

  for (const [key, value] of Object.entries(managed)) {
    lines.push(formatEnvValue(key, value));
  }

  const extras = Object.entries(existing).filter(([key]) => !(key in managed));
  if (extras.length > 0) {
    lines.push('', '# Settings preserved from the previous configuration');
    for (const [key, value] of extras) lines.push(formatEnvValue(key, value));
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Writes the file so only the service account and administrators can read it —
 * it holds the DB password and every generated secret. POSIX gets 0600 directly;
 * Windows needs the inherited ACL replaced, since mode bits mean nothing there.
 */
export function writeEnvFileSecurely(envPath: string, contents: string): void {
  try {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, contents, { mode: 0o600 });
  } catch (err) {
    // The file this replaces is deliberately readable only by SYSTEM/root and
    // administrators, so an unprivileged re-run lands here. Say so, instead of
    // surfacing a bare EPERM as an internal error.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') {
      throw new CliError(
        `Cannot write ${envPath} — permission denied. Run the installer (or this command) ` +
          `with administrator${process.platform === 'win32' ? '' : '/root'} privileges.`,
        code,
      );
    }
    throw err;
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(envPath, 0o600);
    return;
  }

  try {
    execFileSync(
      'icacls',
      [envPath, '/inheritance:r', '/grant:r', 'SYSTEM:F', '/grant:r', 'Administrators:F'],
      { stdio: 'ignore' },
    );
  } catch {
    // Non-fatal: the file is written and the install can continue. Locking down the
    // ACL can fail when running unelevated, and failing the whole provision step
    // over it would be worse than a warning the caller can act on.
  }
}
