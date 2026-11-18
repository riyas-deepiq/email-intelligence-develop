import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { Router, type RequestHandler } from 'express';
import { executableDir, isPackaged } from '../config/env-file';
import { logger } from '../lib/logger';

/**
 * Serves the built Vite client (a static `dist/`) from the same process and port
 * as the API — the "one service, one port" decision in docs/packaging-design.md §0C.
 * Because the UI is same-origin with the API, deployed installs need no CORS and
 * no reverse proxy.
 *
 * The build copies `client/dist` → `server/public`, which @yao-pkg/pkg embeds in
 * the executable snapshot (pkg patches `fs`, so `express.static` reads it fine).
 */

/** Request prefixes that must never fall through to the SPA's index.html. */
// `/v1/` covers every internal service channel (`/v1/internal`, `/v1/rag-internal`,
// and any added later) — listing them individually meant a new channel silently
// started answering unmatched paths with the SPA shell instead of a JSON 404.
const API_PREFIXES = ['/api/', '/v1/'] as const;

/** Locates the client bundle, or returns undefined when the server was built API-only. */
export function resolveClientDir(): string | undefined {
  const candidates = [
    process.env.INSIGHT_HUB_PUBLIC_DIR ?? process.env.RAYNEX_PUBLIC_DIR, // explicit override (legacy fallback)
    path.join(__dirname, '../../public'), // dist/middleware → server/public (and pkg snapshot)
    !isPackaged() ? undefined : path.join(executableDir(), 'public'), // unpacked next to the exe
  ];

  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'index.html'))) return path.resolve(dir);
  }
  return undefined;
}

function isApiRequest(urlPath: string): boolean {
  return API_PREFIXES.some((prefix) => urlPath.startsWith(prefix));
}

/**
 * Reads the operator-editable client settings, if the installer pointed us at them.
 *
 * The client is a static bundle: Vite inlines `import.meta.env.*` at build time, so
 * a `.env` sitting next to an installed UI cannot change anything by itself. This
 * makes it real — the values are handed to the browser at runtime as
 * `window.__INSIGHT_HUB_CONFIG__`, so an administrator can edit them after installation and
 * only has to restart the service.
 *
 * The API base is deliberately NOT configurable here: the UI is served from the
 * server's own origin and must call it relatively.
 */
function readClientConfig(): Record<string, string> {
  const configPath = process.env.INSIGHT_HUB_CLIENT_CONFIG ?? process.env.RAYNEX_CLIENT_CONFIG;
  if (!configPath || !fs.existsSync(configPath)) return {};

  try {
    return dotenv.parse(fs.readFileSync(configPath));
  } catch (err) {
    // A malformed client config must never stop the server from serving the app.
    logger.warn({ err, configPath }, 'Could not read the client configuration — using defaults');
    return {};
  }
}

/**
 * Returns index.html with the runtime settings injected ahead of the app bundle,
 * so they are defined before any application code runs.
 */
function buildIndexHtml(indexPath: string): string {
  const html = fs.readFileSync(indexPath, 'utf8');
  const config = readClientConfig();
  if (Object.keys(config).length === 0) return html;

  // `</` is escaped so a value can never terminate the script element early.
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  const tag = `<script>window.__INSIGHT_HUB_CONFIG__=${json};</script>`;

  logger.info({ keys: Object.keys(config) }, 'Injecting runtime client configuration');
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : `${tag}${html}`;
}

/**
 * Router that serves the SPA, or a no-op router when no client bundle is present
 * (API-only builds and the test suite) so the API keeps behaving identically.
 */
export function staticClientRouter(): Router {
  const router = Router();
  const clientDir = resolveClientDir();

  if (!clientDir) {
    logger.debug('No client bundle found — serving the API only');
    return router;
  }

  const indexHtml = path.join(clientDir, 'index.html');

  // The shell, with any runtime client settings injected. Built once at startup —
  // it only changes when the operator edits the file and restarts the service.
  const shell = buildIndexHtml(indexHtml);

  // Vite emits content-hashed asset filenames, so they are safe to cache forever.
  // index.html must never be cached or clients pin themselves to a stale build.
  // It is excluded here so every request gets the injected copy below.
  router.use(
    express.static(clientDir, {
      index: false,
      maxAge: '1y',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  // History fallback: any other GET renders the SPA shell so client-side routes
  // survive a refresh or a deep link. Unmatched API paths still 404 as JSON.
  const spaFallback: RequestHandler = (req, res, next) => {
    if (isApiRequest(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(shell);
  };
  router.get('*', spaFallback);

  logger.info({ clientDir }, 'Serving the web client');
  return router;
}
