import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

// Fields that must never appear in logs even partially.
const REDACTED = new Set([
  'password',
  'newPassword',
  'confirmPassword',
  'clientSecret',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'serviceAccountJson',
  'privateKey',
]);

function sanitize(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) =>
      REDACTED.has(k) ? [k, '***'] : [k, v],
    ),
  );
}

/**
 * Compact request logger.
 * Output format: METHOD : STATUS : URL : PAYLOAD : RESPONSE : Xms
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  let resBody: unknown;

  // Intercept res.json so we can capture the response body.
  const originalJson = res.json.bind(res) as typeof res.json;
  res.json = function (body) {
    resBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const payload =
      req.body && Object.keys(req.body as object).length ? JSON.stringify(sanitize(req.body)) : '-';
    const response = resBody ? JSON.stringify(resBody) : '-';

    const line = `${req.method} : ${status} : ${req.url} : ${payload} : ${response} : ${ms}ms`;

    if (status >= 500) logger.error(line);
    else if (status >= 400) logger.warn(line);
    else logger.info(line);
  });

  next();
}
