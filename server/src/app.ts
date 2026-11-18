import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { config } from './config/env';
import { errorHandler } from './middleware/error.middleware';
import { notFoundHandler } from './middleware/not-found.middleware';
import { requestLogger } from './middleware/request-logger.middleware';
import { staticClientRouter } from './middleware/static-client.middleware';
import { apiRouter } from './routes';
import { internalRouter } from './modules/internal/internal.routes';
import { ragInternalRouter } from './modules/internal/rag-internal.routes';

/**
 * Builds the Express application WITHOUT starting it. Keeping `listen` out of here
 * lets tests import the app directly (see tests/) and exercise it in-process.
 */
export function createApp(): Express {
  const app = express();

  // CORS must come before helmet so preflight OPTIONS responses carry the right headers.
  app.use(
    cors({
      origin: config.server.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.options(
    '*',
    cors({
      origin: config.server.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );

  // Trust one hop of reverse-proxy headers so req.ip reflects the real client IP
  // (nginx, ALB, Cloudflare) rather than the proxy's internal address.
  app.set('trust proxy', 1);

  // Security & parsing
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'frame-src': ["'self'", 'blob:'],
          'object-src': ["'self'", 'blob:'],
          'img-src': ["'self'", 'data:', 'blob:'],
        },
      },
    }),
  );
  // Internal ingest/batch route receives up to 50 emails per flush; each email can be
  // several hundred KB including body text, so allow up to 25 MB on that path only.
  app.use('/v1/internal/ingest/batch', express.json({ limit: '25mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Observability
  app.use(requestLogger);

  // Public API routes
  app.use('/api/v1', apiRouter);

  // Internal API — collector-to-server channel (COLLECTOR_SECRET Bearer auth, no CORS)
  // In production: Nginx restricts this prefix to the collector subnet only.
  app.use('/v1/internal', internalRouter);

  // Internal API — RAG-to-server channel (RAG_API_SECRET Bearer auth, no CORS).
  // In production: Nginx restricts this prefix to the RAG service subnet only.
  app.use('/v1/rag-internal', ragInternalRouter);

  // Static web client + SPA history fallback. Registered after the API routers so
  // /api and /v1/* always win, and before notFoundHandler so unknown UI routes
  // render the SPA instead of a JSON 404. No-op when built API-only.
  app.use(staticClientRouter());

  // Fallbacks (order matters: not-found, then error handler last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
