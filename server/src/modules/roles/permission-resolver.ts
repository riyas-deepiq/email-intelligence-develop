import type { UserRole } from '../users/user.types';
import { ADMIN_PERMISSIONS, EMPLOYEE_PERMISSIONS } from './permission-catalog';
import type { RoleRepository } from './role.repository';

export interface PermissionSubject {
  role: UserRole | string;
  roleId?: string | null;
}

export async function resolvePermissionsForSubject(
  roles: RoleRepository | undefined,
  subject: PermissionSubject,
): Promise<string[]> {
  if (subject.role === 'superadmin') return [...ADMIN_PERMISSIONS];

  if (subject.roleId && roles) {
    const customRole = await roles.findById(subject.roleId);
    if (customRole) return [...new Set(customRole.permissions)];
  }

  return subject.role === 'admin' ? [...ADMIN_PERMISSIONS] : [...EMPLOYEE_PERMISSIONS];
}
