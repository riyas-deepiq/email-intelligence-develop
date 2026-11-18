import path from 'node:path';
import { eq } from 'drizzle-orm';
import { optionalString, requireString, resolvePassword, type ParsedArgs } from '../args';
import { CliError, emitSuccess, type ExitCode } from '../result';

/**
 * `admin:create` — seed the first Super Admin (wizard step 7).
 *
 * The password is hashed by the application's own `hashPassword`, so the stored
 * hash is byte-for-byte what the login path expects; the installer never needs to
 * know the algorithm or its parameters.
 *
 * The account is created in `pending_setup`, which hands the operator to the app's
 * own first-login setup flow. That flow — not the installer — collects the company
 * name and email domains and creates the organisation record the rest of the
 * product depends on. See the status comment in the insert below.
 */
export interface AdminCreateResult {
  userId: string;
  email: string;
  created: boolean;
}

const MIN_PASSWORD_LENGTH = 10;

/** Deliberately permissive — real deliverability is not something a regex can decide. */
export function assertValidEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new CliError(`"${email}" is not a valid email address.`, 'E_INVALID_EMAIL');
  }
}

/**
 * Length first, then variety: the same policy the wizard enforces client-side, kept
 * here because the wizard is not the only caller (headless Linux installs, CI).
 */
export function assertValidPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new CliError(
      `The administrator password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      'E_WEAK_PASSWORD',
    );
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (classes < 3) {
    throw new CliError(
      'The administrator password must combine at least three of: lowercase, uppercase, digits, symbols.',
      'E_WEAK_PASSWORD',
    );
  }
}

export async function runAdminCreate(args: ParsedArgs, json: boolean): Promise<ExitCode> {
  const configDir = path.resolve(requireString(args, 'config-dir'));
  const displayName = optionalString(args, 'name') ?? 'Super Admin';
  const email = requireString(args, 'email').trim().toLowerCase();
  const password = await resolvePassword(args);

  assertValidEmail(email);
  assertValidPassword(password);

  // Point the config loader at the .env `provision` just wrote, then load the app's
  // own modules — deferred so this happens after INSIGHT_HUB_CONFIG_DIR is set.
  process.env.INSIGHT_HUB_CONFIG_DIR = configDir;
  process.env.LOG_LEVEL = 'silent';

  const [{ getDb, closeDb }, { users }, { hashPassword }] = await Promise.all([
    import('../../db/client.js'),
    import('../../db/schema.js'),
    import('../../lib/password.js'),
  ]);

  let passwordHash = await hashPassword(password);

  try {
    const db = getDb();

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Idempotent by email: a repeated install or a corrected password updates the
    // same account instead of leaving a second half-configured administrator.
    // `status` is deliberately left untouched here — on a reinstall the operator has
    // usually already completed first-run setup, and resetting it would drag them
    // through the organisation wizard again.
    if (existing) {
      await db
        .update(users)
        .set({ displayName, passwordHash, role: 'superadmin', updatedAt: new Date() })
        .where(eq(users.id, existing.id));

      return emitSuccess<AdminCreateResult>(
        'admin:create',
        { userId: existing.id, email, created: false },
        json,
        `Updated the existing administrator ${email}.`,
      );
    }

    const [created] = await db
      .insert(users)
      .values({
        email,
        displayName,
        passwordHash,
        role: 'superadmin',
        // MUST be 'pending_setup', not 'active'. The organisation record is created
        // only by the app's first-login setup flow (auth.service `setup()`), which
        // refuses to run for any other status. Marking the account active here skips
        // that flow, so no organisation is ever created and every org-scoped endpoint
        // answers "No organization configured yet" — the whole product looks broken
        // after a successful install.
        status: 'pending_setup',
      })
      .returning({ id: users.id });

    return emitSuccess<AdminCreateResult>(
      'admin:create',
      { userId: created.id, email, created: true },
      json,
      `Created administrator ${email}.`,
    );
  } catch (err) {
    if (err instanceof CliError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Could not create the administrator account: ${message}`, 'E_ADMIN_CREATE');
  } finally {
    // Drop the derived hash from memory as soon as it has been persisted.
    passwordHash = '';
    await closeDb().catch(() => undefined);
  }
}
