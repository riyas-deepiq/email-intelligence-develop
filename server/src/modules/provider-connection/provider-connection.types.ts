export type ProviderConnectionProvider = 'm365' | 'google';

export interface M365TestPayload {
  provider: 'm365';
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface GoogleTestPayload {
  provider: 'google';
  serviceAccountJson: string;
  adminEmail: string;
  customerId: string;
}

export type TestConnectionPayload = M365TestPayload | GoogleTestPayload;

export type ConnectPayload = TestConnectionPayload & { confirmed: true };

export interface PermissionCheck {
  canListUsers: boolean;
  canReadMail: boolean;
}

export interface TestConnectionResponse {
  valid: boolean;
  permissions: PermissionCheck;
  userCount: number;
  sampleUsers: { email: string; displayName: string }[];
  error?: string;
}

export interface ConnectResponse {
  mailboxesCreated: number;
  mailboxesDiscovered: number;
  provider: ProviderConnectionProvider;
}

export interface ProviderStatusResponse {
  connected: boolean;
  provider?: ProviderConnectionProvider;
  mailboxCount: number;
  syncStatus: 'not_started' | 'syncing' | 'complete' | 'error';
}

/**
 * Saved (non-secret) provider credentials, used to prefill the connection form and
 * show which providers are already configured. Secrets are never returned — only a
 * flag indicating one is stored.
 */
export interface ProviderConfigResponse {
  m365: {
    connected: boolean;
    tenantId: string | null;
    clientId: string | null;
    hasClientSecret: boolean;
  };
  google: {
    connected: boolean;
    hasServiceAccount: boolean;
    adminEmail: string | null;
    customerId: string | null;
  };
}
