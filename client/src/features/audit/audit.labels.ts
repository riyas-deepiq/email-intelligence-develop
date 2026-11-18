import type { BadgeTone } from '@/shared/components/ui';

/** Human-readable label for every event type the backend actually writes (see Server audit.types.ts). */
export const AUDIT_EVENT_LABELS: Record<string, string> = {
  // Auth
  'auth.login':                    'Logged in',
  'auth.login_failed':             'Failed login attempt',
  'auth.logout':                   'Logged out',
  'auth.oidc_login':               'Signed in via SSO',
  'auth.setup_completed':          'Completed organisation setup',
  'auth.password_changed':         'Changed password',
  'auth.password_reset_requested': 'Requested a password reset',
  'auth.password_reset':           'Reset password',
  'auth.session_revoked':          'Revoked a session',
  // Users
  'user.created':                  'Created user',
  'user.invited':                  'Invited user',
  'user.invite_accepted':          'Accepted invite',
  'user.invite_cancelled':         'Cancelled invite',
  'user.role_changed':             'Changed role for',
  'user.status_changed':           'Changed status for',
  'user.deactivated':              'Deactivated user',
  'user.reactivated':              'Reactivated user',
  'user.display_name_changed':     'Renamed user',
  'user.email_changed':            'Changed email for',
  // Roles
  'role.created':                  'Created role',
  'role.updated':                  'Updated role',
  'role.deleted':                  'Deleted role',
  // Organization
  'org.updated':                   'Updated organisation',
  'org.jit_enabled':               'Enabled JIT provisioning',
  'org.jit_disabled':              'Disabled JIT provisioning',
  'org.domains_changed':           'Updated allowed domains',
  // Auth providers / SSO
  'auth_provider.configured':      'Configured SSO provider',
  'auth_provider.disabled':        'Disabled SSO provider',
  'auth_provider.disconnected':    'Disconnected SSO provider',
  // Mailboxes
  'mailbox.connected':             'Connected mailbox',
  'mailbox.updated':               'Updated mailbox',
  'mailbox.deleted':               'Removed mailbox',
  'mailbox.probe_triggered':       'Triggered a re-scan for',
  'mailbox.probe_cancelled':       'Re-scan cancelled',
  // Sync
  'sync.started':                  'Started sync',
  'sync.paused':                   'Paused sync',
  'sync.schedule_updated':         'Updated sync schedule',
  // Org hierarchy
  'org_hierarchy.node_added':      'Added to hierarchy',
  'org_hierarchy.node_updated':    'Updated hierarchy entry for',
  'org_hierarchy.node_removed':    'Removed from hierarchy',
  // Attachments
  'attachment.downloaded':         'Downloaded',
};

export function auditEventLabel(eventType: string): string {
  return AUDIT_EVENT_LABELS[eventType] ?? eventType.replace(/[._]/g, ' ');
}

const PROVIDER_NAMES: Record<string, string> = {
  azure: 'Microsoft Entra ID', okta: 'Okta', google: 'Google Workspace', keycloak: 'Keycloak', m365: 'Microsoft 365',
};

const LOGIN_FAIL_REASONS: Record<string, string> = {
  user_not_found:     'Unknown email',
  no_native_password: 'No password set (SSO only)',
  invalid_password:   'Incorrect password',
  account_inactive:   'Account inactive',
};

function providerName(id: unknown): string | undefined {
  return typeof id === 'string' && id ? (PROVIDER_NAMES[id] ?? id) : undefined;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * A human-readable "what this event acted on / changed", built per event type
 * from the exact oldValue/newValue shape each backend call site writes (see
 * Server audit.service.ts call sites). Returns null when nothing better than
 * a raw internal ID is available — callers should render a plain dash then.
 */
export function auditTargetLabel(eventType: string, oldValue: unknown, newValue: unknown): string | null {
  const ov = asRecord(oldValue);
  const nv = asRecord(newValue);

  switch (eventType) {
    case 'auth.login_failed':
      return LOGIN_FAIL_REASONS[str(nv['reason']) ?? ''] ?? null;
    case 'auth.oidc_login':
      return providerName(nv['provider']) ?? null;

    case 'user.created':
    case 'user.invited':
      return str(nv['displayName']) ?? str(nv['email']) ?? null;
    case 'user.role_changed':
      return (str(nv['displayName']) ?? str(nv['email'])) && str(nv['role'])
        ? `${nv['displayName'] ?? nv['email']} -> ${nv['roleName'] ?? nv['role']}`
        : null;
    case 'user.display_name_changed':
      return str(ov['displayName']) && str(nv['displayName']) ? `${ov['displayName']} → ${nv['displayName']}` : null;
    case 'user.email_changed':
      return str(ov['email']) && str(nv['email']) ? `${ov['email']} → ${nv['email']}` : null;
    case 'user.deactivated':
    case 'user.reactivated':
      return str(nv['status']) ? `Status → ${nv['status']}` : null;

    case 'role.created':
    case 'role.updated':
    case 'role.deleted':
      return str(nv['name']) ?? str(ov['name']) ?? null;

    case 'org.jit_enabled':
    case 'org.jit_disabled':
    case 'org.updated':
      return str(nv['jitDefaultRole']) ? `Default role: ${nv['jitDefaultRole']}` : null;

    case 'auth_provider.configured':
    case 'auth_provider.disabled':
    case 'auth_provider.disconnected':
      return providerName(nv['provider']) ?? null;

    case 'mailbox.connected': {
      const count = nv['mailboxesCreated'];
      const provider = providerName(nv['provider']);
      return typeof count === 'number'
        ? `${count} mailbox${count === 1 ? '' : 'es'}${provider ? ` via ${provider}` : ''}`
        : null;
    }
    case 'mailbox.deleted':
      return str(ov['address']) ?? null;
    case 'mailbox.probe_triggered': {
      const queued = nv['queued'];
      return typeof queued === 'number' ? `${queued} mailbox${queued === 1 ? '' : 'es'}` : null;
    }

    case 'sync.started': {
      const jobs  = nv['jobsCreated'];
      const count = nv['mailboxCount'];
      return typeof jobs === 'number' && typeof count === 'number'
        ? `${jobs} job${jobs === 1 ? '' : 's'} for ${count} mailbox${count === 1 ? '' : 'es'}`
        : null;
    }
    case 'sync.schedule_updated': {
      const parts: string[] = [];
      if (typeof nv['businessHoursIntervalMin'] === 'number') parts.push(`Business hours → ${nv['businessHoursIntervalMin']} min`);
      if (typeof nv['offHoursIntervalMin'] === 'number')      parts.push(`Off-hours → ${nv['offHoursIntervalMin']} min`);
      if ('initialSyncDays' in nv)                            parts.push(`Initial range → ${nv['initialSyncDays'] ?? 'all time'}`);
      if (str(nv['timezone']))                                parts.push(`Timezone → ${nv['timezone']}`);
      return parts.length > 0 ? parts.join(', ') : null;
    }

    case 'org_hierarchy.node_added':
      return str(nv['displayName']) ?? str(nv['email']) ?? null;
    case 'org_hierarchy.node_updated': {
      const parts: string[] = [];
      if (str(nv['title']))      parts.push(`Title → ${nv['title']}`);
      if (str(nv['department'])) parts.push(`Dept → ${nv['department']}`);
      if ('managerId' in nv)     parts.push('Manager changed');
      const who = str(ov['displayName']) ?? str(ov['email']);
      return parts.length > 0 ? `${who ? `${who}: ` : ''}${parts.join(', ')}` : who ?? null;
    }
    case 'org_hierarchy.node_removed':
      return str(ov['displayName']) ?? str(ov['email']) ?? null;

    case 'attachment.downloaded':
      return str(nv['fileName']) ?? null;

    default:
      return null;
  }
}

export interface AuditCategory {
  id:    string;
  label: string;
  tone:  BadgeTone;
  /** Name of a shared `<Icon name={...} />` icon. */
  icon:  string;
}

/** One entry per `entityType` the backend logs against — used for the filter pills and per-row tone. */
export const AUDIT_CATEGORIES: AuditCategory[] = [
  { id: 'session',       label: 'Auth',          tone: 'accent',   icon: 'key'      },
  { id: 'user',          label: 'Users',         tone: 'violet',   icon: 'users'    },
  { id: 'role',          label: 'Roles',         tone: 'accent',   icon: 'shield'   },
  { id: 'mailbox',       label: 'Mailboxes',     tone: 'warn',     icon: 'mail'     },
  { id: 'organization',  label: 'Organization',  tone: 'teal',     icon: 'building' },
  { id: 'auth_provider', label: 'SSO Providers', tone: 'ok',       icon: 'shield'   },
  { id: 'sync',          label: 'Sync',          tone: 'b-accent', icon: 'activity' },
  { id: 'attachment',    label: 'Downloads',     tone: 'neutral',  icon: 'clip'     },
  { id: 'org_hierarchy', label: 'Org Hierarchy', tone: 'violet',   icon: 'sitemap'  },
];

export function auditCategory(entityType: string): AuditCategory | undefined {
  return AUDIT_CATEGORIES.find((c) => c.id === entityType);
}

export function auditCategoryTone(entityType: string): BadgeTone {
  return auditCategory(entityType)?.tone ?? 'neutral';
}

const TONE_VARS: Record<BadgeTone, { fg: string; bg: string }> = {
  accent:     { fg: 'var(--accent-ink)', bg: 'var(--accent-bg)' },
  ok:         { fg: 'var(--ok)',         bg: 'var(--ok-bg)' },
  warn:       { fg: 'var(--warn)',       bg: 'var(--warn-bg)' },
  danger:     { fg: 'var(--danger)',     bg: 'var(--danger-bg)' },
  violet:     { fg: 'var(--violet)',     bg: 'var(--violet-bg)' },
  teal:       { fg: 'var(--teal)',       bg: 'var(--teal-bg)' },
  neutral:    { fg: 'var(--neutral-fg)', bg: 'var(--neutral-bg)' },
  'b-accent': { fg: 'var(--accent)',     bg: 'var(--accent-bg)' },
};

/** Foreground/background CSS var pair for a badge tone — used to color icons and plain text consistently with `<Badge>`. */
export function toneColorVars(tone: BadgeTone): { fg: string; bg: string } {
  return TONE_VARS[tone];
}
