import { apiClient } from '@/shared/api/client';
import type { UserRecord } from './users.types';

export async function listUsers(): Promise<UserRecord[]> {
  const res = await apiClient.get<{ data: UserRecord[] }>('/users');
  return res.data.data;
}

export async function getUser(id: string): Promise<UserRecord> {
  const res = await apiClient.get<{ data: UserRecord }>(`/users/${id}`);
  return res.data.data;
}

export async function updateUser(
  id: string,
  patch: { displayName?: string; email?: string; role?: string; roleId?: string | null },
): Promise<UserRecord> {
  const res = await apiClient.patch<{ data: UserRecord }>(`/users/${id}`, patch);
  return res.data.data;
}

export interface InviteUserResult {
  user: UserRecord;
  emailSent: boolean;
}

export async function inviteUser(email: string): Promise<InviteUserResult> {
  const res = await apiClient.post<{ data: InviteUserResult }>('/users/invite', { email });
  return res.data.data;
}

export async function deactivateUser(id: string): Promise<UserRecord> {
  const res = await apiClient.post<{ data: UserRecord }>(`/users/${id}/deactivate`);
  return res.data.data;
}

export async function reactivateUser(id: string): Promise<UserRecord> {
  const res = await apiClient.post<{ data: UserRecord }>(`/users/${id}/reactivate`);
  return res.data.data;
}

export async function cancelInvite(id: string): Promise<void> {
  await apiClient.delete(`/users/${id}/invite`);
}

export async function resendInvite(id: string): Promise<{ emailSent: boolean }> {
  const res = await apiClient.post<{ data: { emailSent: boolean } }>(`/users/${id}/invite/resend`);
  return res.data.data;
}

export async function createUserFromMailbox(mailboxId: string): Promise<UserRecord> {
  const res = await apiClient.post<{ data: UserRecord }>('/users/from-mailbox', { mailboxId });
  return res.data.data;
}
