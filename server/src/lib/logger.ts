import pino, { type Logger } from 'pino';
import { config } from '../config/env';
import { isPackaged } from '../config/env-file';

/**
 * Centralized structured logger (Pino).
 * - development: pretty, colorized output
 * - production: line-delimited JSON (ready for log shippers)
 * - test: silent, to keep test output clean
 */
const level = config.env === 'test' ? 'silent' : config.server.logLevel;

// pino-pretty is a devDependency running in a worker thread — neither of which
// survives into the single-file build, so a binary installed with the wizard's
// "Development" environment would crash on its first log line. Plain JSON there.
const usePrettyTransport = config.env === 'development' && !isPackaged();

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
