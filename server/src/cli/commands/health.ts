import http from 'node:http';
import { optionalInt, optionalString, type ParsedArgs } from '../args';
import { CliError, emitSuccess, type ExitCode } from '../result';

/**
 * `health` — readiness probe (wizard step 7 and the upgrade flow).
 *
 * Polls the service's own health endpoint until it answers 200 or the timeout
 * expires. The installer uses the exit code to decide whether the install
 * succeeded; the upgrader uses it to decide whether to roll back.
 */
export interface HealthResult {
  healthy: boolean;
  url: string;
  status: number;
  elapsedMs: number;
  body?: unknown;
}

const POLL_INTERVAL_MS = 1_000;

interface Probe {
  status: number;
  body: string;
}

function probeOnce(url: string, timeoutMs: number): Promise<Probe> {
  return new Promise<Probe>((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function runHealth(args: ParsedArgs, json: boolean): Promise<ExitCode> {
  const port = optionalInt(args, 'port', 8080);
  const host = optionalString(args, 'host') ?? '127.0.0.1';
  const timeoutSec = optionalInt(args, 'timeout', 60);
  // Defaults to the server's endpoint; --path lets the same command gate any other
  // component (the Collector exposes plain /health), so the installer needs only
  // one binary to health-check everything it installs.
  const probePath = optionalString(args, 'path') ?? '/api/v1/health';
  const url = `http://${host}:${port}${probePath.startsWith('/') ? probePath : `/${probePath}`}`;

  const startedAt = Date.now();
  const deadline = startedAt + timeoutSec * 1000;
  let lastError = 'the service did not respond';

  // A service that has just been started is expected to refuse connections for a
  // moment, so connection errors are retried rather than treated as failure.
  do {
    try {
      const { status, body } = await probeOnce(url, POLL_INTERVAL_MS * 5);
      if (status === 200) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = undefined;
        }

        return emitSuccess<HealthResult>(
          'health',
          { healthy: true, url, status, elapsedMs: Date.now() - startedAt, body: parsed },
          json,
          `Service is healthy (${url}).`,
        );
      }
      lastError = `the service answered HTTP ${status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (Date.now() + POLL_INTERVAL_MS >= deadline) break;
    await sleep(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  throw new CliError(
    `The service did not become healthy within ${timeoutSec}s (${url}): ${lastError}. ` +
      'Check the service log for startup errors.',
    'E_UNHEALTHY',
  );
}
