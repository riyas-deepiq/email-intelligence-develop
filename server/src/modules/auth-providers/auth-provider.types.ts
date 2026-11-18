export type ProviderType = 'email_password' | 'm365' | 'google';

export const ALL_PROVIDERS: ProviderType[] = ['email_password', 'm365', 'google'];

export interface AuthProvider {
  id: string;
  provider: ProviderType;
  enabled: boolean;
  tenantId: string | null;
  clientId: string | null;
  redirectUri: string | null;
  hasClientSecret: boolean; // true when an encrypted secret is stored; the secret itself is never returned
  hasServiceAccount: boolean; // true when an encrypted Google service-account key is stored
  googleAdminEmail: string | null;
  googleCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAuthProviderInput {
  enabled: boolean;
  tenantId?: string | null;
  clientId?: string | null;
  clientSecret?: string | null; // plaintext — encrypted before DB write
  redirectUri?: string | null;
  serviceAccountJson?: string | null; // plaintext — encrypted before DB write
  googleAdminEmail?: string | null;
  googleCustomerId?: string | null;
}

export interface AuthProviderWithSecret extends AuthProvider {
  clientSecret: string | null; // plaintext (decrypted) — internal use only
  serviceAccountJson: string | null; // plaintext (decrypted) — internal use only (Google)
}

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}
