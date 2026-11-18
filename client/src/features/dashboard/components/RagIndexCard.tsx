import { useEffect, useState } from 'react';
import { Badge, CardHead, Icon } from '@/shared/components/ui';
import type { BadgeTone } from '@/shared/components/ui';
import s from '@/styles/features/dashboard/views/views.module.css';
import { getRagIndexStatus, type RagIndexStatus, type RagIngestJob } from '../rag.api';

/**
 * "AI search index" panel.
 *
 * Everything here is deliberately written for an operator who has never heard
 * of embeddings, chunking or a vector database. The API returns the raw facts
 * (chunks, collections, model names); this component is the only place that
 * turns them into plain language, so the wording can change without touching
 * the pipeline.
 *
 *   chunk / Qdrant point  →  "passage"
 *   ingest job            →  "indexing run"
 *   embedding             →  "matched by meaning"
 */

// ── Plain-language mappings ──────────────────────────────────────────────────

const JOB_LABEL: Record<string, string> = {
  pending: 'Queued',
  running: 'Working',
  done:    'Finished',
  error:   'Failed',
};

const JOB_TONE: Record<string, BadgeTone> = {
  pending: 'neutral',
  running: 'accent',
  done:    'ok',
  error:   'danger',
};

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';

  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`;
  const days = Math.floor(secs / 86400);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The one line that answers "is my mail searchable right now?" */
function headlineStatus(d: Extract<RagIndexStatus, { connected: true }>): {
  text: string;
  tone: BadgeTone;
} {
  if (!d.qdrant_ok) {
    return { text: 'Search index unavailable', tone: 'danger' };
  }
  if (d.jobs_active > 0) {
    const runs = d.jobs_active === 1 ? 'run is' : 'runs are';
    return { text: `Indexing now — ${d.jobs_active} ${runs} working through new mail`, tone: 'accent' };
  }
  if (d.indexed_chunks === 0) {
    return { text: 'Nothing indexed yet — no mail is searchable', tone: 'warn' };
  }
  const failed = d.jobs_by_status['error'] ?? 0;
  if (failed > 0 && d.recent_jobs[0]?.status === 'error') {
    return { text: 'The last indexing run failed', tone: 'danger' };
  }
  return { text: `Up to date — last checked ${relativeTime(d.last_synced_at)}`, tone: 'ok' };
}

// ── Small presentational helpers ─────────────────────────────────────────────

function Figure({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div style={{ flex: '1 1 140px', minWidth: 140 }}>
      <div style={{ fontSize: 24, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-3, var(--text-2))', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function JobRow({ job }: { job: RagIngestJob }) {
  const tone  = JOB_TONE[job.status]  ?? 'neutral';
  const label = JOB_LABEL[job.status] ?? job.status;

  // A failed run's reason matters more than its progress text.
  const detail = job.status === 'error'
    ? (job.error_msg || 'No reason recorded')
    : (job.progress || '—');

  return (
    <tr style={{ cursor: 'default' }}>
      <td className={s.t2} style={{ whiteSpace: 'nowrap' }}>{relativeTime(job.created_at)}</td>
      <td><Badge tone={tone} dot>{label}</Badge></td>
      <td
        className={s.t2}
        style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={detail}
      >
        {detail}
      </td>
      <td className={`${s.numCol} ${s.tnum} ${s.t2}`}>{job.points.toLocaleString()}</td>
    </tr>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function RagIndexCard() {
  const [data, setData]       = useState<RagIndexStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getRagIndexStatus();
        if (!cancelled) setData(result);
      } catch {
        // A failed request is indistinguishable from "not configured" as far as
        // this panel is concerned, and both should read the same way.
        if (!cancelled) setData({ connected: false, reason: 'The AI search service is not reachable.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className={s.card}>
        <CardHead title="AI search index" sub="What your team can ask questions about" icon="sparkle" />
        <div className={s.cardBody}>
          <div className={s.emptyState}>Loading…</div>
        </div>
      </div>
    );
  }

  if (!data || !data.connected) {
    return (
      <div className={s.card}>
        <CardHead title="AI search index" sub="What your team can ask questions about" icon="sparkle" />
        <div className={s.cardBody}>
          <div className={s.emptyState}>
            <div className={s.emptyIcon}><Icon name="sparkle" size={20} /></div>
            AI search is not switched on for this installation.
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, maxWidth: 420 }}>
              Mail is still collected and searchable by keyword. Asking questions in plain
              English needs the AI search service running.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const head = headlineStatus(data);

  return (
    <div className={s.card}>
      <CardHead title="AI search index" sub="What your team can ask questions about" icon="sparkle" />

      <div className={s.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* The answer to "is it working?", before any numbers. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Badge tone={head.tone} dot>{head.text}</Badge>
          {data.jobs_active > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              up to {data.max_workers} emails at a time
            </span>
          )}
        </div>

        {!data.qdrant_ok && data.qdrant_error && (
          <div style={{ fontSize: 12, color: 'var(--danger)' }}>{data.qdrant_error}</div>
        )}

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Figure
            value={data.indexed_chunks.toLocaleString()}
            label="Searchable content"
            hint="email sections available to the AI"
          />
          <Figure
            value={data.attachment_chunks.toLocaleString()}
            label="From attachments"
            hint="PDFs, documents and the like"
          />
          <Figure
            value={(data.jobs_by_status['done'] ?? 0).toLocaleString()}
            label="Completed runs"
            hint={`${data.jobs_by_status['error'] ?? 0} failed`}
          />
        </div>

        {/* Written for someone who will never read the pipeline code. */}
        <div style={{
          fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6,
          borderTop: '1px solid var(--border)', paddingTop: 12,
        }}>
          <strong style={{ color: 'var(--text)' }}>How this works.</strong>{' '}
          Each email and attachment is organized into searchable sections. AI search compares
          the meaning of a question with the meaning of that content, so it can find relevant
          information even when the wording is different.
        </div>
      </div>

      {data.recent_jobs.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.tbl}>
            <thead>
              <tr>
                <th>Started</th>
                <th>Result</th>
                <th>Detail</th>
                <th className={s.numCol}>Content added</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_jobs.map((job) => <JobRow key={job.job_id} job={job} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
