import { apiClient } from '@/shared/api/client';

export interface Mailbox {
  id: string;
  orgId: string;
  address: string;
  provider: 'm365' | 'google';
  ownerUserId: string | null;
  status: string;
  syncStatus: string;
  syncEnabled: boolean;
  syncFromDate: string | null;
  syncPriority: number;
  probeStatus: string;
  earliestEmailAt: string | null;
  emailCountEstimate: number | null;
  totalMessages: number;
  syncedMessages: number;
  lastSyncAt: string | null;
  // Directory profile (populated at provider-connect time)
  displayName: string | null;
  givenName: string | null;
  familyName: string | null;
  jobTitle: string | null;
  departmentName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateSyncConfigPayload {
  syncEnabled?: boolean;
  syncPriority?: number;
  syncFromDate?: string | null;
}

export async function listMailboxes(limit = 200, offset = 0): Promise<Mailbox[]> {
  const res = await apiClient.get<{ data: Mailbox[] }>(
    `/mailboxes?limit=${limit}&offset=${offset}`,
  );
  return res.data.data;
}

export async function getMailbox(id: string): Promise<Mailbox> {
  const res = await apiClient.get<{ data: Mailbox }>(`/mailboxes/${id}`);
  return res.data.data;
}

export async function listAllMailboxes(): Promise<Mailbox[]> {
  const result = new Map<string, Mailbox>();
  for (let offset = 0; ; offset += 200) {
    const page = await listMailboxes(200, offset);
    for (const mailbox of page) result.set(mailbox.id, mailbox);
    if (page.length < 200) return [...result.values()];
  }
}

/** Fetches a mailbox's profile photo as a Base64 data URI (or null if none). */
export async function getMailboxPhoto(id: string): Promise<string | null> {
  const res = await apiClient.get<{ data: string | null }>(`/mailboxes/${id}/photo`);
  return res.data.data;
}

export interface AccessibleMailbox {
  id: string;
  address: string;
  displayName: string | null;
  givenName: string | null;
  familyName: string | null;
  jobTitle: string | null;
  departmentName: string | null;
}

/**
 * Other users' mailboxes (never the caller's own) the caller is allowed to
 * view mail for — admins get everyone, non-admins get their org-hierarchy
 * reports. Used to populate the "other users" panel on the Mails page.
 */
export async function listAccessibleMailboxes(): Promise<AccessibleMailbox[]> {
  const res = await apiClient.get<{ data: AccessibleMailbox[] }>('/mailboxes/accessible');
  return res.data.data;
}

export async function updateMailboxSyncConfig(
  id: string,
  payload: UpdateSyncConfigPayload,
): Promise<Mailbox> {
  const res = await apiClient.patch<{ data: Mailbox }>(`/mailboxes/${id}`, payload);
  return res.data.data;
}

export async function deleteMailbox(id: string): Promise<void> {
  await apiClient.delete(`/mailboxes/${id}`);
}

export async function triggerProbe(mailboxIds?: string[]): Promise<{ queued: number }> {
  const res = await apiClient.post<{ data: { queued: number } }>('/mailboxes/probe', {
    mailboxIds,
  });
  return res.data.data;
}

export async function cancelProbe(): Promise<{ message: string; cancelled: number }> {
  const res = await apiClient.post<{ data: { message: string; cancelled: number } }>(
    '/mailboxes/probe/cancel',
  );
  return res.data.data;
}

export async function getProbeStatus(): Promise<{
  total: number;
  probed: number;
  pending: number;
  byStatus: Record<string, number>;
  mailboxes: Pick<
    Mailbox,
    'id' | 'address' | 'provider' | 'probeStatus' | 'earliestEmailAt' | 'emailCountEstimate'
  >[];
}> {
  const res = await apiClient.get('/mailboxes/probe/status');
  return (
    res.data as { data: ReturnType<typeof getProbeStatus> extends Promise<infer T> ? T : never }
  ).data;
}
