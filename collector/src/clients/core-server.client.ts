import { env } from '../config/env';
import type { JobType } from '../jobs/job-type';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClaimedJob {
  jobId: string;
  orgId: string;
  mailboxId: string;
  jobType: JobType;
  address: string;
  provider: 'm365' | 'google';
  providerUserId: string | null;
  syncToken: string | null;
  syncFromDate: string | null;
  backfilledFromAt: string | null;
}

type JobToken =
  | { provider: 'm365'; tenantId: string; clientId: string; clientSecret: string }
  | { provider: 'google'; serviceAccountJson: string };

interface JobStats {
  fetched?: number;
  accepted?: number;
  skipped?: number;
  errors?: number;
}

interface ProbeResult {
  earliestEmailAt?: string;
  emailCountEstimate?: number;
}

export interface SyncScheduleConfig {
  timezone: string;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: number[];
  businessHoursIntervalMin: number;
  offHoursIntervalMin: number;
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${env.COLLECTOR_SECRET}` };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${env.SERVER_URL}/v1/internal${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...((init?.headers as Record<string, string>) ?? {}),
    },
    // Hard timeout: without it, a black-holed connection (firewall drop,
    // half-started server) would hang this await forever — and the poll loop
    // only schedules its next iteration after the current one resolves.
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let code = 'server_error';
    try {
      code = (JSON.parse(body) as { error?: { code?: string } }).error?.code ?? code;
    } catch {
      /* ignore */
    }
    throw new ApiError(
      res.status,
      code,
      `Server API ${init?.method ?? 'GET'} ${path} -> ${res.status}: ${body}`,
    );
  }

  const json = (await res.json()) as { data: T };
  return json.data;
}

/** Claim up to `limit` pending jobs from the server queue. */
export async function claimJobs(limit: number, instanceId: string): Promise<ClaimedJob[]> {
  const params = new URLSearchParams({ limit: String(limit), instance: instanceId });
  return apiFetch<ClaimedJob[]>(`/jobs/claim?${params}`);
}

/** Fetch decrypted provider credentials for a claimed job. */
export async function getJobToken(jobId: string): Promise<JobToken> {
  return apiFetch<JobToken>(`/jobs/${jobId}/token`);
}

/** Fetch the org's business-hours sync schedule (drives the poll loop's cadence). */
export async function getSyncSchedule(): Promise<SyncScheduleConfig> {
  return apiFetch<SyncScheduleConfig>('/sync-schedule');
}

/** Report job progress or completion back to the server. */
export async function updateJob(
  jobId: string,
  status: 'running' | 'done' | 'failed' | 'dead',
  stats?: JobStats,
  error?: string,
  nextSyncToken?: string,
  probeResult?: ProbeResult,
): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/jobs/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, stats, error, nextSyncToken, probeResult }),
  });
}
