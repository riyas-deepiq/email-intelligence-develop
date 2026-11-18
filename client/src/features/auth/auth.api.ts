import axios from 'axios';
import { apiClient } from '@/shared/api/client';
import type { AuthResponse, LoginPayload, MeResponse, OidcExchangeResponse, SetupPayload, SetupResponse, SessionEntry, TokenPair } from './auth.types';

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const res = await apiClient.post<{ data: AuthResponse }>('/auth/login', payload);
  return res.data.data;
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await apiClient.get<{ data: MeResponse }>('/auth/me');
  return res.data.data;
}

export async function logoutApi(): Promise<void> {
  await apiClient.post('/auth/logout');
}

export async function setupOrg(payload: SetupPayload): Promise<SetupResponse> {
  const res = await apiClient.post<{ data: SetupResponse }>('/auth/setup', payload);
  return res.data.data;
}

export async function refreshTokensApi(): Promise<TokenPair> {
  // Use raw axios (not apiClient) so this call does NOT go through the 401
  // response interceptor — using apiClient here causes an infinite retry loop.
  // The HttpOnly refresh-token cookie is sent automatically via withCredentials.
  const base = import.meta.env.VITE_API_URL ?? '/api/v1';
  const res  = await axios.post<{ data: TokenPair }>(`${base}/auth/refresh`, {}, { withCredentials: true });
  return res.data.data;
}

/** Fetch enabled OIDC providers — used by the login page to show SSO buttons. */
export async function fetchEnabledProviders(): Promise<{ provider: string }[]> {
  const res = await apiClient.get<{ data: { provider: string }[] }>('/auth/providers');
  return res.data.data;
}

/**
 * Exchange the short-lived one-time code (server-redirect flow).
 */
export async function exchangeOidcCode(code: string): Promise<OidcExchangeResponse> {
  const res = await apiClient.post<{ data: OidcExchangeResponse }>('/auth/oidc/exchange', { code });
  return res.data.data;
}

/**
 * Frontend-redirect flow: browser receives code+state from provider,
 * posts them here for the server to exchange using the stored client secret.
 */
export async function completeOidcFlow(code: string, state: string): Promise<OidcExchangeResponse> {
  const res = await apiClient.post<{ data: OidcExchangeResponse }>('/auth/oidc/complete', { code, state });
  return res.data.data;
}

export async function forgotPassword(email: string): Promise<void> {
  await apiClient.post('/auth/forgot-password', { email });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/reset-password', { token, newPassword });
}

export async function acceptInvite(token: string, newPassword: string): Promise<OidcExchangeResponse> {
  const res = await apiClient.post<{ data: OidcExchangeResponse }>('/auth/accept-invite', { token, newPassword });
  return res.data.data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/change-password', { currentPassword, newPassword });
}

export async function listSessions(): Promise<SessionEntry[]> {
  const res = await apiClient.get<{ data: SessionEntry[] }>('/auth/sessions');
  return res.data.data;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await apiClient.delete(`/auth/sessions/${encodeURIComponent(sessionId)}`);
}
