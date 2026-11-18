import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/lib/password';

/**
 * Real hashes produced by the native `argon2` package (v0.44, default options
 * m=65536,t=3,p=4) before the hash-wasm migration. They are checked in as
 * fixtures so the migration can never silently lock out existing users.
 */
const LEGACY_ARGON2_HASHES: ReadonlyArray<readonly [string, string]> = [
  [
    'correct-password',
    '$argon2id$v=19$m=65536,t=3,p=4$ul2s6S78kveoBcCi3Z3pbA$oWEjeMfoDJ6Pq7kKEWkl58FtEvMPTcTvht+SK0mvY2w',
  ],
  [
    'legacy-secret',
    '$argon2id$v=19$m=65536,t=3,p=4$26iebOtpr2RFQjayk69u1w$QEckaeIKeb/uURLTtmQRnlxyRgGYtDUmcbAuQ19YEyQ',
  ],
];

describe('password hashing', () => {
  it('produces an Argon2id PHC string with the OWASP parameters', async () => {
    const hash = await hashPassword('s3cret-passphrase');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('round-trips a password', async () => {
    const hash = await hashPassword('s3cret-passphrase');
    await expect(verifyPassword(hash, 's3cret-passphrase')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong-passphrase')).resolves.toBe(false);
  });

  it('salts every hash, so equal passwords hash differently', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    await expect(verifyPassword(a, 'same')).resolves.toBe(true);
    await expect(verifyPassword(b, 'same')).resolves.toBe(true);
  });

  it.each(LEGACY_ARGON2_HASHES)(
    'still verifies a hash written by the native argon2 module (%s)',
    async (plain, legacyHash) => {
      await expect(verifyPassword(legacyHash, plain)).resolves.toBe(true);
      await expect(verifyPassword(legacyHash, 'not-the-password')).resolves.toBe(false);
    },
  );

  it('returns false instead of throwing on a corrupt hash', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
    await expect(verifyPassword('', 'anything')).resolves.toBe(false);
  });
});
