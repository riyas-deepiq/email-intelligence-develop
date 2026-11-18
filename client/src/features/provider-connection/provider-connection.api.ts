import { apiClient } from '@/shared/api/client';
import type {
  ConnectPayload,
  ConnectResponse,
  ProviderConfigResponse,
  ProviderStatusResponse,
  TestConnectionPayload,
  TestConnectionResponse,
} from './provider-connection.types';

export async function testProviderConnection(
  payload: TestConnectionPayload,
): Promise<TestConnectionResponse> {
  const res = await apiClient.post<TestConnectionResponse>('/provider-connection/test', payload);
  return res.data;
}

export async function connectProvider(payload: ConnectPayload): Promise<ConnectResponse> {
  const res = await apiClient.post<ConnectResponse>('/provider-connection/connect', payload);
  return res.data;
}

export async function getProviderStatus(): Promise<ProviderStatusResponse> {
  const res = await apiClient.get<ProviderStatusResponse>('/provider-connection/status');
  return res.data;
}

export async function getProviderConfig(): Promise<ProviderConfigResponse> {
  const res = await apiClient.get<ProviderConfigResponse>('/provider-connection/config');
  return res.data;
}

export async function resyncMailboxes(mailboxIds?: string[]): Promise<{ created: number; updated: number; errors: string[] }> {
  const res = await apiClient.post<{ data: { created: number; updated: number; errors: string[] } }>(
    '/provider-connection/resync',
    mailboxIds?.length ? { mailboxIds } : undefined,
  );
  return res.data.data;
}
