import { apiClient } from '@/shared/api/client';

export interface SetupStep {
  done: boolean;
  optional: boolean;
  skipped?: boolean;
}

export interface SetupStatus {
  complete: boolean;
  redirectTo: string | null;
  steps: {
    organization: SetupStep;
    admin: SetupStep;
    sso: SetupStep;
    mailboxes: SetupStep;
  };
}

export async function fetchSetupStatus(): Promise<SetupStatus> {
  const res = await apiClient.get<{ data: SetupStatus }>('/setup/status');
  return res.data.data;
}

export async function skipSetupStep(step: 'sso' | 'hierarchy'): Promise<SetupStatus> {
  const res = await apiClient.patch<{ data: SetupStatus }>('/setup/skip', { step });
  return res.data.data;
}

export async function configureSsoProvider(
  provider: 'm365' | 'google',
  credentials: { tenantId?: string; clientId: string; clientSecret: string },
): Promise<void> {
  await apiClient.put(`/auth-providers/${provider}`, { enabled: true, ...credentials });
}
