import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../../src/app';

/**
 * The SPA is served from the same process and port as the API, so the order of
 * `express.static` → SPA fallback → notFoundHandler decides whether a missing API
 * route returns JSON or an HTML page. That distinction is invisible in the browser
 * until a client starts parsing "<!DOCTYPE" as JSON, hence these tests.
 */
let app: Express;
let publicDir: string;

let clientConfig: string;

beforeAll(() => {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insight-hub-public-'));
  fs.writeFileSync(
    path.join(publicDir, 'index.html'),
    '<!DOCTYPE html><head><title>Insight Hub</title></head><body></body>',
  );
  fs.mkdirSync(path.join(publicDir, 'assets'));
  fs.writeFileSync(path.join(publicDir, 'assets', 'index-abc123.js'), 'void 0;');

  // Stands in for the installed config\client\.env. The second value checks that
  // a hostile string cannot break out of the injected <script>.
  clientConfig = path.join(publicDir, 'client.env');
  fs.writeFileSync(
    clientConfig,
    'APP_NAME=Acme Mail\nCOMPANY_NAME=</script><script>alert(1)</script>\n',
  );

  // Must be set before createApp(), which resolves the client directory once.
  process.env.INSIGHT_HUB_PUBLIC_DIR = publicDir;
  process.env.INSIGHT_HUB_CLIENT_CONFIG = clientConfig;
  app = createApp();
});

afterAll(() => {
  delete process.env.INSIGHT_HUB_PUBLIC_DIR;
  delete process.env.INSIGHT_HUB_CLIENT_CONFIG;
  fs.rmSync(publicDir, { recursive: true, force: true });
});

describe('static client serving', () => {
  it('serves index.html at the root', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Insight Hub');
  });

  it('falls back to the SPA shell for a client-side deep link', async () => {
    const res = await request(app).get('/dashboard/settings/security');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('still answers unknown API routes with JSON, not the SPA', async () => {
    const res = await request(app).get('/api/v1/definitely-not-a-route');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('leaves the real API working', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('injects runtime client settings into the shell', async () => {
    const res = await request(app).get('/');

    // The installer points INSIGHT_HUB_CLIENT_CONFIG at config\client\.env; without this
    // injection that file would be decorative, since Vite inlines build-time env.
    expect(res.text).toContain('window.__INSIGHT_HUB_CONFIG__');
    expect(res.text).toContain('Acme Mail');
    expect(res.text.indexOf('window.__INSIGHT_HUB_CONFIG__')).toBeLessThan(res.text.indexOf('</head>'));
  });

  it('escapes markup in client settings so a value cannot close the script', async () => {
    const res = await request(app).get('/');

    expect(res.text).not.toContain('</script><script>alert(1)');
    expect(res.text).toContain('\\u003c');
  });

  it('caches hashed assets immutably but never index.html', async () => {
    const asset = await request(app).get('/assets/index-abc123.js');
    const shell = await request(app).get('/');

    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toContain('max-age=31536000');
    expect(shell.headers['cache-control']).toBe('no-cache');
  });
});
