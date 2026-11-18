import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../../../src/cli/index';
import { EXIT } from '../../../src/cli/result';

/**
 * Locks the contract the installers depend on: exit codes and the shape of the
 * `--json` envelope. If any of this changes, the Inno Setup and shell installers
 * silently mis-read the result — so these assertions are intentionally literal.
 */
function captureStdout(): { lines: string[] } {
  const lines: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk).replace(/\n$/, ''));
    return true;
  });
  return { lines };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runCli dispatch', () => {
  it('prints usage and succeeds for --help', async () => {
    const { lines } = captureStdout();

    await expect(runCli(['--help'])).resolves.toBe(EXIT.OK);
    expect(lines.join('\n')).toContain('Usage: insight-hub-server');
  });

  it('rejects an unknown command with the usage exit code', async () => {
    const { lines } = captureStdout();

    await expect(runCli(['bogus', '--json'])).resolves.toBe(EXIT.USAGE);
    expect(JSON.parse(lines[0])).toEqual({
      ok: false,
      command: 'cli',
      error: { code: 'E_USAGE', message: expect.stringContaining('Unknown command "bogus"') },
    });
  });

  it('reports missing required flags as a usage error, not a crash', async () => {
    const { lines } = captureStdout();

    await expect(runCli(['db:test', '--json'])).resolves.toBe(EXIT.USAGE);
    const envelope = JSON.parse(lines[0]);
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('db:test');
    expect(envelope.error.message).toContain('--host');
  });

  it('validates the administrator password before touching the database', async () => {
    const { lines } = captureStdout();

    // No config-dir exists, so reaching the DB would fail differently — proving the
    // policy check runs first and returns the actionable message.
    const code = await runCli([
      'admin:create',
      '--config-dir',
      'C:/nonexistent',
      '--email',
      'a@b.com',
      '--password',
      'short',
      '--json',
    ]);

    expect(code).toBe(EXIT.FAILURE);
    expect(JSON.parse(lines[0]).error.code).toBe('E_WEAK_PASSWORD');
  });

  it('emits plain text rather than JSON when --json is absent', async () => {
    const errors: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errors.push(String(chunk).replace(/\n$/, ''));
      return true;
    });

    await expect(runCli(['bogus'])).resolves.toBe(EXIT.USAGE);
    expect(errors[0]).toContain('Unknown command "bogus"');
    expect(errors[0]).not.toContain('{"ok"');
  });
});
