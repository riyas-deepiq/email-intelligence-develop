export type AuditEntityType =
  | 'user'
  | 'organization'
  | 'auth_provider'
  | 'mailbox'
  | 'session'
  | 'attachment'
  | 'sync'
  | 'org_hierarchy'
  | 'role';

export type AuditEventType =
  // Auth
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.oidc_login'
  | 'auth.setup_completed'
  | 'auth.password_changed'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.session_revoked'
  // Users
  | 'user.created'
  | 'user.invited'
  | 'user.invite_accepted'
  | 'user.invite_cancelled'
  | 'user.role_changed'
  | 'user.status_changed'
  | 'user.deactivated'
  | 'user.reactivated'
  | 'user.display_name_changed'
  | 'user.email_changed'
  // Roles
  | 'role.created'
  | 'role.updated'
  | 'role.deleted'
  // Organization
  | 'org.updated'
  | 'org.jit_enabled'
  | 'org.jit_disabled'
  | 'org.domains_changed'
  // Auth providers / OIDC
  | 'auth_provider.configured'
  | 'auth_provider.disabled'
  | 'auth_provider.disconnected'
  // Mailboxes
  | 'mailbox.connected'
  | 'mailbox.updated'
  | 'mailbox.deleted'
  | 'mailbox.probe_triggered'
  | 'mailbox.probe_cancelled'
  // Sync
  | 'sync.started'
  | 'sync.paused'
  | 'sync.cancelled'
  | 'sync.schedule_updated'
  // Org hierarchy
  | 'org_hierarchy.node_added'
  | 'org_hierarchy.node_updated'
  | 'org_hierarchy.node_removed'
  // Attachments
  | 'attachment.downloaded';

export interface AuditActor {
  actorId: string | null;
  actorEmail: string;
  actorRole: string;
  sessionId?: string;
  ipAddress?: string;
}

export interface WriteAuditInput {
  actor: AuditActor;
  eventType: AuditEventType;
  entityType: AuditEntityType;
  entityId: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

export interface AuditLogEntry {
  id: bigint;
  ts: string;
  actorId: string | null;
  actorEmail: string;
  actorRole: string;
  ipAddress: string | null;
  sessionId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  mailboxId: string | null;
  actorDisplayName: string | null;
}

export interface AuditQueryFilter {
  actorId?: string;
  actorEmail?: string;
  entityType?: AuditEntityType;
  entityId?: string;
  eventType?: AuditEventType;
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: bigint;
}
