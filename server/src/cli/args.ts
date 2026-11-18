import { CliError, EXIT } from './result';

/**
 * A deliberately tiny argument parser. The provisioning CLI has five commands and
 * a couple dozen flags; pulling in a framework would add weight to a binary that
 * ships as a single file, and the flag grammar the installer uses is fixed by
 * docs/cli-provisioning-spec.md.
 *
 * Grammar: `--flag value`, `--flag=value`, and bare `--flag` (boolean true).
 */
export type FlagValue = string | true;

export interface ParsedArgs {
  readonly flags: ReadonlyMap<string, FlagValue>;
  readonly positionals: readonly string[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, FlagValue>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }

    // A following token that isn't itself a flag is this flag's value.
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(body, next);
      i += 1;
    } else {
      flags.set(body, true);
    }
  }

  return { flags, positionals };
}

/** Reads a required string flag. Accepts several names so aliases stay in one place. */
export function requireString(args: ParsedArgs, ...names: string[]): string {
  const value = optionalString(args, ...names);
  if (value === undefined || value === '') {
    throw new CliError(`Missing required option --${names[0]}`, 'E_USAGE', EXIT.USAGE);
  }
  return value;
}

export function optionalString(args: ParsedArgs, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = args.flags.get(name);
    if (typeof value === 'string') return value;
    // `--flag` with no value is a usage error where a string is expected.
    if (value === true) {
      throw new CliError(`Option --${name} requires a value`, 'E_USAGE', EXIT.USAGE);
    }
  }
  return undefined;
}

export function optionalInt(args: ParsedArgs, name: string, fallback: number): number {
  const raw = optionalString(args, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(
      `Option --${name} must be a positive integer (got "${raw}")`,
      'E_USAGE',
      EXIT.USAGE,
    );
  }
  return parsed;
}

export function requireInt(args: ParsedArgs, ...names: string[]): number {
  const raw = requireString(args, ...names);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(
      `Option --${names[0]} must be a positive integer (got "${raw}")`,
      'E_USAGE',
      EXIT.USAGE,
    );
  }
  return parsed;
}

export function hasFlag(args: ParsedArgs, ...names: string[]): boolean {
  return names.some((name) => args.flags.has(name));
}

/**
 * Reads a password from stdin (the installer pipes it in) so it never appears in a
 * process listing, a shell history, or a setup log. Only the first line is used,
 * which lets callers pipe with a trailing newline.
 */
export async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', resolve);
    process.stdin.on('error', reject);
  });

  const text = Buffer.concat(chunks).toString('utf8');

  // Strip a leading UTF-8 BOM. Inno Setup's SaveStringsToUTF8File — the only way to
  // write UTF-8 independently of the machine's ANSI codepage — always emits one, and
  // it would otherwise become the first character of the password.
  const BOM = 0xfeff;
  const withoutBom = text.charCodeAt(0) === BOM ? text.slice(1) : text;

  const [firstLine = ''] = withoutBom.split(/\r?\n/);
  return firstLine;
}

/**
 * Resolves a password from `--<prefix>password-stdin` (preferred) or an inline
 * `--<prefix>password` flag, which stays supported for scripted/CI use.
 */
export async function resolvePassword(args: ParsedArgs, prefix: '' | 'db-' = ''): Promise<string> {
  // The Windows installer appends a generic --password-stdin even to commands whose
  // documented flag is --db-password-stdin, so both spellings are accepted here.
  if (hasFlag(args, `${prefix}password-stdin`, 'password-stdin')) {
    return readPasswordFromStdin();
  }

  const inline = optionalString(args, `${prefix}password`);
  if (inline !== undefined) return inline;

  throw new CliError(
    `Missing password: pass --${prefix}password-stdin and pipe it on stdin`,
    'E_USAGE',
    EXIT.USAGE,
  );
}
