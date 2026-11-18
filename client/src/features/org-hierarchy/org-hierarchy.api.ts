import { apiClient } from '@/shared/api/client';

export interface OrgNodeDto {
  id: string;
  orgId: string;
  userId: string | null;
  title: string;
  department: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    roleName: string | null;
  } | null;
}
export interface ReportingLine {
  managerNodeId: string;
  reportNodeId: string;
}
export interface OrgGraph {
  nodes: OrgNodeDto[];
  reportingLines: ReportingLine[];
}
export interface PositionInput {
  title: string;
  department?: string | null;
  sortOrder?: number;
}
const base = '/admin/org/hierarchy';
export async function listOrgNodes(): Promise<OrgGraph> {
  return (await apiClient.get<{ data: OrgGraph }>(base)).data.data;
}
export async function addOrgNode(
  input: PositionInput & { managerNodeIds: string[] },
): Promise<OrgGraph> {
  return (await apiClient.post<{ data: OrgGraph }>(base + '/nodes', input)).data.data;
}
export async function updateOrgNode(id: string, input: Partial<PositionInput>): Promise<OrgGraph> {
  return (await apiClient.patch<{ data: OrgGraph }>(base + '/nodes/' + id, input)).data.data;
}
export async function updateManagers(id: string, managerNodeIds: string[]): Promise<OrgGraph> {
  return (
    await apiClient.put<{ data: OrgGraph }>(base + '/nodes/' + id + '/managers', { managerNodeIds })
  ).data.data;
}
export async function assignUser(id: string, userId: string | null): Promise<OrgGraph> {
  return (
    await apiClient.put<{ data: OrgGraph }>(base + '/nodes/' + id + '/assignment', { userId })
  ).data.data;
}
export async function removeOrgNode(id: string): Promise<void> {
  await apiClient.delete(base + '/nodes/' + id);
}
export async function getScope(userId: string): Promise<OrgGraph & { mailboxIds: string[] }> {
  return (
    await apiClient.get<{ data: OrgGraph & { mailboxIds: string[] } }>(base + '/scope/' + userId)
  ).data.data;
}
