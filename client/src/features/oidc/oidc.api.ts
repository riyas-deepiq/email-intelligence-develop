import { apiClient } from '@/shared/api/client';

// ── JIT provisioning config ───────────────────────────────────────────────────

export interface JitConfig {
  jitEnabled:     boolean;
  jitDefaultRole: 'employee' | 'admin';
  domains:        string;
}

export async function fetchJitConfig(): Promise<JitConfig> {
  const res = await apiClient.get<{ data: JitConfig }>('/organizations');
  const { jitEnabled, jitDefaultRole, domains } = res.data.data;
  return { jitEnabled, jitDefaultRole, domains };
}

export async function updateJitConfig(input: Pick<JitConfig, 'jitEnabled' | 'jitDefaultRole'>): Promise<JitConfig> {
  const res = await apiClient.patch<{ data: JitConfig }>('/organizations/jit', input);
  const { jitEnabled, jitDefaultRole, domains } = res.data.data;
  return { jitEnabled, jitDefaultRole, domains };
}

export enum ConnectorStatus {
  Active   = 'active',
  Inactive = 'inactive',
}

export type OidcConnectorPayload = {
  provider: string;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
};

export type OidcTestResult = {
  success: boolean;
  message: string;
};

export type OidcConnector = {
  id: string;
  provider: string;
  name: string;
  issuer: string;
  clientId: string;
  scopes: string[];
  redirectUri: string;
  status: ConnectorStatus;
  createdAt: string;
  updatedAt: string;
};

type AuthProviderRow = {
  id: string;
  provider: string;
  enabled: boolean;
  tenantId: string | null;
  clientId: string | null;
  redirectUri: string | null;
  hasClientSecret: boolean;
  createdAt: string;
  updatedAt: string;
};

// Maps client-side provider IDs to server auth_providers.provider values.
// Providers not listed here are not yet supported by the server.
const PROVIDER_MAP: Record<string, string | undefined> = {
  google:   'google',
  azure:    'm365',
  okta:     undefined, // server support coming in a future release
  keycloak: undefined, // server support coming in a future release
};

// Parses the tenant ID out of an Azure issuer URL
// e.g. https://login.microsoftonline.com/{tenantId}/v2.0 → tenantId
function extractTenantId(issuer: string): string | undefined {
  try {
    const segments = new URL(issuer).pathname.split('/').filter(Boolean);
    return segments[0] || undefined;
  } catch {
    return undefined;
  }
}

async function upsertAuthProvider(payload: OidcConnectorPayload, enabled: boolean): Promise<AuthProviderRow> {
  const serverProvider = PROVIDER_MAP[payload.provider];
  if (!serverProvider) {
    throw new Error(`Provider '${payload.provider}' is not yet supported by the server.`);
  }

  const body: Record<string, unknown> = {
    enabled,
    clientId: payload.clientId,
    clientSecret: payload.clientSecret,
    redirectUri: payload.redirectUri,
  };

  if (serverProvider === 'm365') {
    const tenantId = extractTenantId(payload.issuer);
    if (!tenantId) throw new Error('Could not extract tenant ID from the Azure issuer URL. Ensure the URL contains the tenant ID segment.');
    body.tenantId = tenantId;
  }

  const res = await apiClient.put<{ data: { provider: AuthProviderRow } }>(
    `/auth-providers/${serverProvider}`,
    body,
  );
  return res.data.data.provider;
}

export async function testOidcConnector(payload: OidcConnectorPayload): Promise<OidcTestResult> {
  const serverProvider = PROVIDER_MAP[payload.provider];
  if (!serverProvider) {
    return {
      success: false,
      message: `Provider '${payload.provider}' is not yet supported.`,
    };
  }

  try {
    // Save credentials with enabled=false — validates credentials without activating the provider.
    await upsertAuthProvider(payload, false);
    return { success: true, message: 'Connection verified successfully.' };
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: { message?: string } } } };
    const message =
      e.response?.data?.error?.message ??
      (err instanceof Error ? err.message : 'Connection test failed. Please check your credentials and try again.');
    return { success: false, message };
  }
}

// Fetches all auth providers from the server (used to hydrate active/inactive status on load)
export async function fetchAuthProviders(): Promise<AuthProviderRow[]> {
  const res = await apiClient.get<{ data: AuthProviderRow[] }>('/auth-providers');
  return res.data.data;
}

export async function disconnectOidcProvider(provider: string): Promise<{ provider: AuthProviderRow; mailboxesDeleted: number }> {
  const serverProvider = PROVIDER_MAP[provider];
  if (!serverProvider) throw new Error(`Provider '${provider}' is not supported.`);
  const res = await apiClient.delete<{ data: { provider: AuthProviderRow; mailboxesDeleted: number } }>(
    `/auth-providers/${serverProvider}`,
  );
  return res.data.data;
}

export async function saveOidcConnector(payload: OidcConnectorPayload): Promise<OidcConnector> {
  const ap = await upsertAuthProvider(payload, true);
  return {
    id: ap.id,
    provider: payload.provider,
    name: payload.name,
    issuer: payload.issuer,
    clientId: ap.clientId ?? payload.clientId,
    scopes: payload.scopes,
    redirectUri: ap.redirectUri ?? payload.redirectUri,
    status: ap.enabled ? ConnectorStatus.Active : ConnectorStatus.Inactive,
    createdAt: ap.createdAt,
    updatedAt: ap.updatedAt,
  };
}
