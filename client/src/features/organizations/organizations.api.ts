import { apiClient } from '@/shared/api/client';

export interface OrgRecord {
  id:         string;
  name:       string;
  domains:    string;
  adminEmail: string;
  createdAt:  string;
  updatedAt:  string;
}

export async function getOrg(): Promise<OrgRecord> {
  const res = await apiClient.get<{ data: OrgRecord }>('/organizations');
  return res.data.data;
}

export async function createOrg(input: { name: string; domains: string; adminEmail: string }): Promise<OrgRecord> {
  const res = await apiClient.post<{ data: OrgRecord }>('/organizations', input);
  return res.data.data;
}

export async function updateOrg(input: { name?: string; domains?: string }): Promise<OrgRecord> {
  const res = await apiClient.patch<{ data: OrgRecord }>('/organizations', input);
  return res.data.data;
}
