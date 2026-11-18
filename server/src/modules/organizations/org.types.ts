import type { UserRole } from '../users/user.types';

export interface Org {
  id: string;
  name: string;
  domains: string; // comma-separated, e.g. "acme.com, mail.acme.com"
  adminEmail: string;
  jitEnabled: boolean;
  jitDefaultRole: UserRole;
  syncEnabled: boolean;
  globalSyncFromDate: string | null;
  ssoSkipped: boolean;
  hierarchySkipped: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrgInput {
  name: string;
  domains: string;
  adminEmail: string;
}

export interface UpdateJitConfigInput {
  jitEnabled: boolean;
  jitDefaultRole: UserRole;
}

export type SkippableStep = 'sso' | 'hierarchy';

export interface UpdateOrgSyncConfigInput {
  syncEnabled?: boolean;
  globalSyncFromDate?: string | null; // ISO8601 or null to clear
}
