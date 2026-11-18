import { apiClient, BASE_URL, getToken } from '@/shared/api/client';

/**
 * Search-index status, from the RAG service via the Core Server.
 *
 * The wire format is snake_case because it originates in RAG's Python API and
 * the Core Server passes it through unchanged — see
 * server/src/modules/chat/clients/rag.client.ts.
 */

export interface RagIngestJob {
  job_id:     number;
  status:     'pending' | 'running' | 'done' | 'error' | string;
  progress:   string;
  points:     number;
  error_msg:  string;
  created_at: string | null;
  updated_at: string | null;
}

/** RAG is optional, so "not connected" is a normal state, not an error. */
export interface RagIndexDisconnected {
  connected: false;
  reason:    string;
}

export interface RagIndexConnected {
  connected: true;
  jobs_active:       number;
  jobs_by_status:    Record<string, number>;
  recent_jobs:       RagIngestJob[];
  indexed_chunks:    number;
  body_chunks:       number;
  attachment_chunks: number;
  collections:       Record<string, unknown>;
  last_synced_at:    string | null;
  embed_model:       string;
  chunk_size:        number;
  chunk_overlap:     number;
  max_workers:       number;
  qdrant_ok:         boolean;
  qdrant_error:      string;
}

export type RagIndexStatus = RagIndexConnected | RagIndexDisconnected;

export async function getRagIndexStatus(): Promise<RagIndexStatus> {
  const res = await apiClient.get<{ data: RagIndexStatus }>('/dashboard/rag-index');
  return res.data.data;
}

/* ── Live pipeline stages (super admin only) ───────────────────────────────── */

export type StageKey   = 'read' | 'extract' | 'chunk' | 'embed' | 'store';
export type StageState = 'pending' | 'running' | 'done';

export interface RagStageProgress {
  key:   StageKey | string;
  label: string;
  unit:  string;
  state: StageState | string;
  count: number;
  /** Unix seconds. Stages loop and overlap — these do NOT sum to the run total. */
  started_at: number | null;
  ended_at:   number | null;
  elapsed_ms: number | null;
}

export interface RagLogLine {
  ts:      number;                       // unix seconds
  level:   'info' | 'warn' | 'error' | string;
  message: string;
}

export interface RagPipelineStages {
  connected:   boolean;
  activeJobId: number | null;
  activeJobKind: 'combined' | 'mail' | 'attachments' | null;
  jobsActive:  number;
  stages:      RagStageProgress[];
  log:         RagLogLine[];
  elapsedMs:   number | null;
  ocrAvailable: boolean;
}

/**
 * Live stage state for the indexing run in flight. Server-side this is
 * superadmin-only; a non-superadmin gets 403, which the caller treats the same
 * as "nothing to show".
 */
export async function getRagPipelineStages(): Promise<RagPipelineStages> {
  const res = await apiClient.get<{ data: RagPipelineStages }>('/dashboard/rag-index/stages');
  return res.data.data;
}

type PipelineListener = (stages: RagPipelineStages) => void;
type PipelineErrorListener = (error: Error) => void;

interface PipelineSubscriber {
  onData: PipelineListener;
  onError?: PipelineErrorListener;
}

const pipelineSubscribers = new Set<PipelineSubscriber>();
let pipelineController: AbortController | null = null;
let pipelineReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pipelineReconnectDelay = 1_000;
let latestPipelineStages: RagPipelineStages | null = null;

function publishPipelineStages(stages: RagPipelineStages): void {
  latestPipelineStages = stages;
  pipelineReconnectDelay = 1_000;
  pipelineSubscribers.forEach((subscriber) => subscriber.onData(stages));
}

function publishPipelineError(error: Error): void {
  pipelineSubscribers.forEach((subscriber) => subscriber.onError?.(error));
}

function parsePipelineEvent(block: string): void {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return;
  publishPipelineStages(JSON.parse(data) as RagPipelineStages);
}

async function consumePipelineStream(signal: AbortSignal): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Live vector updates require an active session.');

  const response = await fetch(`${BASE_URL}/dashboard/rag-index/stages/stream`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Live vector updates unavailable (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      blocks.forEach(parsePipelineEvent);
    }
  } finally {
    reader.releaseLock();
  }
}

function schedulePipelineReconnect(): void {
  if (pipelineSubscribers.size === 0 || pipelineReconnectTimer !== null) return;
  pipelineReconnectTimer = setTimeout(() => {
    pipelineReconnectTimer = null;
    startPipelineStream();
  }, pipelineReconnectDelay);
  pipelineReconnectDelay = Math.min(pipelineReconnectDelay * 2, 30_000);
}

function startPipelineStream(): void {
  if (pipelineSubscribers.size === 0 || pipelineController !== null) return;
  const controller = new AbortController();
  pipelineController = controller;

  void consumePipelineStream(controller.signal)
    .catch((error: unknown) => {
      if (!controller.signal.aborted) {
        publishPipelineError(error instanceof Error ? error : new Error('Live vector updates disconnected.'));
      }
    })
    .finally(() => {
      if (pipelineController === controller) pipelineController = null;
      if (!controller.signal.aborted) schedulePipelineReconnect();
    });
}

/**
 * Subscribe to one shared SSE connection. Unlike the old timers, this performs
 * no periodic GET requests: renders happen only when RAG emits a state change.
 */
export function subscribeRagPipelineStages(
  onData: PipelineListener,
  onError?: PipelineErrorListener,
): () => void {
  const subscriber = { onData, onError };
  pipelineSubscribers.add(subscriber);
  if (latestPipelineStages) onData(latestPipelineStages);
  startPipelineStream();

  return () => {
    pipelineSubscribers.delete(subscriber);
    if (pipelineSubscribers.size > 0) return;
    if (pipelineReconnectTimer !== null) {
      clearTimeout(pipelineReconnectTimer);
      pipelineReconnectTimer = null;
    }
    pipelineController?.abort();
    pipelineController = null;
    latestPipelineStages = null;
  };
}
