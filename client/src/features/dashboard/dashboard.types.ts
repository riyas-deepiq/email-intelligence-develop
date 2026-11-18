import { Role } from '@/shared/types/enums';

export enum View {
  // ── Shared (all roles) ───────────────────────────────────────────────────
  Overview      = 'overview',
  Search        = 'search',
  Emails        = 'emails',
  Threads       = 'threads',
  Attachments   = 'attachments',
  AiSummaries   = 'ai-summaries',
  Settings      = 'settings',

  // ── Admin-only ───────────────────────────────────────────────────────────
  Users         = 'users',
  Orgs          = 'orgs',
  Departments   = 'departments',
  Roles         = 'roles',
  Reports       = 'reports',
  Alerts        = 'alerts',
  Audit         = 'audit',
  Monitoring    = 'monitoring',
  RagPipeline   = 'rag-pipeline',
  Admin         = 'admin',
  Mailboxes     = 'mailboxes',
  Oidc          = 'oidc',
  EmailProvider = 'email-provider',
  Sync          = 'sync',
}

export enum ServiceStatus {
  Operational = 'operational',
  Degraded    = 'degraded',
  Pending     = 'pending',
}

export const VALID_VIEWS = new Set<string>(Object.values(View));

export const VIEW_ROUTES: Record<View, string> = {
  [View.Overview]:      '/dashboard',
  [View.Search]:        '/search',
  [View.Emails]:        '/mails',
  [View.Threads]:       '/threads',
  [View.Attachments]:   '/attachments',
  [View.AiSummaries]:   '/ai-summaries',
  [View.Settings]:      '/settings',
  [View.Users]:         '/users',
  [View.Orgs]:          '/organizations',
  [View.Departments]:   '/org-hierarchy',
  [View.Roles]:         '/roles',
  [View.Reports]:       '/reports',
  [View.Alerts]:        '/alerts',
  [View.Audit]:         '/audit-logs',
  [View.Monitoring]:    '/monitoring',
  [View.RagPipeline]:   '/vector-processing',
  [View.Admin]:         '/admin-console',
  [View.Mailboxes]:     '/sync-mail',
  [View.Oidc]:          '/sso-settings',
  [View.EmailProvider]: '/email-providers',
  [View.Sync]:          '/sync-mail',
};

export const ROUTED_VIEWS: View[] = [
  View.Overview,
  View.Search,
  View.Emails,
  View.Threads,
  View.Attachments,
  View.AiSummaries,
  View.Settings,
  View.Users,
  View.Orgs,
  View.Departments,
  View.Roles,
  View.Reports,
  View.Alerts,
  View.Audit,
  View.Monitoring,
  View.RagPipeline,
  View.Admin,
  View.Mailboxes,
  View.Oidc,
  View.EmailProvider,
];

export const DASHBOARD_VIEW_ALIASES: Record<string, View> = {
  [View.Sync]:         View.Mailboxes,
  'sync-mail':         View.Mailboxes,
  mailboxes:           View.Mailboxes,
  'org-hierarchy':     View.Departments,
  'org-tree':          View.Departments,
  organizations:       View.Orgs,
  organization:        View.Orgs,
  'email-providers':   View.EmailProvider,
  'email-provider':    View.EmailProvider,
  providers:           View.EmailProvider,
  sso:                 View.Oidc,
  'sso-settings':      View.Oidc,
  mails:               View.Emails,
  mail:                View.Emails,
  summaries:           View.AiSummaries,
  'audit-log':         View.Audit,
  'audit-logs':        View.Audit,
  'reports-analytics': View.Reports,
  'admin-console':     View.Admin,
};

export function resolveViewParam(viewParam?: string): View {
  if (!viewParam) return View.Overview;
  return DASHBOARD_VIEW_ALIASES[viewParam] ?? (VALID_VIEWS.has(viewParam) ? (viewParam as View) : View.Overview);
}

export function viewPath(view: View): string {
  return VIEW_ROUTES[view] ?? VIEW_ROUTES[View.Overview];
}

export const ROLE_LABEL: Record<Role, string> = {
  [Role.SuperAdmin]: 'Super Admin',
  [Role.Admin]:      'Admin',
  [Role.Employee]:   'Employee',
};

// Views that are hidden from Employee role
export const ADMIN_ONLY_VIEWS = new Set<View>([
  View.Users,
  View.Orgs,
  View.Departments,
  View.Roles,
  View.Reports,
  View.Alerts,
  View.Audit,
  View.Monitoring,
  View.RagPipeline,
  View.Admin,
  View.Mailboxes,
  View.Oidc,
  View.EmailProvider,
  View.Sync,
]);

export const VIEW_META: Record<View, { title: string; subtitle: string }> = {
  [View.Overview]:      { title: 'Overview',              subtitle: 'Snapshot of email activity, key stats, and recent updates' },
  [View.Search]:        { title: 'Search & Retrieval',    subtitle: 'Natural-language recall across all corporate email' },
  [View.Emails]:        { title: 'Mails',                 subtitle: 'Browse and search indexed email messages for you and your reports' },
  [View.Threads]:       { title: 'Threads',               subtitle: 'Email conversation threads with AI summaries' },
  [View.Attachments]:   { title: 'Attachments',           subtitle: 'All documents, PDFs, and files across connected mailboxes' },
  [View.AiSummaries]:   { title: 'AI Summaries',          subtitle: 'Generate grounded summaries from indexed email threads' },
  [View.Settings]:      { title: 'Settings',              subtitle: 'Manage your preferences and account configuration' },
  [View.Users]:         { title: 'Users',                 subtitle: 'Invite, manage, and monitor platform user accounts' },
  [View.Orgs]:          { title: 'Organizations',         subtitle: 'Organization details, domains, and admin contact' },
  [View.Departments]:   { title: 'Org Hierarchy',         subtitle: 'Organisation hierarchy and reporting-chain scope' },
  [View.Roles]:         { title: 'Roles & Permissions',   subtitle: 'Define roles, configure permissions, and assign them to users' },
  [View.Reports]:       { title: 'Reports & Analytics',   subtitle: 'Aggregated business intelligence over time' },
  [View.Alerts]:        { title: 'Alerts',                subtitle: 'Security and compliance alerts' },
  [View.Audit]:         { title: 'Audit Log',             subtitle: 'Admin actions, downloads, and auth events across your organization' },
  [View.Monitoring]:    { title: 'Monitoring',            subtitle: 'Ingestion pipeline health and throughput' },
  [View.RagPipeline]:   { title: 'AI Search Processing',  subtitle: 'How emails and attachments are prepared for AI search' },
  [View.Admin]:         { title: 'Admin Console',         subtitle: 'Email providers, SSO settings, and role permissions' },
  [View.Mailboxes]:     { title: 'Mailboxes',             subtitle: 'Mailbox sync status, scan progress, and sync schedule' },
  [View.Oidc]:          { title: 'SSO Settings',          subtitle: 'Configure SSO and just-in-time user provisioning' },
  [View.EmailProvider]: { title: 'Email Provider',        subtitle: 'Connect Microsoft 365 or Google Workspace' },
  [View.Sync]:          { title: 'Sync',                  subtitle: 'Mailbox sync status, scan progress, and sync schedule' },
};
