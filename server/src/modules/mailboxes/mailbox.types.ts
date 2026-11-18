export type MailboxProvider = 'm365' | 'google';
export type MailboxStatus = 'active' | 'paused' | 'error';
export type MailboxSyncStatus = 'not_started' | 'syncing' | 'complete' | 'error';
export type ProbeStatus = 'not_started' | 'pending' | 'running' | 'complete' | 'error';

export interface Mailbox {
  id: string;
  orgId: string;
  ownerUserId: string | null;
  address: string;
  provider: MailboxProvider;
  providerUserId: string | null;
  syncToken: string | null;
  status: MailboxStatus;
  syncStatus: MailboxSyncStatus;
  syncEnabled: boolean;
  syncFromDate: string | null;
  backfilledFromAt: string | null;
  syncPriority: number;
  probeStatus: ProbeStatus;
  earliestEmailAt: string | null;
  emailCountEstimate: number | null;
  totalMessages: number;
  syncedMessages: number;
  lastSyncAt: string | null;
  // Directory profile
  displayName: string | null;
  givenName: string | null;
  familyName: string | null;
  jobTitle: string | null;
  departmentName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMailboxInput {
  orgId: string;
  address: string;
  provider: MailboxProvider;
  providerUserId?: string | null;
  ownerUserId?: string | null;
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  jobTitle?: string | null;
  departmentName?: string | null;
}

export interface UpdateMailboxSyncConfigInput {
  syncEnabled?: boolean;
  syncFromDate?: string | null;
  syncPriority?: number;
}

export interface UpdateMailboxProfileInput {
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  jobTitle?: string | null;
  departmentName?: string | null;
  ownerUserId?: string | null;
}
