import { ValidationError } from '../../lib/errors';
import type { AuditActor, AuditService } from '../audit/audit.service';
import type { AuthProviderRepository } from './auth-provider.repository';
import type { MailboxRepository } from '../mailboxes/mailbox.repository';
import type { MailboxProvider } from '../mailboxes/mailbox.types';
import type {
  AuthProvider,
  OidcDiscovery,
  ProviderType,
  UpsertAuthProviderInput,
} from './auth-provider.types';

export class AuthProviderService {
  constructor(
    private readonly repo: AuthProviderRepository,
    private readonly audit?: AuditService,
    private readonly mailboxRepo?: MailboxRepository,
  ) {}

  listAll(): Promise<AuthProvider[]> {
    return this.repo.findAll();
  }

  async updateProvider(
    provider: ProviderType,
    input: UpsertAuthProviderInput,
    actor?: AuditActor,
  ): Promise<{ provider: AuthProvider; discovery?: OidcDiscovery }> {
    let discovery: OidcDiscovery | undefined;

    if (input.enabled && provider === 'm365') {
      const existing = await this.repo.findByProvider(provider);
      const tenantId = input.tenantId ?? existing?.tenantId;
      const clientId = input.clientId ?? existing?.clientId;
      const hasSecret = !!input.clientSecret || !!existing?.hasClientSecret;
      if (!tenantId || !clientId || !hasSecret) {
        throw new ValidationError(
          'tenantId, clientId, and clientSecret are required to enable Microsoft 365',
        );
      }
      this.validateTenantId(tenantId);
      discovery = await this.fetchOidcDiscovery(
        `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`,
      );
    }

    if (input.enabled && provider === 'google') {
      const existing = await this.repo.findByProvider(provider);
      const clientId = input.clientId ?? existing?.clientId;
      const hasSecret = !!input.clientSecret || !!existing?.hasClientSecret;
      if (!clientId || !hasSecret) {
        throw new ValidationError('clientId and clientSecret are required to enable Google');
      }
      discovery = await this.fetchOidcDiscovery(
        'https://accounts.google.com/.well-known/openid-configuration',
      );
    }

    const existing = await this.repo.findByProvider(provider);
    const saved = await this.repo.upsert(provider, input);

    if (actor) {
      const eventType = !input.enabled ? 'auth_provider.disabled' : 'auth_provider.configured';
      await this.audit?.providerEvent(
        eventType,
        actor,
        provider,
        existing
          ? {
              provider,
              enabled: existing.enabled,
              clientId: existing.clientId,
              tenantId: existing.tenantId,
            }
          : null,
        { provider, enabled: saved.enabled, clientId: saved.clientId, tenantId: saved.tenantId },
      );
    }

    return { provider: saved, discovery };
  }

  async disconnectProvider(
    provider: ProviderType,
    actor?: AuditActor,
  ): Promise<{ provider: AuthProvider; mailboxesDeleted: number }> {
    if (provider === 'email_password') {
      throw new ValidationError('The email/password provider cannot be disconnected');
    }

    const before = await this.repo.findByProvider(provider);
    const cleared = await this.repo.disconnect(provider);

    const mailboxesDeleted = this.mailboxRepo
      ? await this.mailboxRepo.deleteByProvider(provider as MailboxProvider)
      : 0;

    if (actor) {
      await this.audit?.providerEvent(
        'auth_provider.disconnected',
        actor,
        provider,
        before ? { provider, enabled: before.enabled, clientId: before.clientId } : null,
        { provider, enabled: false, mailboxesDeleted },
      );
    }

    return { provider: cleared, mailboxesDeleted };
  }

  private validateTenantId(tenantId: string): void {
    // Tenant IDs must be a UUID or a simple domain/slug (alphanumeric, dots, hyphens).
    // Reject anything containing slashes, @, or other URL metacharacters that could
    // redirect the fetch to an unintended host (SSRF).
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,251}[a-zA-Z0-9])?$/.test(tenantId)) {
      throw new ValidationError(
        'tenantId must contain only alphanumeric characters, dots, hyphens, or underscores.',
      );
    }
  }

  private async fetchOidcDiscovery(url: string): Promise<OidcDiscovery> {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    } catch {
      throw new ValidationError(
        'Could not reach the OIDC discovery endpoint. Check your Tenant ID and network connectivity.',
      );
    }

    if (!res.ok) {
      throw new ValidationError(
        `OIDC discovery returned HTTP ${res.status}. Verify your Tenant ID is correct.`,
      );
    }

    const json = (await res.json()) as Record<string, unknown>;

    if (
      typeof json.issuer !== 'string' ||
      typeof json.authorization_endpoint !== 'string' ||
      typeof json.token_endpoint !== 'string' ||
      typeof json.jwks_uri !== 'string'
    ) {
      throw new ValidationError(
        'OIDC discovery response is missing required fields (issuer, authorization_endpoint, token_endpoint, jwks_uri).',
      );
    }

    return {
      issuer: json.issuer,
      authorization_endpoint: json.authorization_endpoint,
      token_endpoint: json.token_endpoint,
      jwks_uri: json.jwks_uri,
      userinfo_endpoint:
        typeof json.userinfo_endpoint === 'string' ? json.userinfo_endpoint : undefined,
    };
  }
}
