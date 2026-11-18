import { config } from '../../../config/env';
import { logger } from '../../../lib/logger';

/** Mirrors RAG's api/models.py SourceChunk exactly (snake_case — it's the wire format). */
export interface RagSourceChunk {
  email_id: string;
  thread_id: string;
  subject: string;
  from_addr: string;
  date: string;
  source_type: string;
  filename: string;
  score: number;
  excerpt: string;
}

/** Mirrors RAG's api/models.py QueryResponse. */
export interface RagAskResponse {
  answer: string;
  chunks: RagSourceChunk[];
  user_id: number;
  query: string;
  elapsed_ms: number;
}

/** Mirrors RAG's api/models.py IngestJobSummary. */
export interface RagIngestJob {
  job_id: number;
  status: 'pending' | 'running' | 'done' | 'error' | string;
  progress: string;
  points: number;
  error_msg: string;
  created_at: string | null;
  updated_at: string | null;
}

/** Mirrors RAG's api/models.py StageProgress — see RAG/ingestion/progress.py. */
export interface RagStageProgress {
  key: 'read' | 'extract' | 'chunk' | 'embed' | 'store' | string;
  label: string;
  unit: string;
  state: 'pending' | 'running' | 'done' | string;
  count: number;
  /** Unix seconds. Stages loop and overlap — these do NOT sum to the run total. */
  started_at: number | null;
  ended_at: number | null;
  elapsed_ms: number | null;
}

/** Mirrors RAG's api/models.py LogLine. */
export interface RagLogLine {
  ts: number;
  level: 'info' | 'warn' | 'error' | string;
  message: string;
}

/** Mirrors RAG's api/models.py IndexOverviewResponse. */
export interface RagIndexOverview {
  jobs_active: number;
  jobs_by_status: Record<string, number>;
  recent_jobs: RagIngestJob[];
  active_job_id: number | null;
  active_job_kind: 'combined' | 'mail' | 'attachments' | null;
  active_stages: RagStageProgress[];
  active_log: RagLogLine[];
  active_elapsed_ms: number | null;
  ocr_available: boolean;
  indexed_chunks: number;
  body_chunks: number;
  attachment_chunks: number;
  collections: Record<string, unknown>;
  last_synced_at: string | null;
  embed_model: string;
  chunk_size: number;
  chunk_overlap: number;
  max_workers: number;
  qdrant_ok: boolean;
  qdrant_error: string;
}

function ragHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.ragApi.secret) headers['Authorization'] = `Bearer ${config.ragApi.secret}`;
  return headers;
}

/**
 * Non-streaming RAG query. mailboxIds is this server's own already-resolved
 * access scope (getScopedMailboxIds() / admin-check) — RAG trusts it directly
 * rather than re-deriving identity, since this is a server-to-server call.
 * An empty array is a valid, meaningful scope (the caller can see nothing),
 * not "no filter" — see RAG's build_mailbox_filter().
 */
export async function askRag(query: string, mailboxIds: string[]): Promise<RagAskResponse> {
  const res = await fetch(`${config.ragApi.url}/api/v1/query/ask`, {
    method: 'POST',
    headers: ragHeaders(),
    body: JSON.stringify({ query, mailbox_ids: mailboxIds }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error({ status: res.status, text }, 'RAG /query/ask failed');
    throw new Error(`RAG service error (${res.status})`);
  }
  return res.json() as Promise<RagAskResponse>;
}

/**
 * Search-index overview for the dashboard.
 *
 * Returns `null` rather than throwing when RAG cannot be reached. RAG is an
 * optional component — plenty of installations run without it — so a dashboard
 * panel that says "not connected" is the correct outcome, not a failed request
 * that takes the whole monitoring page down with it.
 */
export async function getRagIndexOverview(): Promise<RagIndexOverview | null> {
  try {
    const res = await fetch(`${config.ragApi.url}/api/v1/ingest/overview`, {
      method: 'GET',
      headers: ragHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'RAG /ingest/overview returned a non-OK status');
      return null;
    }
    return (await res.json()) as RagIndexOverview;
  } catch (err) {
    logger.warn({ err }, 'RAG /ingest/overview unreachable');
    return null;
  }
}

/**
 * Persistent vector-processing event feed. The caller pipes the SSE bytes to
 * the browser; RAG emits data only when its in-memory pipeline revision changes.
 */
export async function streamRagPipeline(signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${config.ragApi.url}/api/v1/ingest/live/events`, {
    method: 'GET',
    headers: ragHeaders(),
    signal,
  });
  if (!res.ok || !res.body) {
    const responseText = await res.text().catch(() => '');
    logger.error({ status: res.status, text: responseText }, 'RAG /ingest/live/events failed');
    throw new Error(`RAG service error (${res.status})`);
  }
  return res;
}

/**
 * Streaming RAG query — returns the raw fetch Response so the caller can pipe
 * its SSE body straight through (see chat.controller.ts), reshaping each
 * event into the client's expected wire format along the way.
 */
export async function streamRag(
  query: string,
  mailboxIds: string[],
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(`${config.ragApi.url}/api/v1/query/stream`, {
    method: 'POST',
    headers: ragHeaders(),
    body: JSON.stringify({ query, mailbox_ids: mailboxIds }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    logger.error({ status: res.status, text }, 'RAG /query/stream failed');
    throw new Error(`RAG service error (${res.status})`);
  }
  return res;
}

export interface TriggerRagIngestOptions {
  mailboxId?: string;
  orgId?: string;
  since?: string;
  fullResync?: boolean;
  clear?: boolean;
  maxWorkers?: number;
}

/**
 * Triggers one serialized RAG workflow for message bodies and attachments.
 * Incremental by default (picks up new/updated content from stored cursors).
 */
export async function triggerRagIngest(
  options: TriggerRagIngestOptions = {},
): Promise<{ jobId: number } | null> {
  try {
    const res = await fetch(`${config.ragApi.url}/api/v1/ingest/postgres`, {
      method: 'POST',
      headers: ragHeaders(),
      body: JSON.stringify({
        mailbox_id: options.mailboxId,
        org_id: options.orgId,
        since: options.since,
        full_resync: options.fullResync ?? false,
        clear: options.clear ?? false,
        max_workers: options.maxWorkers,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'RAG /ingest/postgres returned non-OK status');
      return null;
    }
    const data = (await res.json()) as { job_id: number };
    return { jobId: data.job_id };
  } catch (err) {
    logger.warn({ err }, 'RAG /ingest/postgres unreachable');
    return null;
  }
}
