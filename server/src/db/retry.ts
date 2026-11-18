import { logger } from '../lib/logger';

const TRANSIENT_DB_CODES = new Set([
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '08007',
  '08P01',
  '53300',
  '57P01',
  '57P02',
  '57P03',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
]);

const TRANSIENT_DB_MESSAGE_PATTERNS = [
  /connection terminated/i,
  /connection timeout/i,
  /connection ended unexpectedly/i,
  /server closed the connection unexpectedly/i,
  /client has encountered a connection error/i,
  /connection is not queryable/i,
  /remaining connection slots are reserved/i,
  /too many clients/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /EPIPE/i,
];

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  errors?: unknown;
};

function collectErrorChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;

  while (current && !seen.has(current)) {
    chain.push(current);
    seen.add(current);

    const next = (current as ErrorLike).cause;
    if (!next) break;
    current = next;
  }

  const nested = (err as ErrorLike | undefined)?.errors;
  if (Array.isArray(nested)) {
    for (const item of nested) chain.push(...collectErrorChain(item));
  }

  return chain;
}

export function isTransientDbConnectionError(err: unknown): boolean {
  return collectErrorChain(err).some((item) => {
    const code = (item as ErrorLike).code;
    if (typeof code === 'string' && TRANSIENT_DB_CODES.has(code)) return true;

    const message = (item as ErrorLike).message;
    if (typeof message !== 'string') return false;
    return TRANSIENT_DB_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: { operationName?: string; retries?: number; delayMs?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 1;
  const delayMs = options.delayMs ?? 150;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (attempt >= retries || !isTransientDbConnectionError(err)) {
        throw err;
      }

      logger.warn(
        { err, operation: options.operationName, attempt: attempt + 1, retries },
        'Transient database connection error; retrying',
      );
      await delay(delayMs * (attempt + 1));
    }
  }
}
