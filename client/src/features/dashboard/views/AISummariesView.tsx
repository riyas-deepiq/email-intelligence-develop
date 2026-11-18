import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CardHead, Icon } from '@/shared/components/ui';
import { getThreadSummary, listThreads, type ThreadRow } from '@/features/messages/messages.api';
import { useToast } from '@/shared/toast/useToast';
import s from '@/styles/features/dashboard/views/views.module.css';

function fmtDate(iso: string | null) {
  if (!iso) return 'No date';
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function threadTitle(thread: ThreadRow | null | undefined) {
  return thread?.subject?.trim() || '(no subject)';
}

function participantLabel(thread: ThreadRow | null | undefined) {
  const count = thread?.participantEmails.length ?? 0;
  if (count === 0) return 'No participants';
  return `${count} participant${count === 1 ? '' : 's'}`;
}

export function AISummariesView() {
  const toast = useToast();
  const lastErrorToastRef = useRef(0);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const threadsQ = useQuery({
    queryKey: ['ai-summary-threads'],
    queryFn:  () => listThreads({ page: 1, limit: 20 }),
    staleTime: 30_000,
    retry: false,
  });

  const threads = useMemo(() => threadsQ.data?.threads ?? [], [threadsQ.data?.threads]);

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0]!.id);
    }
  }, [selectedThreadId, threads]);

  const selectedThread = useMemo(
    () => threads.find(thread => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads],
  );

  const summaryQ = useQuery({
    queryKey: ['ai-summary-center', selectedThreadId],
    queryFn:  () => getThreadSummary(selectedThreadId!),
    enabled:  Boolean(selectedThreadId),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (summaryQ.isError && summaryQ.errorUpdatedAt !== lastErrorToastRef.current) {
      lastErrorToastRef.current = summaryQ.errorUpdatedAt;
      toast.error('AI summary service is unavailable. Check that the AI interface is running.');
    }
  }, [summaryQ.errorUpdatedAt, summaryQ.isError, toast]);

  const summary = summaryQ.data?.summary ?? null;
  const statusText = summary
    ? `${summaryQ.data?.cached ? 'Cached' : 'Generated'} - ${summaryQ.data?.model ?? 'AI model'}`
    : summaryQ.isFetching ? 'Generating...' : 'Ready';

  return (
    <div className={s.page}>
      <div className={s.summaryCenterGrid}>
        <div className={s.card}>
          <CardHead
            title="AI summary center"
            sub="Generate grounded summaries from indexed email threads"
            icon="sparkle"
          />
          <div className={s.cardBody}>
            {threadsQ.isLoading ? (
              <div className={s.emptyState}>Loading indexed threads...</div>
            ) : threadsQ.isError ? (
              <div className={s.emptyState}>
                <div className={s.emptyIcon}><Icon name="alert" size={22} /></div>
                <p className={s.emptyTitle}>Could not load threads</p>
              </div>
            ) : threads.length === 0 ? (
              <div className={s.emptyState}>
                <div className={s.emptyIcon}><Icon name="sparkle" size={22} /></div>
                <p className={s.emptyTitle}>No indexed threads found</p>
                <p className={s.emptyText}>AI summaries will appear once email threads are indexed.</p>
              </div>
            ) : (
              <>
                <div className={s.threadHeader}>
                  <div className={s.threadIcon}><Icon name="sparkle" size={17} /></div>
                  <div className={s.threadMeta}>
                    <div className={s.threadName}>{threadTitle(selectedThread)}</div>
                    <div className={s.muted} style={{ marginTop: 3 }}>
                      {[selectedThread?.mailboxAddress, participantLabel(selectedThread), fmtDate(selectedThread?.lastMessageAt ?? null)]
                        .filter(Boolean)
                        .join(' - ')}
                    </div>
                  </div>
                  <button
                    className={`${s.btn} ${s.btnPrimary}`}
                    type="button"
                    onClick={() => summaryQ.refetch()}
                    disabled={!selectedThreadId || summaryQ.isFetching}
                  >
                    <Icon name="sparkle" size={13} />
                    {summaryQ.isFetching ? 'Generating' : summary ? 'Regenerate' : 'Generate'}
                  </button>
                </div>

                <div className={s.aiSummary}>
                  <div className={s.aiSummaryHead}>
                    <Icon name="sparkle" size={12} /> Thread summary
                    <span className={s.summaryStatus}>{statusText}</span>
                  </div>

                  {summaryQ.isFetching ? (
                    <p className={s.aiSummaryBody} style={{ opacity: 0.75 }}>
                      Generating AI summary from {selectedThread?.messageCount ?? 0} message{selectedThread?.messageCount === 1 ? '' : 's'}...
                    </p>
                  ) : summaryQ.isError ? (
                    <div className={s.summaryError}>
                      <Icon name="alert" size={16} />
                      <span>AI summary service is unavailable.</span>
                    </div>
                  ) : summary ? (
                    <p className={s.aiSummaryBody}>{summary}</p>
                  ) : (
                    <p className={s.aiSummaryBody}>No summary was returned for this thread.</p>
                  )}
                </div>

                {selectedThread && (
                  <div className={s.entityRow} style={{ marginTop: 12 }}>
                    <span className={s.factChip}><strong>Messages</strong> {selectedThread.messageCount}</span>
                    <span className={s.factChip}><strong>Participants</strong> {selectedThread.participantEmails.length}</span>
                    {selectedThread.attachmentCount > 0 && (
                      <span className={s.factChip}><strong>Attachments</strong> {selectedThread.attachmentCount}</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className={s.card}>
          <CardHead title="Recent threads" sub={`${threads.length} available`} icon="mail" />
          <div className={s.summaryThreadList}>
            {threads.map(thread => (
              <button
                key={thread.id}
                className={`${s.summaryItem} ${thread.id === selectedThreadId ? s.summaryItemActive : ''}`}
                type="button"
                onClick={() => setSelectedThreadId(thread.id)}
              >
                <span className={s.summarySubject}>{threadTitle(thread)}</span>
                <span className={s.summaryMetaLine}>
                  {thread.messageCount} message{thread.messageCount === 1 ? '' : 's'} - {fmtDate(thread.lastMessageAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
