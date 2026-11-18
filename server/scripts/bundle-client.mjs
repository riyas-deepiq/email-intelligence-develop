#!/usr/bin/env node
/**
 * Copies the built Vite client into `server/public`, from where @yao-pkg/pkg embeds
 * it in the executable and `staticClientRouter` serves it at runtime.
 *
 * This is the step that makes "one service, one port" true (docs/packaging-design.md §0C):
 * the shipped binary contains both the API and the UI, so a single-node install needs
 * no second process and no reverse proxy.
 *
 * Usage: node scripts/bundle-client.mjs [--client-dist <path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const flagIndex = process.argv.indexOf('--client-dist');
const clientDist = path.resolve(
  flagIndex !== -1 && process.argv[flagIndex + 1]
    ? process.argv[flagIndex + 1]
    : path.join(serverDir, '../client/dist'),
);
const publicDir = path.join(serverDir, 'public');

if (!fs.existsSync(path.join(clientDist, 'index.html'))) {
  process.stderr.write(
    `No client build found at ${clientDist}\n` +
      'Build the client first:  npm --prefix ../client ci && npm --prefix ../client run build\n',
  );
  process.exit(1);
}

/**
 * Refuse to package a client that points at a developer's machine.
 *
 * Vite inlines `import.meta.env.*` at build time, so a stale `VITE_API_URL` in a
 * local `.env` gets burned into the shipped JS — every installed copy then calls
 * the build machine instead of its own origin, and the failure looks like "login
 * doesn't work" with nothing in the server log. `client/.env.production` pins the
 * base to a relative path; this check makes sure it was actually applied.
 */
function assertNoDevEndpoints(dir) {
  const offenders = [];
  const scan = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        scan(full);
        continue;
      }
      if (!/\.(js|css|html)$/.test(entry.name)) continue;

      const text = fs.readFileSync(full, 'utf8');
      // Require a port or a path segment, so this flags a real endpoint like
      // http://localhost:3000/api/v1 without tripping over library defaults such
      // as `window.location.href || "http://localhost"`.
      for (const match of text.matchAll(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+|\/\w)/g)) {
        offenders.push(`${path.relative(dir, full)} → ${match[0]}`);
      }
    }
  };
  scan(dir);

  if (offenders.length > 0) {
    process.stderr.write(
      'Refusing to bundle: the client build contains hard-coded localhost URLs.\n' +
        [...new Set(offenders)].map((o) => `  ${o}`).join('\n') +
        "\n\nThe packaged UI is served from the server's own origin, so API URLs must be\n" +
        'relative. Check client/.env.production, then rebuild the client.\n',
    );
    process.exit(1);
  }
}

assertNoDevEndpoints(clientDist);

// Replace rather than merge, so files deleted from a newer client build (old hashed
// chunks in particular) never linger inside the packaged binary.
fs.rmSync(publicDir, { recursive: true, force: true });
fs.cpSync(clientDist, publicDir, { recursive: true });

const fileCount = fs
  .readdirSync(publicDir, { recursive: true })
  .filter((entry) => fs.statSync(path.join(publicDir, entry.toString())).isFile()).length;

process.stdout.write(`Bundled client → ${publicDir} (${fileCount} files)\n`);
