import { apiClient } from '@/shared/api/client';

export interface SyncMailboxEntry {
  id: string;
  address: string;
  displayName: string | null;
  provider: string;
  syncEnabled: boolean;
  syncFromDate: string | null;
  syncPriority: number;
  probeStatus: string;
  earliestEmailAt: string | null;
  emailCountEstimate: number | null;
}

export interface SyncConfig {
  org: {
    syncEnabled: boolean;
    globalSyncFromDate: string | null;
  };
  mailboxes: SyncMailboxEntry[];
}

export interface SyncStatusMailbox {
  id: string;
  address: string;
  provider: string;
  syncEnabled: boolean;
  syncStatus: string;
  totalMessages: number;
  syncedMessages: number;
  lastSyncAt: string | null;
}

export interface SyncStatus {
  syncEnabled: boolean;
  overall: 'not_started' | 'syncing' | 'complete' | 'error';
  counts: Record<string, number>;
  mailboxes: SyncStatusMailbox[];
}

export async function getSyncConfig(): Promise<SyncConfig> {
  const res = await apiClient.get<{ data: SyncConfig }>('/sync/config');
  return res.data.data;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const res = await apiClient.get<{ data: SyncStatus }>('/sync/status');
  return res.data.data;
}

export async function startSync(mailboxIds?: string[]): Promise<void> {
  await apiClient.post('/sync/start', mailboxIds?.length ? { mailboxIds } : undefined);
}

export async function pauseSync(): Promise<{ message: string; cancelled: number }> {
  const res = await apiClient.post<{ data: { message: string; cancelled: number } }>('/sync/pause');
  return res.data.data;
}

export async function updateSyncConfig(payload: {
  org?: { syncEnabled?: boolean; globalSyncFromDate?: string | null };
  mailboxes?: Array<{ id: string; syncEnabled?: boolean; syncFromDate?: string | null; syncPriority?: number }>;
}): Promise<void> {
  await apiClient.put('/sync/config', payload);
}

// ── Schedule (business-hours config) ─────────────────────────────────────────

export interface SyncSchedule {
  timezone: string;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: number[];
  businessHoursIntervalMin: number;
  offHoursIntervalMin: number;
  initialSyncDays: number | null;
}

export async function getSyncSchedule(): Promise<SyncSchedule> {
  const res = await apiClient.get<{ data: SyncSchedule }>('/sync/schedule');
  return res.data.data;
}

export async function updateSyncSchedule(payload: Partial<SyncSchedule>): Promise<void> {
  await apiClient.put('/sync/schedule', payload);
}
