import { apiClient } from '@/shared/api/client';

export interface MessageRow {
  id:              string;
  mailboxId:       string;
  threadId:        string | null;
  subject:         string | null;
  fromAddress:     string;
  fromName:        string | null;
  toAddresses:     { email: string; name?: string }[];
  hasAttachments:  boolean;
  receivedAt:      string;
  isRead:          boolean;
  importance:      string;
  labels:          string[];
  mailboxAddress:  string;
  mailboxProvider: string;
}

export interface MessagesPage {
  messages:   MessageRow[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

export interface MessageQuery {
  page?:       number;
  limit?:      number;
  mailboxId?:  string;
  search?:     string;
  importance?: string;
  from?:       string;
  to?:         string;
  /** Force scoping to the signed-in user's own mailbox (used by the admin "mailbox" view). */
  scope?:      'own';
}

export async function listMessages(params: MessageQuery = {}): Promise<MessagesPage> {
  const res = await apiClient.get<{ data: MessagesPage }>('/messages', { params });
  return res.data.data;
}

export interface MessageDetail {
  id:                 string;
  mailboxId:          string;
  threadId:           string | null;
  subject:            string | null;
  fromAddress:        string;
  fromName:           string | null;
  toAddresses:        { email: string; name?: string }[];
  ccAddresses:        { email: string; name?: string }[];
  bodyText:           string | null;
  hasAttachments:     boolean;
  receivedAt:         string;
  sentAt:             string | null;
  sizeBytes:          number | null;
  importance:         string;
  isRead:             boolean;
  labels:             string[];
  mailboxAddress:     string;
  mailboxProvider:    string;
  mailboxDisplayName: string | null;
}

export async function getMessage(id: string): Promise<MessageDetail> {
  const res = await apiClient.get<{ data: MessageDetail }>(`/messages/${id}`);
  return res.data.data;
}

export interface MessageGroup {
  mailboxId:          string;
  mailboxAddress:     string;
  mailboxProvider:    string;
  mailboxDisplayName: string | null;
  messageCount:       number;
  unreadCount:        number;
  attachmentCount:    number;
  latestReceivedAt:   string | null;
}

export async function listMessageGroups(): Promise<MessageGroup[]> {
  const res = await apiClient.get<{ data: { groups: MessageGroup[] } }>('/messages/by-mailbox');
  return res.data.data.groups;
}

export interface ThreadRow {
  id:                 string;
  mailboxId:          string;
  subject:            string | null;
  participantEmails:  string[];
  messageCount:       number;
  hasAttachments:     boolean;
  firstMessageAt:     string | null;
  lastMessageAt:      string | null;
  mailboxAddress:     string;
  mailboxProvider:    string;
  mailboxDisplayName: string | null;
  attachmentCount:    number;
}

export interface ThreadsPage {
  threads:    ThreadRow[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

export interface ThreadQuery {
  page?:      number;
  limit?:     number;
  mailboxId?: string;
  search?:    string;
  from?:      string;
  to?:        string;
}

export async function listThreads(params: ThreadQuery = {}): Promise<ThreadsPage> {
  const res = await apiClient.get<{ data: ThreadsPage }>('/threads', { params });
  return res.data.data;
}

export interface ThreadGroup {
  mailboxId:          string;
  mailboxAddress:     string;
  mailboxProvider:    string;
  mailboxDisplayName: string | null;
  threadCount:        number;
  messageCount:       number;
  unreadCount:        number;
  attachmentCount:    number;
  latestMessageAt:    string | null;
}

export async function listThreadGroups(): Promise<ThreadGroup[]> {
  const res = await apiClient.get<{ data: { groups: ThreadGroup[] } }>('/threads/by-mailbox');
  return res.data.data.groups;
}

export interface ThreadMessage {
  id:             string;
  subject:        string | null;
  fromAddress:    string;
  fromName:       string | null;
  toAddresses:    { email: string; name?: string }[];
  ccAddresses:    { email: string; name?: string }[];
  bodyPreview:    string | null;
  bodyText:       string | null;
  hasAttachments: boolean;
  receivedAt:     string;
  sentAt:         string | null;
  sizeBytes:      number | null;
  importance:     string;
  isRead:         boolean;
  labels:         string[];
}

export interface ThreadDetail {
  thread:   ThreadRow;
  messages: ThreadMessage[];
}

export async function getThread(id: string): Promise<ThreadDetail> {
  const res = await apiClient.get<{ data: ThreadDetail }>(`/threads/${id}`);
  return res.data.data;
}

export interface ThreadSummary {
  summary: string | null;
  model:   string | null;
  cached:  boolean;
}

export async function getThreadSummary(id: string): Promise<ThreadSummary> {
  const res = await apiClient.get<{ data: ThreadSummary }>(`/threads/${id}/summary`);
  return res.data.data;
}

export interface AttachmentMeta {
  id:          string;
  name:        string;
  contentType: string | null;
  sizeBytes:   number | null;
  isInline:    boolean;
}

export async function listMessageAttachments(messageId: string): Promise<AttachmentMeta[]> {
  const res = await apiClient.get<{ data: { attachments: AttachmentMeta[] } }>(
    `/messages/${messageId}/attachments`,
  );
  return res.data.data.attachments;
}

export async function downloadMessageAttachment(
  messageId: string,
  attachmentId: string,
  opts: { auditDownload?: boolean } = {},
): Promise<Blob> {
  const res = await apiClient.get<Blob>(
    `/messages/${messageId}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      params: opts.auditDownload ? { audit: 'download' } : undefined,
      responseType: 'blob',
    },
  );
  return res.data;
}

export interface ThreadAttachment extends AttachmentMeta {
  messageId:   string;
  receivedAt:  string;
  fromName:    string | null;
  fromAddress: string;
}

export interface ThreadAttachmentsPage {
  attachments:    ThreadAttachment[];
  failedMessages: number;
}

export async function listThreadAttachments(threadId: string): Promise<ThreadAttachmentsPage> {
  const res = await apiClient.get<{ data: ThreadAttachmentsPage }>(`/threads/${threadId}/attachments`);
  return res.data.data;
}

export interface OrgAttachment {
  messageId:      string;
  id:             string;
  name:           string;
  contentType:    string | null;
  sizeBytes:      number | null;
  subject:        string | null;
  fromAddress:    string;
  fromName:       string | null;
  mailboxAddress: string;
  ownerName:      string | null;
  department:     string | null;
  receivedAt:     string;
}

export interface OrgAttachmentsPage {
  files:          OrgAttachment[];
  total:          number;
  page:           number;
  limit:          number;
  totalPages:     number;
  failedMessages: number;
}

export interface OrgAttachmentsQuery {
  page?:      number;
  limit?:     number;
  mailboxId?: string;
  search?:    string;
  from?:      string;
  to?:        string;
}

export async function listOrgAttachments(params: OrgAttachmentsQuery = {}): Promise<OrgAttachmentsPage> {
  const res = await apiClient.get<{ data: OrgAttachmentsPage }>('/attachments', { params });
  return res.data.data;
}

export interface AttachmentGroup {
  mailboxId:          string;
  mailboxAddress:     string;
  mailboxProvider:    string;
  mailboxDisplayName: string | null;
  department:         string | null;
  fileMessageCount:   number;
  latestReceivedAt:   string | null;
}

export async function listAttachmentGroups(): Promise<AttachmentGroup[]> {
  const res = await apiClient.get<{ data: { groups: AttachmentGroup[] } }>('/attachments/by-mailbox');
  return res.data.data.groups;
}

export interface IndexAttachmentsResult {
  indexed:   number;
  failed:    number;
  remaining: number;
}

/** Index the next batch of un-indexed attachment messages (for filename search). */
export async function indexAttachments(budget = 25): Promise<IndexAttachmentsResult> {
  const res = await apiClient.post<{ data: IndexAttachmentsResult }>(
    '/attachments/index',
    null,
    { params: { budget } },
  );
  return res.data.data;
}

export interface DashboardStats {
  totalMessages:        number;
  totalMailboxes:       number;
  totalUsers:           number;
  totalWithAttachments: number;
  emailsByDay: Array<{ bucket: string; received: number; sent: number }>;
  timeBreakdown: Array<{ label: string; count: number; pct: number }>;
  emailsByMailbox: Array<{ address: string; provider: string; department: string | null; count: number }>;
}

export type DashboardChartPeriod = '24h' | '7d' | '30d' | '90d';

export async function getDashboardStats(period: DashboardChartPeriod = '30d'): Promise<DashboardStats> {
  const res = await apiClient.get<{ data: DashboardStats }>('/dashboard/stats', { params: { period } });
  return res.data.data;
}
