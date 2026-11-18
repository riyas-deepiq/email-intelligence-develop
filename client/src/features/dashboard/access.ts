import type { User } from '@/features/auth/auth.types';
import { Role } from '@/shared/types/enums';
import { View } from './dashboard.types';

export type PermissionId =
  | 'search.use'
  | 'emails.read'
  | 'threads.read'
  | 'attachments.read'
  | 'summaries.read'
  | 'users.manage'
  | 'roles.manage'
  | 'org.manage'
  | 'providers.manage'
  | 'mailboxes.manage'
  | 'reports.read'
  | 'alerts.manage'
  | 'audit.read'
  | 'monitoring.read'
  | 'sso.manage'
  | 'settings.manage_security';

const ADMIN_FALLBACK_PERMISSIONS: PermissionId[] = [
  'search.use',
  'emails.read',
  'threads.read',
  'attachments.read',
  'summaries.read',
  'users.manage',
  'roles.manage',
  'org.manage',
  'providers.manage',
  'mailboxes.manage',
  'reports.read',
  'alerts.manage',
  'audit.read',
  'monitoring.read',
  'sso.manage',
  'settings.manage_security',
];

const EMPLOYEE_FALLBACK_PERMISSIONS: PermissionId[] = [
  'search.use',
  'emails.read',
  'threads.read',
  'attachments.read',
  'summaries.read',
];

export const VIEW_PERMISSIONS: Partial<Record<View, PermissionId>> = {
  [View.Search]:        'search.use',
  [View.Emails]:        'emails.read',
  [View.Threads]:       'threads.read',
  [View.Attachments]:   'attachments.read',
  [View.AiSummaries]:   'summaries.read',
  [View.Users]:         'users.manage',
  [View.Roles]:         'roles.manage',
  [View.Orgs]:          'org.manage',
  [View.Departments]:   'org.manage',
  [View.EmailProvider]: 'providers.manage',
  [View.Mailboxes]:     'mailboxes.manage',
  [View.Sync]:          'mailboxes.manage',
  [View.Reports]:       'reports.read',
  [View.Alerts]:        'alerts.manage',
  [View.Audit]:         'audit.read',
  [View.Monitoring]:    'monitoring.read',
  [View.Oidc]:          'sso.manage',
  [View.Admin]:         'settings.manage_security',
};

export function userPermissions(user: User | null): string[] {
  if (!user) return [];
  if (user.permissions?.length) return user.permissions;
  if (user.role === Role.SuperAdmin || user.role === Role.Admin) return ADMIN_FALLBACK_PERMISSIONS;
  return EMPLOYEE_FALLBACK_PERMISSIONS;
}

export function hasPermission(user: User | null, permission: PermissionId): boolean {
  return userPermissions(user).includes(permission);
}

export function hasAnyPermission(user: User | null, permissions: PermissionId[]): boolean {
  return permissions.some((permission) => hasPermission(user, permission));
}

/**
 * Views restricted by ROLE rather than by permission.
 *
 * A permission cannot express this: superadmin resolves to the full admin
 * permission set, so there is no permission an admin lacks. The server applies
 * the same rule with requireRole('superadmin') on
 * GET /dashboard/rag-index/stages — this list only keeps the navigation honest,
 * it is not the security boundary.
 */
const SUPERADMIN_VIEWS: View[] = [View.RagPipeline];

export function canAccessView(user: User | null, view: View): boolean {
  if (view === View.Overview || view === View.Settings) return true;
  if (SUPERADMIN_VIEWS.includes(view)) return user?.role === Role.SuperAdmin;
  const permission = VIEW_PERMISSIONS[view];
  return permission ? hasPermission(user, permission) : true;
}

export function hasAnyElevatedPermission(user: User | null): boolean {
  return hasAnyPermission(user, [
    'users.manage',
    'roles.manage',
    'org.manage',
    'providers.manage',
    'mailboxes.manage',
    'reports.read',
    'alerts.manage',
    'audit.read',
    'monitoring.read',
    'sso.manage',
    'settings.manage_security',
  ]);
}
