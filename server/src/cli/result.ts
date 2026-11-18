/**
 * Exit codes and the `--json` result envelope that form the contract between the
 * installer and this binary (docs/cli-provisioning-spec.md). The installer branches
 * purely on the exit code and, when it wants detail, parses the envelope — so these
 * values must not change without updating both installers.
 */
export const EXIT = {
  /** Success. */
  OK: 0,
  /** Expected/validation failure — the message is meant for the end user. */
  FAILURE: 1,
  /** The command was called wrongly (missing or malformed flags). */
  USAGE: 2,
  /** Unexpected internal error — a bug or an unhandled environment problem. */
  INTERNAL: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** An expected failure carrying a message the installer can show verbatim. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: string = 'E_FAILED',
    readonly exitCode: ExitCode = EXIT.FAILURE,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export interface SuccessEnvelope<T> {
  ok: true;
  command: string;
  data: T;
}

export interface FailureEnvelope {
  ok: false;
  command: string;
  error: { code: string; message: string };
}

function writeStdout(value: string): void {
  process.stdout.write(`${value}\n`);
}

function writeStderr(value: string): void {
  process.stderr.write(`${value}\n`);
}

/**
 * Prints a result and returns the process exit code.
 *
 * With `--json` exactly one JSON object goes to stdout and nothing to stderr, so a
 * caller that captures both streams into one file still gets parseable output.
 * Without it, humans get plain text and errors go to stderr as usual.
 */
export function emitSuccess<T>(
  command: string,
  data: T,
  json: boolean,
  humanText?: string,
): ExitCode {
  if (json) {
    const envelope: SuccessEnvelope<T> = { ok: true, command, data };
    writeStdout(JSON.stringify(envelope));
  } else {
    writeStdout(humanText ?? `${command}: ok`);
  }
  return EXIT.OK;
}

export function emitFailure(command: string, error: unknown, json: boolean): ExitCode {
  const isCli = error instanceof CliError;
  const code = isCli ? error.code : 'E_INTERNAL';
  const message = error instanceof Error ? error.message : String(error);
  const exitCode: ExitCode = isCli ? error.exitCode : EXIT.INTERNAL;

  if (json) {
    const envelope: FailureEnvelope = { ok: false, command, error: { code, message } };
    writeStdout(JSON.stringify(envelope));
  } else {
    writeStderr(`${command}: ${message}`);
  }
  return exitCode;
}
