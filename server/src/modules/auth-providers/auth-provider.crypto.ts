import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../../config/env';
import { ServiceUnavailableError } from '../../lib/errors';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export function encrypt(plaintext: string): string {
  const key = Buffer.from(config.auth.oidcEncryptionKey, 'hex');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: iv(12 bytes) + tag(16 bytes) + ciphertext — all hex-encoded
  return Buffer.concat([iv, tag, encrypted]).toString('hex');
}

export function decrypt(encoded: string): string {
  const key = Buffer.from(config.auth.oidcEncryptionKey, 'hex');
  const buf = Buffer.from(encoded, 'hex');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
  } catch {
    // GCM auth failure means the stored ciphertext was written under a DIFFERENT
    // OIDC_ENCRYPTION_KEY. Node's raw message ("Unsupported state or unable to
    // authenticate data") surfaces as an opaque 500 and tells an operator
    // nothing, so translate it into the actual remedy. Never include the key or
    // ciphertext in the message — this reaches logs and HTTP responses.
    throw new ServiceUnavailableError(
      'Stored provider credentials cannot be decrypted — OIDC_ENCRYPTION_KEY does not match the key ' +
        'they were saved with. Restore the previous key, or re-enter the client secret in ' +
        'Admin → Provider Connection and press Connect to re-encrypt with the current key.',
    );
  }
}
