import { apiClient } from '@/shared/api/client';

export interface AuditLogEntry {
  id: string;
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

export interface AuditQueryParams {
  actorEmail?: string;
  entityType?: string;
  entityId?: string;
  eventType?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditQueryResult {
  data: AuditLogEntry[];
  nextCursor: string | null;
  total: number;
  limit: number;
  totalPages: number;
}

export async function queryAuditLog(params: AuditQueryParams): Promise<AuditQueryResult> {
  const q = new URLSearchParams();
  if (params.actorEmail) q.set('actorEmail', params.actorEmail);
  if (params.entityType) q.set('entityType', params.entityType);
  if (params.entityId)   q.set('entityId',   params.entityId);
  if (params.eventType)  q.set('eventType',  params.eventType);
  if (params.search)     q.set('search',     params.search);
  if (params.from)       q.set('from',       params.from);
  if (params.to)         q.set('to',         params.to);
  if (params.limit)      q.set('limit',      String(params.limit));
  if (params.cursor)     q.set('cursor',     params.cursor);

  const res = await apiClient.get<AuditQueryResult>(`/admin/audit?${q}`);
  return res.data;
}
