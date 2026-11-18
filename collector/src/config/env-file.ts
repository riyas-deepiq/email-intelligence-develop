import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Locates and loads the collector's `.env`.
 *
 * Mirrors the server's config resolution (server/src/config/env-file.ts): an
 * installed deployment keeps the binary read-only under Program Files / /opt while
 * its configuration lives in a writable data directory, so the installer points
 * `INSIGHT_HUB_CONFIG_DIR` at that directory on the service definition.
 *
 * Each component gets its own directory (…/config/collector), so the two services
 * never share or overwrite one another's file.
 *
 * Resolution order (first hit wins):
 *   1. `INSIGHT_HUB_CONFIG_DIR`                   — set by the installer / service manager
 *   2. `<dir of the executable>/config`  — portable "unzip and run" layout
 *   3. the current working directory     — development
 */

/** True when running inside a @yao-pkg/pkg single-file executable. */
export function isPackaged(): boolean {
  return Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
}

/** The directory the running program lives in (the real one, not pkg's snapshot). */
export function executableDir(): string {
  return isPackaged() ? path.dirname(process.execPath) : process.cwd();
}

export function resolveConfigDir(): string {
  const fromEnv = process.env.INSIGHT_HUB_CONFIG_DIR ?? process.env.RAYNEX_CONFIG_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());

  const beside = path.join(executableDir(), 'config');
  if (fs.existsSync(path.join(beside, '.env'))) return beside;

  return process.cwd();
}

export function resolveEnvPath(): string {
  return path.join(resolveConfigDir(), '.env');
}

/**
 * Loads the resolved `.env` into `process.env`. A missing file is not an error —
 * real environment variables and defaults still apply — but a file that exists and
 * cannot be read is, since `.env` is written owner-only and silently ignoring it
 * would strand the collector on defaults with no COLLECTOR_SECRET.
 *
 * @returns the path that was loaded, or `undefined` if there was no file.
 */
export function loadEnvFile(): string | undefined {
  const envPath = resolveEnvPath();
  if (!fs.existsSync(envPath)) return undefined;

  const { error } = dotenv.config({ path: envPath });
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
