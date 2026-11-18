import pino, { type Logger } from 'pino';
import { env } from '../config/env';
import { isPackaged } from '../config/env-file';

/**
 * Centralized structured logger (Pino).
 * - development: pretty, colorized output
 * - production: line-delimited JSON (ready for log shippers)
 * - test: silent, to keep test output clean
 */
const level = env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL;

// pino-pretty is a devDependency running in a worker thread — neither survives into
// the single-file build, so a packaged collector installed in "development" mode
// would crash on its first log line. Plain JSON there.
const usePrettyTransport = env.NODE_ENV === 'development' && !isPackaged();

export const logger: Logger = pino({
  level,
  ...(usePrettyTransport
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
