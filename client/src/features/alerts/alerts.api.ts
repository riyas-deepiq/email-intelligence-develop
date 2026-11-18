import { apiClient } from '@/shared/api/client';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  category: string;
  title: string;
  description: string;
  source: string;
  mailboxId: string | null;
  read: boolean;
  createdAt: string;
}

export async function listAlerts(): Promise<Alert[]> {
  const res = await apiClient.get<{ data: Alert[] }>('/alerts');
  return res.data.data;
}

export async function markAllAlertsRead(): Promise<void> {
  await apiClient.post('/alerts/mark-all-read');
}

export async function markAlertRead(id: string): Promise<void> {
  await apiClient.patch(`/alerts/${id}/read`);
}
