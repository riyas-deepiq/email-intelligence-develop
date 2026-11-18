#!/usr/bin/env node
/**
 * Entry point of the packaged executable (`pkg` builds this file).
 *
 * It stays deliberately thin: parse, dispatch, exit with the command's code. All
 * behaviour lives in ./cli, which is importable from tests without a process exit.
 */
import { runCli } from './cli/index';
import { EXIT } from './cli/result';

runCli(process.argv.slice(2))
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    // Anything reaching here escaped a command's own handling — report it as an
    // internal error rather than a silent unhandled rejection.
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(EXIT.INTERNAL);
  });
