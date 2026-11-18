import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasFlag,
  optionalInt,
  parseArgs,
  readPasswordFromStdin,
  requireInt,
  requireString,
} from '../../../src/cli/args';
import { EXIT } from '../../../src/cli/result';

describe('parseArgs', () => {
  it('parses --flag value, --flag=value and bare booleans', () => {
    const args = parseArgs(['--host', 'db.local', '--port=5432', '--json']);

    expect(args.flags.get('host')).toBe('db.local');
    expect(args.flags.get('port')).toBe('5432');
    expect(args.flags.get('json')).toBe(true);
  });

  it('keeps values that contain spaces or drive letters intact', () => {
    const args = parseArgs(['--log-path', 'C:\\Program Files\\InsightHub\\logs']);

    expect(args.flags.get('log-path')).toBe('C:\\Program Files\\InsightHub\\logs');
  });

  it('treats a flag followed by another flag as boolean', () => {
    const args = parseArgs(['--create-if-missing', '--json']);

    expect(hasFlag(args, 'create-if-missing')).toBe(true);
    expect(hasFlag(args, 'json')).toBe(true);
  });

  it('collects non-flag tokens as positionals', () => {
    expect(parseArgs(['db:test', '--json']).positionals).toEqual(['db:test']);
  });

  it('accepts a value that itself looks like a negative number', () => {
    // Guards the "--flag -1" case: `-1` starts with '-' so it is not consumed.
    expect(parseArgs(['--timeout=-1']).flags.get('timeout')).toBe('-1');
  });
});

describe('readPasswordFromStdin', () => {
  /** Feeds raw bytes through a fake stdin, exactly as the installer's pipe would. */
  function withStdin(bytes: Buffer): Promise<string> {
    const fake = new PassThrough();
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(fake as unknown as typeof process.stdin);
    const result = readPasswordFromStdin();
    fake.end(bytes);
    return result;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads a plain piped password', async () => {
    await expect(withStdin(Buffer.from('Str0ng-Passphrase!\r\n', 'utf8'))).resolves.toBe(
      'Str0ng-Passphrase!',
    );
  });

  it('strips the UTF-8 BOM that Inno Setup prepends', async () => {
    // SaveStringsToUTF8File always writes EF BB BF first; without stripping it the
    // BOM becomes the password's first character and authentication fails on the
    // customer's machine only.
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('pässwörd\r\n', 'utf8'),
    ]);

    await expect(withStdin(bytes)).resolves.toBe('pässwörd');
  });

  it('keeps non-ASCII characters intact', async () => {
    await expect(withStdin(Buffer.from('Ünïcødé-Pass1!\n', 'utf8'))).resolves.toBe(
      'Ünïcødé-Pass1!',
    );
  });

  it('ignores anything after the first line', async () => {
    await expect(withStdin(Buffer.from('first-line\nsecond-line\n', 'utf8'))).resolves.toBe(
      'first-line',
    );
  });
});

describe('flag accessors', () => {
  it('reads the first matching alias', () => {
    const args = parseArgs(['--db-host', 'pg.internal']);

    expect(requireString(args, 'host', 'db-host')).toBe('pg.internal');
  });

  it('fails with a usage exit code when a required flag is absent', () => {
    expect.assertions(2);
    try {
      requireString(parseArgs([]), 'host');
    } catch (err) {
      expect((err as { exitCode: number }).exitCode).toBe(EXIT.USAGE);
      expect((err as Error).message).toContain('--host');
    }
  });

  it('rejects non-positive and non-numeric integers', () => {
    expect(() => requireInt(parseArgs(['--port', '0']), 'port')).toThrow(/positive integer/);
    expect(() => requireInt(parseArgs(['--port', 'abc']), 'port')).toThrow(/positive integer/);
    expect(() => optionalInt(parseArgs(['--timeout', '-5']), 'timeout', 60)).toThrow(
      /positive integer/,
    );
  });

  it('falls back to the default for an absent optional integer', () => {
    expect(optionalInt(parseArgs([]), 'timeout', 60)).toBe(60);
  });
});
