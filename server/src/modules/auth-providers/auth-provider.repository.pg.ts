import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { NotFoundError } from '../../lib/errors';
import { authProviders, type AuthProviderRow } from '../../db/schema';
import { decrypt, encrypt } from './auth-provider.crypto';
import type { AuthProviderRepository } from './auth-provider.repository';
import type {
  AuthProvider,
  AuthProviderWithSecret,
  ProviderType,
  UpsertAuthProviderInput,
} from './auth-provider.types';

function toAuthProvider(row: AuthProviderRow): AuthProvider {
  return {
    id: row.id,
    provider: row.provider as ProviderType,
    enabled: row.enabled,
    tenantId: row.tenantId,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    hasClientSecret: row.clientSecret !== null,
    hasServiceAccount: row.serviceAccountJson !== null,
    googleAdminEmail: row.googleAdminEmail,
    googleCustomerId: row.googleCustomerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PgAuthProviderRepository implements AuthProviderRepository {
  async findAll(): Promise<AuthProvider[]> {
    const rows = await getDb().select().from(authProviders);
    return rows.map(toAuthProvider);
  }

  async findByProvider(provider: ProviderType): Promise<AuthProvider | null> {
    const [row] = await getDb()
      .select()
      .from(authProviders)
      .where(eq(authProviders.provider, provider));
    return row ? toAuthProvider(row) : null;
  }

  async findWithSecret(provider: ProviderType): Promise<AuthProviderWithSecret | null> {
    const [row] = await getDb()
      .select()
      .from(authProviders)
      .where(eq(authProviders.provider, provider));
    if (!row) return null;
    return {
      ...toAuthProvider(row),
      clientSecret: row.clientSecret ? decrypt(row.clientSecret) : null,
      serviceAccountJson: row.serviceAccountJson ? decrypt(row.serviceAccountJson) : null,
    };
  }

  async disconnect(provider: ProviderType): Promise<AuthProvider> {
    const [row] = await getDb()
      .update(authProviders)
      .set({
        enabled: false,
        tenantId: null,
        clientId: null,
        clientSecret: null,
        redirectUri: null,
        serviceAccountJson: null,
        googleAdminEmail: null,
        googleCustomerId: null,
        updatedAt: new Date(),
      })
      .where(eq(authProviders.provider, provider))
      .returning();
    if (!row) throw new NotFoundError(`Auth provider '${provider}' not found`);
    return toAuthProvider(row);
  }

  async upsert(provider: ProviderType, input: UpsertAuthProviderInput): Promise<AuthProvider> {
    const encryptedSecret = input.clientSecret ? encrypt(input.clientSecret) : undefined;
    const encryptedServiceJson = input.serviceAccountJson
      ? encrypt(input.serviceAccountJson)
      : undefined;

    const existing = await this.findByProvider(provider);

    if (existing) {
      // Only include fields that were explicitly provided to avoid nulling
      // out previously saved values on a partial update.
      const patch: Record<string, unknown> = { enabled: input.enabled, updatedAt: new Date() };
      if (input.tenantId !== undefined) patch.tenantId = input.tenantId;
      if (input.clientId !== undefined) patch.clientId = input.clientId;
      if (input.redirectUri !== undefined) patch.redirectUri = input.redirectUri;
      if (encryptedSecret !== undefined) patch.clientSecret = encryptedSecret;
      if (encryptedServiceJson !== undefined) patch.serviceAccountJson = encryptedServiceJson;
      if (input.googleAdminEmail !== undefined) patch.googleAdminEmail = input.googleAdminEmail;
      if (input.googleCustomerId !== undefined) patch.googleCustomerId = input.googleCustomerId;

      const [row] = await getDb()
        .update(authProviders)
        .set(patch)
        .where(eq(authProviders.provider, provider))
        .returning();
      if (!row) throw new NotFoundError(`Auth provider '${provider}' not found`);
      return toAuthProvider(row);
    }

    const [row] = await getDb()
      .insert(authProviders)
      .values({
        provider,
        enabled: input.enabled,
        tenantId: input.tenantId ?? null,
        clientId: input.clientId ?? null,
        clientSecret: encryptedSecret ?? null,
        redirectUri: input.redirectUri ?? null,
        serviceAccountJson: encryptedServiceJson ?? null,
        googleAdminEmail: input.googleAdminEmail ?? null,
        googleCustomerId: input.googleCustomerId ?? null,
      })
      .returning();
    return toAuthProvider(row);
  }
}
