export interface PermissionCatalogItem {
  id: string;
  label: string;
  group: string;
  description: string;
}

export const PERMISSION_CATALOG: PermissionCatalogItem[] = [
  {
    id: 'search.use',
    label: 'Search intelligence',
    group: 'Intelligence',
    description: 'Run natural-language searches across accessible mailbox data.',
  },
  {
    id: 'emails.read',
    label: 'Read mails',
    group: 'Intelligence',
    description: 'Browse indexed mail records within the user access scope.',
  },
  {
    id: 'threads.read',
    label: 'Read threads',
    group: 'Intelligence',
    description: 'View conversation threads and message timelines.',
  },
  {
    id: 'attachments.read',
    label: 'Read attachments',
    group: 'Intelligence',
    description: 'Search and inspect indexed attachment metadata.',
  },
  {
    id: 'summaries.read',
    label: 'Read AI summaries',
    group: 'Intelligence',
    description: 'View generated thread summaries and extracted entities.',
  },
  {
    id: 'users.manage',
    label: 'Manage users',
    group: 'Administration',
    description: 'Invite, deactivate, reactivate, and edit users.',
  },
  {
    id: 'roles.manage',
    label: 'Manage roles',
    group: 'Administration',
    description: 'Create roles, edit permissions, and assign roles to users.',
  },
  {
    id: 'org.manage',
    label: 'Manage organisation',
    group: 'Administration',
    description: 'Update organisation hierarchy and domain structure.',
  },
  {
    id: 'providers.manage',
    label: 'Manage email providers',
    group: 'Data Sources',
    description: 'Configure Microsoft 365 or Google Workspace connections.',
  },
  {
    id: 'mailboxes.manage',
    label: 'Manage sync mail',
    group: 'Data Sources',
    description: 'Control mailbox sync settings and mailbox ownership.',
  },
  {
    id: 'reports.read',
    label: 'Read reports',
    group: 'Monitoring',
    description: 'View reports and analytics dashboards.',
  },
  {
    id: 'alerts.manage',
    label: 'Manage alerts',
    group: 'Monitoring',
    description: 'View and acknowledge operational or compliance alerts.',
  },
  {
    id: 'audit.read',
    label: 'Read audit logs',
    group: 'Monitoring',
    description: 'Inspect audit events and export audit logs.',
  },
  {
    id: 'monitoring.read',
    label: 'Read monitoring',
    group: 'Monitoring',
    description: 'View collector health and ingestion pipeline status.',
  },
  {
    id: 'sso.manage',
    label: 'Manage SSO',
    group: 'Security',
    description: 'Configure SSO and JIT provisioning settings.',
  },
  {
    id: 'settings.manage_security',
    label: 'Manage security settings',
    group: 'Security',
    description: 'Manage security controls such as sessions and notification policy.',
  },
];

export const EMPLOYEE_PERMISSIONS = [
  'search.use',
  'emails.read',
  'threads.read',
  'attachments.read',
  'summaries.read',
];

export const ADMIN_PERMISSIONS = PERMISSION_CATALOG.map((p) => p.id);

export function knownPermissionIds(): Set<string> {
  return new Set(PERMISSION_CATALOG.map((p) => p.id));
}
