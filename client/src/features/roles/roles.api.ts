import { apiClient } from '@/shared/api/client';
import type { Role } from '@/shared/types/enums';
import type { RoleDefinition, RoleListResult, SaveRolePayload } from './roles.types';
import type { UserRecord } from '@/features/users/users.types';

export async function listRoles(): Promise<RoleListResult> {
  const res = await apiClient.get<{ data: RoleListResult }>('/roles');
  return res.data.data;
}

export async function createRole(payload: SaveRolePayload): Promise<RoleDefinition> {
  const res = await apiClient.post<{ data: RoleDefinition }>('/roles', payload);
  return res.data.data;
}

export async function updateRole(id: string, payload: Partial<SaveRolePayload>): Promise<RoleDefinition> {
  const res = await apiClient.patch<{ data: RoleDefinition }>(`/roles/${id}`, payload);
  return res.data.data;
}

export async function deleteRole(id: string): Promise<void> {
  await apiClient.delete(`/roles/${id}`);
}

export async function assignUserRole(
  userId: string,
  assignment: { roleId: string } | { systemRole: Role.Employee | Role.Admin },
): Promise<UserRecord> {
  const res = await apiClient.patch<{ data: UserRecord }>(`/roles/users/${userId}`, assignment);
  return res.data.data;
}
