import dotenv from 'dotenv';
import { describe, expect, it } from 'vitest';
import { formatEnvValue, renderEnvFile } from '../../../src/cli/env-writer';

/** Parsing back what we wrote is the only assertion that really matters here. */
function roundTrip(key: string, value: string): string | undefined {
  return dotenv.parse(formatEnvValue(key, value))[key];
}

describe('formatEnvValue', () => {
  it('round-trips Windows paths without mangling backslashes', () => {
    // A double-quoted value would turn the \n of "...\new" into a newline.
    const value = 'C:\\ProgramData\\InsightHub\\newdata\\temp';

    expect(roundTrip('UPLOAD_PATH', value)).toBe(value);
  });

  it('round-trips a database URL containing encoded credentials', () => {
    const value = 'postgres://admin%40corp:p%40ss%3Aword@10.0.0.5:5432/insight_hub';

    expect(roundTrip('DATABASE_URL', value)).toBe(value);
  });

  it('round-trips values that need quoting', () => {
    expect(roundTrip('SECRET', 'has#hash')).toBe('has#hash');
    expect(roundTrip('SECRET', ' padded ')).toBe(' padded ');
  });

  it('round-trips base64url and hex secrets', () => {
    const secret = 'aB3-_xYz09aB3-_xYz09aB3-_xYz09aB3-_xYz09aB3-_xYz09aB3-_xYz09abcd';

    expect(roundTrip('JWT_SECRET', secret)).toBe(secret);
  });

  it('refuses a value containing a line break', () => {
    expect(() => formatEnvValue('JWT_SECRET', 'one\ntwo')).toThrow(/line break/);
  });
});

describe('renderEnvFile', () => {
  const managed = { PORT: '8080', DATABASE_URL: 'postgres://u:p@h:5432/db' };

  it('writes managed keys in order, under a comment header', () => {
    const rendered = renderEnvFile({ managed, existing: {}, header: 'generated' });

    expect(rendered.startsWith('# generated\n')).toBe(true);
    expect(rendered.indexOf('PORT=')).toBeLessThan(rendered.indexOf('DATABASE_URL='));
  });

  it('preserves unmanaged keys an operator added by hand', () => {
    const rendered = renderEnvFile({
      managed,
      existing: { PORT: '9999', SMTP_HOST: 'smtp.corp.local', REDIS_URL: 'redis://cache:6379' },
    });
    const parsed = dotenv.parse(rendered);

    // Managed keys win; everything else survives the rewrite.
    expect(parsed.PORT).toBe('8080');
    expect(parsed.SMTP_HOST).toBe('smtp.corp.local');
    expect(parsed.REDIS_URL).toBe('redis://cache:6379');
  });

  it('produces a file that parses back to exactly the managed values', () => {
    expect(dotenv.parse(renderEnvFile({ managed, existing: {} }))).toEqual(managed);
  });
});
