import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Argon2id — the algorithm specified in the security design.
 *
 * Implemented with hash-wasm (pure WebAssembly) rather than the native `argon2`
 * N-API module: the server ships as a single-file executable (see
 * docs/packaging-design.md), and a native `.node` cannot be embedded in the V8
 * snapshot nor cross-compiled. WASM keeps the binary portable and lets both the
 * Windows and Linux builds come off one machine.
 *
 * Parameters follow the current OWASP recommendation for Argon2id.
 * Verification reads the parameters out of the stored hash, so hashes written by
 * the previous native `argon2` (m=65536,t=3,p=4) keep verifying unchanged — the
 * migration needs no re-hashing and no dual code path.
 */
const MEMORY_KIB = 19_456; // 19 MiB
const ITERATIONS = 2;
const PARALLELISM = 1;
const HASH_LENGTH = 32;
const SALT_BYTES = 16;

export async function hashPassword(plain: string): Promise<string> {
  return argon2id({
    password: plain,
    salt: randomBytes(SALT_BYTES),
    memorySize: MEMORY_KIB,
    iterations: ITERATIONS,
    parallelism: PARALLELISM,
    hashLength: HASH_LENGTH,
    outputType: 'encoded',
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  // A malformed/truncated hash makes argon2Verify throw; treat that as "no match"
  // so a corrupt row can never turn into a 500 on the login path.
  try {
    return await argon2Verify({ password: plain, hash });
  } catch {
    return false;
  }
}
