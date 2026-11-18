import type { UserRole } from '../users/user.types';
import type { PermissionCatalogItem } from './permission-catalog';

export type AssignableBaseRole = Extract<UserRole, 'employee' | 'admin'>;

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  baseRole: AssignableBaseRole;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  baseRole: UserRole;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  isSystem: boolean;
  userCount: number;
}

export interface RoleListResult {
  roles: RoleDefinition[];
  permissions: PermissionCatalogItem[];
}

export interface CreateRoleInput {
  name: string;
  description: string;
  baseRole: AssignableBaseRole;
  permissions: string[];
}

export type UpdateRoleInput = Partial<CreateRoleInput>;

export interface AssignUserRoleInput {
  roleId?: string;
  systemRole?: AssignableBaseRole;
}
