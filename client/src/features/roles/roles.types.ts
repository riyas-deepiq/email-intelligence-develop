import type { Role } from '@/shared/types/enums';

export interface PermissionCatalogItem {
  id: string;
  label: string;
  group: string;
  description: string;
}

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  baseRole: Role;
  permissions: string[];
  userCount: number;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoleListResult {
  roles: RoleDefinition[];
  permissions: PermissionCatalogItem[];
}

export interface SaveRolePayload {
  name: string;
  description: string;
  baseRole: Role.Employee | Role.Admin;
  permissions: string[];
}
