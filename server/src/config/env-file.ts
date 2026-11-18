import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Locates and loads the `.env` file.
 *
 * In development the file sits next to the source tree (cwd), but an installed
 * deployment keeps binaries read-only under Program Files / /opt while config
 * lives in a writable data directory (see docs/packaging-design.md §5). The
 * installer therefore sets `INSIGHT_HUB_CONFIG_DIR` on the service definition and this
 * module honours it.
 *
 * Resolution order (first hit wins):
 *   1. `INSIGHT_HUB_CONFIG_DIR`            — set by the installer / service manager
 *   2. `<dir of the executable>/config`  — portable "unzip and run" layout
 *   3. the current working directory     — development
 *
 * Precedence is always: real process env > `.env` file > code defaults, which
 * dotenv gives us for free (it never overwrites an existing process.env value).
 */

/** True when running inside a @yao-pkg/pkg single-file executable. */
export function isPackaged(): boolean {
  return Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
}

/**
 * The directory the running program lives in. For a packaged binary that is the
 * real folder holding the .exe (not the virtual snapshot path `__dirname` gives).
 */
export function executableDir(): string {
  return isPackaged() ? path.dirname(process.execPath) : process.cwd();
}

/** The directory that holds `.env`, per the resolution order above. */
export function resolveConfigDir(): string {
  const fromEnv = process.env.INSIGHT_HUB_CONFIG_DIR ?? process.env.RAYNEX_CONFIG_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());

  const beside = path.join(executableDir(), 'config');
  if (fs.existsSync(path.join(beside, '.env'))) return beside;

  return process.cwd();
}

/** Absolute path of the `.env` file that `loadEnvFile()` reads. */
export function resolveEnvPath(): string {
  return path.join(resolveConfigDir(), '.env');
}

/**
 * Loads the resolved `.env` into `process.env`. Missing file is not an error —
 * the app falls back to real environment variables and code defaults, which is
 * how container deployments and the test suite run.
 *
 * @returns the path that was loaded, or `undefined` if no file was found.
 */
export function loadEnvFile(): string | undefined {
  // Opt-out for callers that have already populated process.env themselves —
  // `provision` does exactly that, and it must not be required to read back a file
  // it has just deliberately locked down to SYSTEM/Administrators. Also useful for
  // container deployments that inject configuration directly.
  if (process.env.INSIGHT_HUB_SKIP_ENV_FILE === '1' || process.env.RAYNEX_SKIP_ENV_FILE === '1')
    return undefined;

  const envPath = resolveEnvPath();
  if (!fs.existsSync(envPath)) return undefined;

  const { error } = dotenv.config({ path: envPath });

  // dotenv reports failures instead of throwing. Ignoring one would let the process
  // continue on code defaults — starting with a placeholder JWT secret, or claiming
  // DATABASE_URL is unset when the file is merely unreadable. Fail loudly instead:
  // `.env` is written owner-only, so this is usually a missing-privileges run.
  if (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const hint =
      code === 'EACCES' || code === 'EPERM'
        ? ' — permission denied; run with administrator/root privileges'
        : '';
    throw new Error(`Cannot read the configuration file ${envPath}${hint}: ${error.message}`);
  }

  return envPath;
}
