import { apiClient } from '@/shared/api/client';

export interface DashboardSearchUser {
  userId: string;
  displayName: string;
  email: string;
  mailboxId: string | null;
  queryCount: number;
  successCount: number;
  failedCount: number;
  avgResponseMs: number;
  latestAt: string | null;
  latestQuery: string;
}

export interface DashboardSearchHistoryItem {
  id: string;
  queryText: string;
  intent: string;
  responseMs: number;
  success: boolean;
  createdAt: string | null;
}

export interface DashboardSearchUsersResponse {
  users: DashboardSearchUser[];
}

export interface DashboardUserSearchHistoryResponse {
  user: Pick<DashboardSearchUser, 'userId' | 'displayName' | 'email' | 'mailboxId'>;
  searches: DashboardSearchHistoryItem[];
}

export async function getDashboardSearchUsers(limit = 5): Promise<DashboardSearchUsersResponse> {
  const res = await apiClient.get<{ data: DashboardSearchUsersResponse }>('/dashboard/search-history/users', {
    params: { limit },
  });
  return res.data.data;
}

export async function getDashboardUserSearchHistory(userId: string, limit = 5000): Promise<DashboardUserSearchHistoryResponse> {
  const res = await apiClient.get<{ data: DashboardUserSearchHistoryResponse }>(
    `/dashboard/search-history/users/${encodeURIComponent(userId)}`,
    { params: { limit } },
  );
  return res.data.data;
}