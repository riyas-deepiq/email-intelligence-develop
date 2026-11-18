import type { ErrorRequestHandler } from 'express';
import { isTransientDbConnectionError } from '../db/retry';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Central error handler. Must be registered LAST (after routes).
 * Maps known error types to the shared error envelope; logs unexpected errors.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err }, err.message);
    }
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (isTransientDbConnectionError(err)) {
    logger.warn({ err }, 'Database connection temporarily unavailable');
    res.status(503).json({
      error: {
        code: 'database_unavailable',
        message: 'Database connection temporarily unavailable. Please try again.',
      },
    });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
};
