import type { RequestHandler } from 'express';

/** Catch-all for unmatched routes. Registered just before the error handler. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'not_found', message: `Route ${req.method} ${req.originalUrl} not found` },
  });
};
