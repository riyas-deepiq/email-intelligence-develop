import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, CardHead, Icon } from '@/shared/components/ui';
import s from '@/styles/features/dashboard/views/views.module.css';
import { RagIndexCard } from '../components/RagIndexCard';
import {
  getRagPipelineStages,
  subscribeRagPipelineStages,
  type RagLogLine,
  type RagPipelineStages,
  type RagStageProgress,
} from '../rag.api';

/**
 * AI search processing monitor — superadmin only.
 *
 * Laid out as a build log: the five ingestion stages tick off one by one with
 * their elapsed time, and a timestamped log of what actually happened sits
 * underneath.
 *
 * The stages do NOT run once each — they run once per email, in a loop, and
 * attachments re-enter `extract` after the body has already been stored. The
 * server-side tracker (RAG/ingestion/progress.py) is therefore monotonic: a
 * stage is marked done when a *later* stage starts, and its count keeps
 * climbing afterwards. Reproducing that rule here would be a second source of
 * truth, so this component renders whatever state it is handed.
 *
 * The same loop is why the per-stage durations do NOT add up to the run total,
 * and the footnote below says so rather than implying a breakdown.
 */

const MAIL_STAGE_HINT: Record<string, string> = {
  read:    'Loads new emails ready for processing',
  extract: 'Reads the content of each email',
  chunk:   'Organizes email content into searchable sections',
  embed:   'Prepares content for meaning-based AI search',
  store:   'Adds the prepared content to AI search',
};

const ATTACHMENT_STAGE_HINT: Record<string, string> = {
  read:    'Loads new image and document attachments',
  extract: 'Reads text from images and documents',
  chunk:   'Organizes extracted text into searchable sections',
  embed:   'Prepares extracted content for meaning-based AI search',
  store:   'Adds the prepared attachments to AI search',
};

const COMBINED_STAGE_HINT: Record<string, string> = {
  read:    'Loads new emails and attachments',
  extract: 'Reads email, image and document content',
  chunk:   'Organizes content into searchable sections',
  embed:   'Prepares content for meaning-based AI search',
  store:   'Adds the prepared content to AI search',
};

const CUSTOMER_STAGE_LABEL: Record<string, string> = {
  read:    'Reading emails and files',
  extract: 'Extracting document text',
  chunk:   'Preparing searchable content',
  embed:   'Building the AI search index',
  store:   'Saving to AI search',
};

const CUSTOMER_STAGE_UNIT: Record<string, string> = {
  read:    'items',
  extract: 'files',
  chunk:   'content sections',
  embed:   'search entries',
  store:   'indexed entries',
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

function formatClock(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// ── Step marker ──────────────────────────────────────────────────────────────

function StepMarker({ state }: { state: string }) {
  if (state === 'done') {
    return <Icon name="check" size={15} />;
  }
  if (state === 'running') {
    return (
      <svg
        width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"
        style={prefersReducedMotion() ? undefined : { animation: 'spin .9s linear infinite' }}
      >
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" opacity=".25" />
        <path d="M8 1.5 A 6.5 6.5 0 0 1 14.5 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return <span style={{ width: 15, height: 15, display: 'inline-block' }} />;
}

function StepRow({ stage, hints }: { stage: RagStageProgress; hints: Record<string, string> }) {
  const state   = String(stage.state);
  const done    = state === 'done';
  const running = state === 'running';

  const color = done ? 'var(--ok)' : running ? 'var(--accent)' : 'var(--text-3)';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '15px 4px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span style={{ color, display: 'grid', placeItems: 'center', width: 16, flexShrink: 0 }}>
        <StepMarker state={state} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14,
          fontWeight: running ? 600 : 500,
          fontStyle: !done && !running ? 'italic' : 'normal',
          color: done || running ? 'var(--text)' : 'var(--text-3)',
        }}>
          {CUSTOMER_STAGE_LABEL[stage.key] ?? stage.label}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
          {stage.count > 0
            ? `${stage.count.toLocaleString()} ${CUSTOMER_STAGE_UNIT[stage.key] ?? stage.unit}`
            : (hints[stage.key] ?? '')}
        </div>
      </div>

      <div style={{
        fontSize: 13, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums',
        flexShrink: 0, minWidth: 56, textAlign: 'right',
      }}>
        {formatDuration(stage.elapsed_ms)}
      </div>
    </div>
  );
}

// ── Log panel ────────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<string, string> = {
  error: 'var(--danger)',
  warn:  'var(--warn)',
  info:  'var(--text-2)',
};

function LogPanel({ lines, live }: { lines: RagLogLine[]; live: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinned  = useRef(true);
  const [copied, setCopied] = useState(false);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    if (pinned.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines]);

  const asText = useCallback(
    () => lines.map((l) => `${formatClock(l.ts)}  ${l.message}`).join('\n'),
    [lines],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const download = () => {
    const blob = new Blob([asText()], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `index-run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface-2)',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {live ? 'Streaming output…' : `${lines.length} line${lines.length === 1 ? '' : 's'}`}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={download} className={s.chip} style={{ cursor: 'pointer' }}>
            <Icon name="download" size={13} /> Download log
          </button>
          <button type="button" onClick={copy} className={s.chip} style={{ cursor: 'pointer' }}>
            <Icon name={copied ? 'check' : 'file'} size={13} /> {copied ? 'Copied' : 'Copy log'}
          </button>
        </div>
      </div>

      <div
        ref={bodyRef}
        onScroll={onScroll}
        style={{
          maxHeight: 320, overflowY: 'auto', padding: '12px 14px',
          fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
          fontSize: 12, lineHeight: 1.75,
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: 'var(--text-3)' }}>No output yet.</div>
        ) : lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 14 }}>
            <span style={{ color: 'var(--text-3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {formatClock(l.ts)}
            </span>
            <span style={{ color: LEVEL_COLOR[l.level] ?? 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
              {l.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────

export function RagPipelineView() {
  const [data, setData]    = useState<RagPipelineStages | null>(null);
  const [error, setError]  = useState<string | null>(null);
  const [loading, setLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [streamState, setStreamState] = useState<'off' | 'connecting' | 'live' | 'reconnecting'>('off');

  const fetchStages = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const next = await getRagPipelineStages();
      setData(next);
      setError(null);
      return next;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not read pipeline state');
    } finally {
      setLoad(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchStages();
  }, [fetchStages]);

  useEffect(() => {
    if (!data?.connected) {
      setStreamState('off');
      return undefined;
    }

    setStreamState('connecting');
    return subscribeRagPipelineStages(
      (next) => {
        setData(next);
        setError(null);
        setLoad(false);
        setStreamState('live');
      },
      () => {
        // Keep the last valid snapshot visible while the shared stream retries.
        // Refresh remains an explicit fallback for the operator.
        setStreamState('reconnecting');
      },
    );
  }, [data?.connected]);

  const stages    = data?.stages ?? [];
  const log       = data?.log ?? [];
  const isRunning = !!data?.connected && data.jobsActive > 0;
  const settled   = stages.length > 0 && stages.every((x) => x.state !== 'running');
  const counted   = stages.some((x) => x.count > 0);
  const failed    = log.some((l) => l.level === 'error');
  const isCombinedRun = data?.activeJobKind === 'combined';
  const isAttachmentRun = data?.activeJobKind === 'attachments';
  const includesAttachments = isCombinedRun || isAttachmentRun;
  const ocrAvailable = data?.ocrAvailable ?? false;
  const stageHints = isCombinedRun
    ? COMBINED_STAGE_HINT
    : isAttachmentRun ? ATTACHMENT_STAGE_HINT : MAIL_STAGE_HINT;

  const heading = isRunning
    ? isCombinedRun ? 'Processing new mail & attachments'
    : isAttachmentRun ? 'Processing images & attachments' : 'Building the mail search index'
    : failed   ? 'Last run failed'
    : counted  ? includesAttachments ? 'Mail & attachments processed' : 'Mail search index built'
    : 'Search index';

  return (
    <div className={s.page}>

      <div className={s.pageHead}>
        <div>
          <div className={s.pageHeadTitle}>AI Search Processing</div>
          <div className={s.pageHeadSub}>
            See how your emails and attachments are prepared for fast, accurate AI search.
          </div>
        </div>
        <div className={s.pageHeadRight} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {data?.connected && (
            <Badge tone={streamState === 'live' ? 'ok' : 'warn'} dot>
              {streamState === 'live' ? 'Live updates' : streamState === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
            </Badge>
          )}
          {isRunning ? (
            <Badge tone="accent" dot>
              {isCombinedRun ? 'Mail & file' : isAttachmentRun ? 'Image & file' : 'Mail'} run #{data?.activeJobId} · {formatDuration(data?.elapsedMs ?? null)}
            </Badge>
          ) : failed ? (
            <Badge tone="danger" dot>Failed</Badge>
          ) : (
            <Badge tone="neutral" dot>Idle</Badge>
          )}

          <Button size="sm" variant="secondary" disabled={refreshing} onClick={() => fetchStages(true)}>
            <Icon name={refreshing ? 'loader' : 'activity'} size={14} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && (
        <div className={s.card} style={{ marginBottom: 16, borderColor: 'var(--danger)' }}>
          <div className={s.cardBody} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--danger)' }}>
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className={s.card} style={{ marginBottom: 16 }}>
        <CardHead
          title={heading}
          sub={isRunning
            ? includesAttachments
              ? 'Preparing email and file content for AI search — streaming live'
              : 'Preparing email content for AI search — streaming live'
            : 'Most recent run'}
          icon={includesAttachments ? 'clip' : 'activity'}
        />

        <div className={s.cardBody}>
          {loading && !data ? (
            <div className={s.emptyState}>Loading…</div>
          ) : !data?.connected ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}><Icon name="sparkle" size={20} /></div>
              The AI search service is not running.
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, maxWidth: 460 }}>
                Mail is still collected and searchable by keyword. This page becomes live once the
                service is started and an indexing run begins.
              </div>
            </div>
          ) : stages.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}><Icon name="clock" size={20} /></div>
              No indexing run has been started yet.
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, maxWidth: 460 }}>
                Stage detail is held in memory by the AI service. It auto-populates as soon as the
                collector finishes syncing new mail — the totals below are unaffected.
              </div>
            </div>
          ) : (
            <>
              {includesAttachments && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '11px 13px', marginBottom: 8,
                  border: `1px solid color-mix(in srgb, var(${ocrAvailable ? '--accent' : '--warn'}) 30%, var(--border))`,
                  borderRadius: 8,
                  background: `color-mix(in srgb, var(${ocrAvailable ? '--accent' : '--warn'}) 7%, var(--surface))`,
                  color: 'var(--text-2)', fontSize: 12, lineHeight: 1.55,
                }}>
                  <span style={{ color: ocrAvailable ? 'var(--accent)' : 'var(--warn)', marginTop: 1 }}>
                    <Icon name={ocrAvailable ? 'sparkle' : 'alert'} size={15} />
                  </span>
                  <span>
                    <b style={{ color: 'var(--text)' }}>
                      {ocrAvailable ? 'Image OCR is ready.' : 'Image OCR is unavailable on this service.'}
                    </b>{' '}
                    {ocrAvailable
                      ? 'PNG, JPG, JPEG, TIFF, BMP, GIF and WebP files pass through OCR before their text is extracted, prepared and added to AI search.'
                      : 'Install Tesseract with pytesseract and Pillow, or run the supplied RAG container. Documents still use their normal text extractors.'}
                  </span>
                </div>
              )}
              <div style={{ marginBottom: 18 }}>
                {stages.map((stage) => <StepRow key={stage.key} stage={stage} hints={stageHints} />)}
              </div>

              <LogPanel lines={log} live={isRunning} />

              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '12px 0 0', lineHeight: 1.6 }}>
                Times are wall-clock from when a stage first ran to when it completed. Stages run
                once per {isCombinedRun ? 'mail or file' : isAttachmentRun ? 'file' : 'email'} in a loop and overlap each other, so they do <b>not</b> add up to the
                run total.
              </p>

              {settled && counted && !failed && (
                <div style={{
                  marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ok)', fontSize: 14,
                }}>
                  <Icon name="check" size={15} />
                  <span>Run finished — every stage completed.</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Totals, recent runs and configuration — shared with the monitoring page
          rather than reimplemented, so the two can never disagree. */}
      <RagIndexCard />

      <div className={s.card} style={{ marginTop: 16 }}>
        <CardHead title="Reading this page" sub="What the stages mean" icon="book" />
        <div className={s.cardBody} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
          <p style={{ margin: 0 }}>
            A stage is ticked once it has produced something and the next stage has started. Its
            count keeps rising afterwards, because every item passes through all five stages.
          </p>
          <p style={{ margin: '10px 0 0' }}>
            During an image and attachment run, the output log shows each filename entering OCR or
            document extraction. A file with no readable text is shown as a warning instead of
            silently disappearing from the process.
          </p>
        </div>
      </div>
    </div>
  );
}
