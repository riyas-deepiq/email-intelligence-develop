import { randomUUID } from 'node:crypto';
import { config } from '../../config/env';
import { PgAuthProviderRepository } from './auth-provider.repository.pg';
import type {
  AuthProvider,
  AuthProviderWithSecret,
  ProviderType,
  UpsertAuthProviderInput,
} from './auth-provider.types';

export interface AuthProviderRepository {
  findAll(): Promise<AuthProvider[]>;
  findByProvider(provider: ProviderType): Promise<AuthProvider | null>;
  /** Internal: returns the decrypted clientSecret for OIDC token exchange. */
  findWithSecret(provider: ProviderType): Promise<AuthProviderWithSecret | null>;
  upsert(provider: ProviderType, input: UpsertAuthProviderInput): Promise<AuthProvider>;
  /** Disable the provider and wipe all stored credentials. */
  disconnect(provider: ProviderType): Promise<AuthProvider>;
}

const ts = (): string => new Date().toISOString();

// UUIDs are generated inside the constructor (not at module load) so that
// each InMemoryAuthProviderRepository instance gets its own stable IDs.
// Module-level randomUUID() calls produce the same IDs across every instance
// in a test suite, causing snapshot flakiness between runs.
function makeDefaultProviders(): Map<ProviderType, AuthProvider> {
  const now = ts();
  const defaults: AuthProvider[] = [
    {
      id: randomUUID(),
      provider: 'email_password',
      enabled: true,
      tenantId: null,
      clientId: null,
      redirectUri: null,
      hasClientSecret: false,
      hasServiceAccount: false,
      googleAdminEmail: null,
      googleCustomerId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      provider: 'm365',
      enabled: false,
      tenantId: null,
      clientId: null,
      redirectUri: null,
      hasClientSecret: false,
      hasServiceAccount: false,
      googleAdminEmail: null,
      googleCustomerId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      provider: 'google',
      enabled: false,
      tenantId: null,
      clientId: null,
      redirectUri: null,
      hasClientSecret: false,
      hasServiceAccount: false,
      googleAdminEmail: null,
      googleCustomerId: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  return new Map(defaults.map((p) => [p.provider, p]));
}

export class InMemoryAuthProviderRepository implements AuthProviderRepository {
  private readonly store: Map<ProviderType, AuthProvider>;
  private readonly secrets = new Map<
    ProviderType,
    { clientSecret: string | null; serviceAccountJson: string | null }
  >();

  constructor() {
    this.store = makeDefaultProviders();
  }

  async findAll(): Promise<AuthProvider[]> {
    return Array.from(this.store.values());
  }

  async findByProvider(provider: ProviderType): Promise<AuthProvider | null> {
    return this.store.get(provider) ?? null;
  }

  async findWithSecret(provider: ProviderType): Promise<AuthProviderWithSecret | null> {
    const ap = await this.findByProvider(provider);
    if (!ap) return null;
    const secret = this.secrets.get(provider);
    return {
      ...ap,
      clientSecret: secret?.clientSecret ?? null,
      serviceAccountJson: secret?.serviceAccountJson ?? null,
    };
  }

  async upsert(provider: ProviderType, input: UpsertAuthProviderInput): Promise<AuthProvider> {
    const existing = this.store.get(provider);
    const updated: AuthProvider = {
      id: existing?.id ?? randomUUID(),
      provider,
      enabled: input.enabled,
      tenantId: input.tenantId ?? existing?.tenantId ?? null,
      clientId: input.clientId ?? existing?.clientId ?? null,
      redirectUri: input.redirectUri ?? existing?.redirectUri ?? null,
      hasClientSecret: input.clientSecret != null ? true : (existing?.hasClientSecret ?? false),
      hasServiceAccount:
        input.serviceAccountJson != null ? true : (existing?.hasServiceAccount ?? false),
      googleAdminEmail: input.googleAdminEmail ?? existing?.googleAdminEmail ?? null,
      googleCustomerId: input.googleCustomerId ?? existing?.googleCustomerId ?? null,
      createdAt: existing?.createdAt ?? ts(),
      updatedAt: ts(),
    };
    const previousSecret = this.secrets.get(provider);
    this.secrets.set(provider, {
      clientSecret: input.clientSecret ?? previousSecret?.clientSecret ?? null,
      serviceAccountJson: input.serviceAccountJson ?? previousSecret?.serviceAccountJson ?? null,
    });
    this.store.set(provider, updated);
    return updated;
  }

  async disconnect(provider: ProviderType): Promise<AuthProvider> {
    const existing = this.store.get(provider);
    const cleared: AuthProvider = {
      id: existing?.id ?? randomUUID(),
      provider,
      enabled: false,
      tenantId: null,
      clientId: null,
      redirectUri: null,
      hasClientSecret: false,
      hasServiceAccount: false,
      googleAdminEmail: null,
      googleCustomerId: null,
      createdAt: existing?.createdAt ?? ts(),
      updatedAt: ts(),
    };
    this.secrets.delete(provider);
    this.store.set(provider, cleared);
    return cleared;
  }
}

export function createAuthProviderRepository(): AuthProviderRepository {
  if (config.env === 'test' || config.database.driver === 'memory') {
    return new InMemoryAuthProviderRepository();
  }
  return new PgAuthProviderRepository();
}
