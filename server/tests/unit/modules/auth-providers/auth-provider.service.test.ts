import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../../src/lib/errors';
import { InMemoryAuthProviderRepository } from '../../../../src/modules/auth-providers/auth-provider.repository';
import { AuthProviderService } from '../../../../src/modules/auth-providers/auth-provider.service';

// Helpers

function makeService(): AuthProviderService {
  return new AuthProviderService(new InMemoryAuthProviderRepository());
}

const VALID_DISCOVERY = {
  issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
  authorization_endpoint: 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize',
  token_endpoint: 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token',
  jwks_uri: 'https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys',
};

const VALID_GOOGLE_DISCOVERY = {
  issuer: 'https://accounts.google.com',
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token',
  jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
};

function stubFetch(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 400,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
}

// listAll

describe('AuthProviderService.listAll', () => {
  it('returns all three default providers', async () => {
    const providers = await makeService().listAll();

    expect(providers).toHaveLength(3);
    const types = providers.map((p) => p.provider).sort();
    expect(types).toEqual(['email_password', 'google', 'm365']);
  });

  it('email_password is enabled by default', async () => {
    const providers = await makeService().listAll();
    const native = providers.find((p) => p.provider === 'email_password');
    expect(native?.enabled).toBe(true);
  });

  it('m365 and google are disabled by default', async () => {
    const providers = await makeService().listAll();
    expect(providers.find((p) => p.provider === 'm365')?.enabled).toBe(false);
    expect(providers.find((p) => p.provider === 'google')?.enabled).toBe(false);
  });
});

// updateProvider — disabled

describe('AuthProviderService.updateProvider (enabled: false)', () => {
  it('saves the provider without fetching OIDC discovery', async () => {
    const service = makeService();

    const { provider } = await service.updateProvider('m365', {
      enabled: false,
      tenantId: 'tid',
      clientId: 'cid',
      clientSecret: 'sec',
    });

    expect(provider.enabled).toBe(false);
    expect(provider.provider).toBe('m365');
  });

  it('returns no discovery object when disabled', async () => {
    const service = makeService();
    const result = await service.updateProvider('google', { enabled: false });
    expect(result.discovery).toBeUndefined();
  });
});

// updateProvider — M365 validation

describe('AuthProviderService.updateProvider m365 validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws ValidationError when tenantId is missing', async () => {
    const service = makeService();

    await expect(
      service.updateProvider('m365', { enabled: true, clientId: 'cid', clientSecret: 'sec' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when clientId is missing', async () => {
    const service = makeService();

    await expect(
      service.updateProvider('m365', { enabled: true, tenantId: 'tid', clientSecret: 'sec' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when no client secret exists', async () => {
    const service = makeService();

    await expect(
      service.updateProvider('m365', { enabled: true, tenantId: 'tid', clientId: 'cid' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for a tenantId containing a slash (SSRF guard)', async () => {
    const service = makeService();

    await expect(
      service.updateProvider('m365', {
        enabled: true,
        tenantId: 'evil/tenant',
        clientId: 'cid',
        clientSecret: 'sec',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for a tenantId containing @', async () => {
    const service = makeService();

    await expect(
      service.updateProvider('m365', {
        enabled: true,
        tenantId: 'bad@tenant',
        clientId: 'cid',
        clientSecret: 'sec',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('saves provider and returns discovery on valid M365 config', async () => {
    stubFetch(VALID_DISCOVERY);
    const service = makeService();

    const result = await service.updateProvider('m365', {
      enabled: true,
      tenantId: 'my-tenant-id',
      clientId: 'cid',
      clientSecret: 'sec',
    });

    expect(result.provider.enabled).toBe(true);
    expect(result.provider.tenantId).toBe('my-tenant-id');
    expect(result.discovery?.issuer).toBe(VALID_DISCOVERY.issuer);
  });

  it('throws ValidationError when the discovery endpoint returns non-200', async () => {
    stubFetch({}, false);
    const service = makeService();

    await expect(
      service.updateProvider('m365', {
        enabled: true,
        tenantId: 'my-tenant',
        clientId: 'cid',
        clientSecret: 'sec',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when the discovery document is missing required fields', async () => {
    stubFetch({ issuer: 'https://x.com' }); // missing authorization_endpoint, token_endpoint, jwks_uri
    const service = makeService();

    await expect(
      service.updateProvider('m365', {
        enabled: true,
        tenantId: 'my-tenant',
        clientId: 'cid',
        clientSecret: 'sec',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('uses an existing secret from the repo when no new secret is provided', async () => {
    stubFetch(VALID_DISCOVERY);
    const repo = new InMemoryAuthProviderRepository();
    // Pre-populate the repo with a stored secret.
    await repo.upsert('m365', {
      enabled: false,
      tenantId: 'tid',
      clientId: 'cid',
      clientSecret: 'existing-secret',
    });

    // Re-enable without supplying a new secret — should use the existing one.
    // (In-memory repo tracks hasClientSecret; service reads it to validate.)
    const repoService = new AuthProviderService(repo);
    const result = await repoService.updateProvider('m365', {
      enabled: true,
      tenantId: 'tid',
      clientId: 'cid',
      // no clientSecret — repo already has one
    });

    expect(result.provider.enabled).toBe(true);
    expect(result.provider.hasClientSecret).toBe(true);
  });
});

// updateProvider — Google validation

describe('AuthProviderService.updateProvider google validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws ValidationError when clientId is missing', async () => {
    const service = makeService();

    await expect(
      service.updateProvider('google', { enabled: true, clientSecret: 'sec' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when no client secret exists', async () => {
    const service = makeService();

    await expect(
      service.updateProvider('google', { enabled: true, clientId: 'cid' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('saves provider and returns discovery on valid Google config', async () => {
    stubFetch(VALID_GOOGLE_DISCOVERY);
    const service = makeService();

    const result = await service.updateProvider('google', {
      enabled: true,
      clientId: 'google-client-id',
      clientSecret: 'google-secret',
    });

    expect(result.provider.enabled).toBe(true);
    expect(result.discovery?.issuer).toBe(VALID_GOOGLE_DISCOVERY.issuer);
  });
});

// updateProvider — email_password

describe('AuthProviderService.updateProvider email_password', () => {
  it('toggles email_password without any discovery fetch', async () => {
    const service = makeService();

    const { provider, discovery } = await service.updateProvider('email_password', {
      enabled: false,
    });

    expect(provider.enabled).toBe(false);
    expect(discovery).toBeUndefined();
  });
});
