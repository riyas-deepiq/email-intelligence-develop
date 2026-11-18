import { useMemo, useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { Avatar, Badge, Icon, UserCell, ColumnFilterMenu, TableToolbar } from '@/shared/components/ui';
import { MailboxAvatar } from '@/features/mailboxes/MailboxAvatar';
import {
  downloadMessageAttachment, getThread, getThreadSummary,
  listThreadAttachments, listThreadGroups, listThreads,
} from '@/features/messages/messages.api';
import type { ThreadAttachment, ThreadGroup, ThreadMessage } from '@/features/messages/messages.api';
import { useColumnPrefs, type ColumnMeta } from '@/shared/hooks/useColumnPrefs';
import { useSearchBarVisibility } from '@/shared/hooks/useSearchBarVisibility';
import { matchesSearchTerm, normalizeSearchTerm } from '@/shared/utils/search';
import { DateRangeFilter } from './DateRangeFilter';
import type { DateRange } from './DateRangeFilter';
import { TablePagination } from './TablePagination';
import { hasPermission } from '../access';
import s from '@/styles/features/dashboard/views/views.module.css';
import { useResetOnHide } from '@/features/dashboard/viewActive';

const IMPORTANCE_TONES: Record<string, 'danger' | 'warn' | 'neutral' | 'ok'> = {
  high:   'danger',
  normal: 'neutral',
  low:    'ok',
};

// ─── Table columns (show/hide + reorder via the Filter menu) ─────────────────
// Everyone gets the same per-user mailbox-group view — the server scopes which
// mailboxes come back (all of them for admins, the caller's own plus any
// org-hierarchy reports' for employees).

const ADMIN_THREAD_COLUMNS: ColumnMeta[] = [
  { id: 'user',        label: 'User / Thread' },
  { id: 'threads',     label: 'Threads' },
  { id: 'messages',    label: 'Messages' },
  { id: 'unread',      label: 'Unread' },
  { id: 'attachments', label: 'Attachments' },
  { id: 'latest',      label: 'Latest' },
];

const MAILBOX_THREADS_PAGE_COLUMNS: ColumnMeta[] = [
  { id: 'thread',      label: 'Thread', pinned: true },
  { id: 'messages',    label: 'Messages' },
  { id: 'attachments', label: 'Attachments' },
  { id: 'date',        label: 'Date' },
];

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** "maria.gomez@acme.com" → "Maria Gomez" (display fallback when no name is stored). */
function nameFromEmail(email: string | null | undefined) {
  if (!email) return '—';
  return email
    .split('@')[0]
    .split(/[._-]/)
    .filter(Boolean)
    .map(p => (p[0]?.toUpperCase() ?? '') + p.slice(1))
    .join(' ');
}

// ── Grouped mailbox row (admin: threads grouped user by user) ─────────────────
// Clicking the row drops down the 5 most recent threads inline; "More" opens
// the full per-mailbox threads page (MailboxThreadsPage below).

const PREVIEW_COUNT = 5;

function renderThreadGroupCell(colId: string, group: ThreadGroup, open: boolean) {
  switch (colId) {
    case 'user':
      return (
        <td key={colId} style={{ maxWidth: 380 }}>
          <div className={s.cellName}>
            <span className={s.chevron} style={{ transform: open ? 'rotate(90deg)' : 'none' }}>›</span>
            <MailboxAvatar mailboxId={group.mailboxId} name={group.mailboxDisplayName ?? group.mailboxAddress} size={28} />
            <div>
              <div className={s.subj}>{group.mailboxDisplayName ?? nameFromEmail(group.mailboxAddress)}</div>
              <div className={s.muted} style={{ fontSize: 12 }}>{group.mailboxAddress}</div>
            </div>
          </div>
        </td>
      );
    case 'threads':
      return (
        <td key={colId} className={s.tnum}>
          {group.threadCount} thread{group.threadCount !== 1 ? 's' : ''}
        </td>
      );
    case 'messages':
      return <td key={colId} className={s.tnum}>{group.messageCount}</td>;
    case 'unread':
      return (
        <td key={colId} className={s.tnum}>
          {group.unreadCount > 0
            ? <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{group.unreadCount}</span>
            : <span className={s.muted}>0</span>}
        </td>
      );
    case 'attachments':
      return (
        <td key={colId}>
          {group.attachmentCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-3)', fontSize: 12 }}>
              <Icon name="clip" size={12} /> {group.attachmentCount}
            </span>
          )}
        </td>
      );
    case 'latest':
      return <td key={colId} className={s.muted}>{fmtDate(group.latestMessageAt)}</td>;
    default:
      return null;
  }
}

function MailboxGroupRow({ group, columns, onOpenThread, onMore }: {
  group: ThreadGroup;
  columns: ColumnMeta[];
  onOpenThread: (id: string) => void;
  onMore: (g: ThreadGroup) => void;
}) {
  const [open, setOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['threads', { mailboxId: group.mailboxId, preview: true }],
    queryFn:  () => listThreads({ mailboxId: group.mailboxId, limit: PREVIEW_COUNT, page: 1 }),
    enabled:  open,
    staleTime: 30_000,
  });

  const threads = data?.threads ?? [];

  return (
    <>
      <tr className={s.groupRow} onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>
        {columns.map((col) => renderThreadGroupCell(col.id, group, open))}
      </tr>

      {open && (
        <tr className={s.subRow} onClick={e => e.stopPropagation()} style={{ cursor: 'default' }}>
          <td colSpan={columns.length} style={{ padding: '6px 16px 14px 40px' }}>
            {isLoading ? (
              <div className={s.muted} style={{ fontSize: 12.5 }}>Loading recent threads…</div>
            ) : isError ? (
              <div className={s.muted} style={{ fontSize: 12.5 }}>Failed to load threads.</div>
            ) : threads.length === 0 ? (
              <div className={s.muted} style={{ fontSize: 12.5 }}>No threads yet.</div>
            ) : (
              <>
                {threads.map(t => (
                  <div
                    key={t.id}
                    onClick={() => onOpenThread(t.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', cursor: 'pointer', borderBottom: '1px solid var(--bdr-2)' }}
                  >
                    <span className={s.threadIcon} style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0 }}>
                      <Icon name="book" size={13} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={s.subj} style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.subject ?? '(no subject)'}
                      </div>
                      <div className={s.muted} style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.participantEmails.slice(0, 3).join(', ')}
                        {t.participantEmails.length > 3 && ` +${t.participantEmails.length - 3} more`}
                      </div>
                    </div>
                    <span className={s.muted} style={{ fontSize: 11.5, flexShrink: 0 }}>{t.messageCount} msg</span>
                    <span className={s.muted} style={{ fontSize: 11.5, flexShrink: 0 }}>{fmtDate(t.lastMessageAt)}</span>
                  </div>
                ))}
                <button className={s.btn} style={{ marginTop: 10 }} onClick={() => onMore(group)}>
                  More
                </button>
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Per-mailbox threads page (full page — search, date range, pagination) ─────

const BROWSE_PAGE_SIZES = [25, 50, 100] as const;

function MailboxThreadsPage({ group, onOpenThread, onBack }: {
  group: ThreadGroup;
  onOpenThread: (id: string) => void;
  onBack: () => void;
}) {
  const [page, setPage]       = useState(1);
  const [limit, setLimit]     = useState<number>(BROWSE_PAGE_SIZES[0]);
  const [range, setRange]     = useState<DateRange>({ from: '', to: '' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch]   = useState('');
  useResetOnHide(() => { setSearchInput(''); setSearch(''); setPage(1); });

  const colPrefs = useColumnPrefs('mailbox-threads-page', MAILBOX_THREADS_PAGE_COLUMNS);
  const visibleIds = new Set(colPrefs.visible.map(c => c.id));
  const [searchVisible, setSearchVisible] = useSearchBarVisibility('mailbox-threads-page');
  const [paginationVisible, setPaginationVisible] = useSearchBarVisibility('mailbox-threads-page-pagination');

  function toggleSearchVisible(next: boolean) {
    setSearchVisible(next);
    if (!next) { setSearchInput(''); setSearch(''); }
  }

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset to the first page whenever a filter changes.
  useEffect(() => { setPage(1); }, [range.from, range.to, search, limit]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['threads', { mailboxId: group.mailboxId, page, search, from: range.from, to: range.to, limit }],
    queryFn:  () => listThreads({
      mailboxId: group.mailboxId,
      search:    search || undefined,
      from:      range.from || undefined,
      to:        range.to   || undefined,
      limit,
      page,
    }),
    staleTime: 30_000,
  });

  const threads    = data?.threads ?? [];
  const total      = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const start      = total === 0 ? 0 : (page - 1) * limit + 1;
  const end        = Math.min(page * limit, total);

  return (
    <>
      <div className={s.pageHead}>
        <button className={s.btn} onClick={onBack}>‹ Back to threads</button>
      </div>

      <div className={s.card}>

        {/* Header */}
        <div className={s.modalHead}>
          <MailboxAvatar mailboxId={group.mailboxId} name={group.mailboxDisplayName ?? group.mailboxAddress} size={40} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={s.subj} style={{ fontSize: 15 }}>
              {group.mailboxDisplayName ?? nameFromEmail(group.mailboxAddress)}
            </div>
            <div className={s.muted} style={{ fontSize: 12.5 }}>{group.mailboxAddress}</div>
            <div className={s.statChips}>
              <span className={s.statChip}><strong>{(group.threadCount ?? 0).toLocaleString()}</strong>threads</span>
              <span className={s.statChip}><strong>{(group.messageCount ?? 0).toLocaleString()}</strong>messages</span>
              <span className={s.statChip}><strong>{(group.unreadCount ?? 0).toLocaleString()}</strong>unread</span>
              <span className={s.statChip}><strong>{(group.attachmentCount ?? 0).toLocaleString()}</strong>attachments</span>
            </div>
          </div>
        </div>

        {/* Search + date range filter (one modern row) */}
        <div className={s.modalFilter}>
          {searchVisible && (
            <div className={s.modalSearch}>
              <Icon name="search" size={14} />
              <input
                className={s.modalSearchInput}
                placeholder="Search threads by subject or participant…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
              />
              {searchInput && (
                <button type="button" className={s.searchClear} onClick={() => setSearchInput('')} aria-label="Clear search">
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          )}
          <DateRangeFilter range={range} onChange={setRange} />
          <span className={s.muted} style={{ fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            {total > 0 ? `${start}–${end} of ${total.toLocaleString()} thread${total !== 1 ? 's' : ''}` : (search ? 'No matches' : '')}
          </span>
          <ColumnFilterMenu
            prefs={colPrefs}
            searchToggle={{ visible: searchVisible, onToggleVisible: toggleSearchVisible }}
            paginationToggle={{ visible: paginationVisible, onToggleVisible: setPaginationVisible }}
          />
        </div>

        {/* Body: thread list */}
        <div className={s.modalBody}>
          {isLoading ? (
            <div className={s.emptyState}>Loading threads…</div>
          ) : isError ? (
            <div className={s.emptyState}><Icon name="alert" size={20} /> Failed to load threads.</div>
          ) : threads.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}><Icon name="book" size={20} /></div>
              {search
                ? `No threads match "${search}".`
                : `No threads ${range.from || range.to ? 'in the selected date range.' : 'yet.'}`}
            </div>
          ) : (
            threads.map(t => (
              <button key={t.id} type="button" className={s.modalRow} onClick={() => onOpenThread(t.id)}>
                <span className={s.threadIcon} style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0 }}>
                  <Icon name="book" size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={s.subj} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.subject ?? '(no subject)'}
                  </div>
                  <div className={s.muted} style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.participantEmails.slice(0, 3).join(', ')}
                    {t.participantEmails.length > 3 && ` +${t.participantEmails.length - 3} more`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  {visibleIds.has('messages') && (
                    <span className={s.muted} style={{ fontSize: 12 }}>{t.messageCount} msg</span>
                  )}
                  {visibleIds.has('attachments') && t.hasAttachments && <Icon name="clip" size={12} />}
                  {visibleIds.has('date') && (
                    <span className={s.muted} style={{ fontSize: 12 }}>{fmtDate(t.lastMessageAt)}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

      </div>

      {/* Footer: pagination — rendered outside the card so the page-size dropdown
          isn't clipped by the card's `overflow: hidden` (used for its rounded corners). */}
      {total > 0 && paginationVisible && (
        <TablePagination
          page={page}
          totalPages={totalPages}
          onPrev={() => setPage(p => Math.max(1, p - 1))}
          onNext={() => setPage(p => Math.min(totalPages, p + 1))}
          pageSize={{ value: limit, options: BROWSE_PAGE_SIZES, onChange: setLimit }}
          style={{ border: 'none', padding: '12px 4px' }}
        />
      )}
    </>
  );
}

// ── Thread detail (screenshot-style layout) ───────────────────────────────────

function fmtSize(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function extOf(name: string): string {
  const e = name.includes('.') ? name.split('.').pop()! : '';
  return e && e.length <= 5 ? e.toUpperCase() : 'FILE';
}

/** Every attachment across all messages in the thread, fetched live from the provider. */
/** Attachments for whichever message is selected on the left — hidden entirely when that message has none. */
function ThreadAttachmentsCard({ threadId, message, canReadAttachments }: {
  threadId: string;
  message: ThreadMessage | null;
  canReadAttachments: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);

  const enabled = canReadAttachments && !!message?.hasAttachments;

  const q = useQuery({
    queryKey:  ['thread-attachments', threadId],
    queryFn:   () => listThreadAttachments(threadId),
    enabled,
    staleTime: Infinity,
    retry:     false,
    refetchOnWindowFocus: false,
  });

  if (!enabled) return null;

  const files   = (q.data?.attachments ?? []).filter(a => !a.isInline && a.messageId === message!.id);
  const primary = files[0];
  const rest    = files.slice(1);

  async function act(att: ThreadAttachment, mode: 'download' | 'open') {
    setErr(null);
    setBusy(att.id + mode);
    try {
      const blob = await downloadMessageAttachment(att.messageId, att.id, { auditDownload: mode === 'download' });
      const typed = att.contentType ? new Blob([blob], { type: att.contentType }) : blob;
      const url = URL.createObjectURL(typed);
      if (mode === 'download') {
        const a = document.createElement('a');
        a.href = url;
        a.download = att.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.open(url, '_blank');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setErr('Download failed — the mail provider rejected the request.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={s.card}>
      <div className={s.cardBody}>
        <div className={s.sectionLabel}>
          Attachments{files.length > 0 ? ` · ${files.length}` : ''}
        </div>

        {q.isLoading ? (
          <div className={s.muted} style={{ fontSize: 12.5 }}>Loading attachments…</div>
        ) : q.isError ? (
          <div className={s.muted} style={{ fontSize: 12.5 }}>Couldn't load attachments from the mail provider.</div>
        ) : !primary ? (
          <div className={s.muted} style={{ fontSize: 12.5 }}>No downloadable files in this message.</div>
        ) : (
          <>
            <div className={s.attachPreview}>
              <div className={s.attachDoc}>
                <span className={s.attachDocBar} />
                {[92, 78, 88, 62, 84, 48].map((w, i) => (
                  <span key={i} className={s.attachDocLine} style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>

            <div className={s.actionRow}>
              <span className={s.filetag} data-t={extOf(primary.name)}>{extOf(primary.name)}</span>
              <div style={{ minWidth: 0 }}>
                <div className={s.fw600} style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {primary.name}
                </div>
                <div className={s.muted} style={{ fontSize: 11.5 }}>
                  {[fmtSize(primary.sizeBytes), fmtDate(primary.receivedAt)].filter(Boolean).join(' · ')}
                  {' · from '}{primary.fromName ?? nameFromEmail(primary.fromAddress)}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                className={`${s.btn} ${s.btnPrimary}`}
                style={{ flex: 1, justifyContent: 'center' }}
                disabled={busy !== null}
                onClick={() => act(primary, 'download')}
              >
                <Icon name="download" size={13} /> {busy === primary.id + 'download' ? 'Downloading…' : 'Download'}
              </button>
              <button
                className={s.btn}
                disabled={busy !== null}
                onClick={() => act(primary, 'open')}
              >
                {busy === primary.id + 'open' ? 'Opening…' : `Open ${extOf(primary.name)}`}
              </button>
            </div>

            {rest.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className={s.sectionLabel}>All files</div>
                {rest.map(f => (
                  <div key={`${f.messageId}:${f.id}`} className={s.actionRow}>
                    <span className={s.filetag} data-t={extOf(f.name)}>{extOf(f.name)}</span>
                    <div className={s.flex1} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.name}
                      </div>
                      <div className={s.muted} style={{ fontSize: 11 }}>
                        {[fmtSize(f.sizeBytes), fmtDate(f.receivedAt)].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <button
                      className={s.iconBtn}
                      disabled={busy !== null}
                      onClick={() => act(f, 'open')}
                      title={`Open ${f.name}`}
                    >
                      <Icon name="eye" size={13} />
                    </button>
                    <button
                      className={s.iconBtn}
                      disabled={busy !== null}
                      onClick={() => act(f, 'download')}
                      title={`Download ${f.name}`}
                    >
                      <Icon name="download" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {err && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
          </>
        )}
      </div>
    </div>
  );
}

function MessageCard({ msg, isSelected, onSelect, onDeselect }: {
  msg: ThreadMessage;
  isSelected: boolean;
  onSelect: () => void;
  onDeselect: () => void;
}) {
  const [open, setOpen] = useState(false);

  const fromLabel = msg.fromName ?? nameFromEmail(msg.fromAddress);
  const toAddresses = msg.toAddresses ?? [];
  const ccAddresses = msg.ccAddresses ?? [];
  const personLabel = (person: { email: string; name?: string }) => person.name ?? nameFromEmail(person.email);
  const toLabel = toAddresses
    .slice(0, 2)
    .map(personLabel)
    .join(', ');
  const ccLabel = ccAddresses
    .slice(0, 1)
    .map(personLabel)
    .join(', ');
  const recipientTitle = [
    toAddresses.length > 0 ? `To: ${toAddresses.map(personLabel).join(', ')}` : '',
    ccAddresses.length > 0 ? `Cc: ${ccAddresses.map(personLabel).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  function handleClick() {
    const next = !open;
    setOpen(next);
    if (next) onSelect(); else onDeselect();
  }

  return (
    <div className={s.card} style={isSelected ? { borderColor: 'var(--accent)' } : undefined}>
      <div
        className={s.cardBody}
        onClick={handleClick}
        style={{ cursor: msg.bodyText ? 'pointer' : 'default' }}
      >
        <div className={s.msgHead}>
          <span className={s.chevron} style={{ transform: open ? 'rotate(90deg)' : 'none' }}>›</span>
          <Avatar name={fromLabel} size={34} />
          <div className={s.msgFromTo}>
            <div className={s.msgFrom} title={recipientTitle || undefined}>
              <span className={s.msgSender}>{fromLabel}</span>
              {toLabel && <span className={s.msgArrow}> → {toLabel}{toAddresses.length > 2 ? ` +${toAddresses.length - 2}` : ''}</span>}
              {ccLabel && <span className={s.msgCc}>Cc {ccLabel}{ccAddresses.length > 1 ? ` +${ccAddresses.length - 1}` : ''}</span>}
            </div>
            <div className={s.msgTo}>{fmtDateTime(msg.receivedAt)}</div>
          </div>
          {msg.importance !== 'normal' && (
            <Badge tone={IMPORTANCE_TONES[msg.importance] ?? 'neutral'}>{msg.importance}</Badge>
          )}
          <Badge tone={msg.isRead ? 'neutral' : 'warn'}>{msg.isRead ? 'Read' : 'Unread'}</Badge>
        </div>

        {open && (
          msg.bodyText ? (
            <div className={s.msgBody} onClick={e => e.stopPropagation()}>{msg.bodyText}</div>
          ) : (
            <div className={s.muted} style={{ marginTop: 10, fontSize: 12.5 }}>No message body stored.</div>
          )
        )}

        {msg.hasAttachments && (
          <span className={s.attachChip}>
            <Icon name="clip" size={12} /> Includes attachment{msg.sizeBytes ? ` · ${(msg.sizeBytes / 1024 / 1024).toFixed(1)} MB message` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function ThreadDetailView({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const { user } = useAuth();
  const canReadAttachments = hasPermission(user, 'attachments.read');
  const canReadSummaries = hasPermission(user, 'summaries.read');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['thread', threadId],
    queryFn:  () => getThread(threadId),
    staleTime: 30_000,
  });

  // Local LLM generation is slow and expensive — fetch once, never retry/refetch.
  const summaryQ = useQuery({
    queryKey:  ['thread-summary', threadId],
    queryFn:   () => getThreadSummary(threadId),
    enabled:   canReadSummaries,
    staleTime: Infinity,
    retry:     false,
    refetchOnWindowFocus: false,
  });

  // Which message's attachments show on the right — set when a message is opened,
  // cleared when that same message is minimized again.
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  if (isLoading) return <div className={s.emptyState}>Loading thread…</div>;
  if (isError || !data) return <div className={s.emptyState}><Icon name="alert" size={22} /> Failed to load thread.</div>;

  const { thread, messages } = data;
  const unread      = messages.filter(m => !m.isRead).length;
  const withAttach  = messages.filter(m => m.hasAttachments);
  const highCount   = messages.filter(m => m.importance === 'high').length;
  const latest      = messages[0];
  const selectedMessage = messages.find(m => m.id === selectedMessageId) ?? null;
  // Union the stored list with each message's from/to/cc so CC recipients show
  // up even on threads ingested before CC was included in participantEmails.
  const participants = [...new Set([
    ...thread.participantEmails,
    ...messages.flatMap(m => [
      m.fromAddress,
      ...m.toAddresses.map(a => a.email),
      ...m.ccAddresses.map(a => a.email),
    ]),
  ])].filter(Boolean);

  // Derived thread facts — shown while the AI summary generates or if the LLM is down.
  const factsText = [
    `Across ${messages.length} message${messages.length !== 1 ? 's' : ''}, ${participants.length} participant${participants.length !== 1 ? 's' : ''} exchanged email in this thread`,
    thread.firstMessageAt ? ` between ${fmtDate(thread.firstMessageAt)} and ${fmtDate(thread.lastMessageAt)}` : '',
    '. ',
    latest ? `The most recent message was sent by ${latest.fromName ?? nameFromEmail(latest.fromAddress)} on ${fmtDate(latest.receivedAt)}. ` : '',
    withAttach.length > 0 ? `${withAttach.length} message${withAttach.length !== 1 ? 's include' : ' includes'} attachments.` : '',
  ].join('');

  const aiSummary = summaryQ.data?.summary ?? null;

  return (
    <>
      <div className={s.pageHead}>
        <button className={s.btn} onClick={onBack}>‹ Back to threads</button>
      </div>

      <div className={s.threadDetailGrid}>
        {/* ── Left column: summary + message timeline ── */}
        <div className={s.msgList}>
          <div className={s.card}>
            <div className={s.cardBody}>
              <div className={s.threadHeader} style={{ marginBottom: 10 }}>
                <div className={s.threadMeta}>
                  <div className={s.threadName}>{thread.subject ?? '(no subject)'}</div>
                  <div className={s.muted} style={{ marginTop: 3 }}>
                    {(thread.mailboxDisplayName ?? nameFromEmail(thread.mailboxAddress))} · {thread.mailboxAddress}
                  </div>
                </div>
                {unread > 0 && <span className={s.actionChip}><Icon name="bell" size={12} /> {unread} unread</span>}
              </div>

              <div className={s.aiSummary}>
                <div className={s.aiSummaryHead}>
                  <Icon name="sparkle" size={12} /> Thread Summary
                  <span style={{ marginLeft: 'auto', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>
                    {aiSummary
                      ? `Grounded · ${messages.length} message${messages.length !== 1 ? 's' : ''}`
                      : summaryQ.isLoading ? 'Generating…' : 'Thread facts'}
                  </span>
                </div>
                {summaryQ.isLoading ? (
                  <p className={s.aiSummaryBody} style={{ opacity: 0.75 }}>
                    Generating AI summary of {messages.length} message{messages.length !== 1 ? 's' : ''}…
                  </p>
                ) : (
                  <>
                    <p className={s.aiSummaryBody}>{aiSummary ?? factsText}</p>
                    {!aiSummary && summaryQ.isError && (
                      <p className={s.muted} style={{ margin: '6px 0 0', fontSize: 11.5 }}>
                        AI summary service is unavailable — showing thread facts instead.
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className={s.chips} style={{ marginTop: 12 }}>
                <span className={s.factChip}><strong>Messages</strong> {thread.messageCount}</span>
                <span className={s.factChip}><strong>Participants</strong> {participants.length}</span>
                {withAttach.length > 0 && <span className={s.factChip}><strong>Attachments</strong> {withAttach.length}</span>}
              </div>
            </div>
          </div>

          {messages.length === 0 ? (
            <div className={s.card}><div className={s.emptyState}>No messages stored for this thread yet.</div></div>
          ) : (
            messages.map(m => (
              <MessageCard
                key={m.id}
                msg={m}
                isSelected={m.id === selectedMessage?.id}
                onSelect={() => setSelectedMessageId(m.id)}
                onDeselect={() => setSelectedMessageId(prev => (prev === m.id ? null : prev))}
              />
            ))
          )}
        </div>

        {/* ── Right column: attachments + extracted details + participants ── */}
        <div className={s.msgList}>
          <ThreadAttachmentsCard
            threadId={threadId}
            message={selectedMessage}
            canReadAttachments={canReadAttachments}
          />

          <div className={s.card}>
            <div className={s.cardBody}>
              <div className={s.aiSummaryHead} style={{ color: 'var(--text-3)' }}>
                <Icon name="sparkle" size={12} /> Extracted details
              </div>
              <div className={s.kvRow}><span className={s.kvKey}>Latest sender</span><span className={s.kvVal}>{latest ? (latest.fromName ?? nameFromEmail(latest.fromAddress)) : '—'}</span></div>
              <div className={s.kvRow}><span className={s.kvKey}>Mailbox</span><span className={s.kvVal}>{thread.mailboxAddress}</span></div>
              <div className={s.kvRow}><span className={s.kvKey}>Messages</span><span className={s.kvVal}>{thread.messageCount}</span></div>
              <div className={s.kvRow}><span className={s.kvKey}>First message</span><span className={s.kvVal}>{fmtDate(thread.firstMessageAt)}</span></div>
              <div className={s.kvRow}><span className={s.kvKey}>Last message</span><span className={s.kvVal}>{fmtDate(thread.lastMessageAt)}</span></div>
              <div className={s.kvRow}><span className={s.kvKey}>Attachments</span><span className={s.kvVal}>{withAttach.length > 0 ? `${withAttach.length} message${withAttach.length !== 1 ? 's' : ''}` : 'None'}</span></div>
              {highCount > 0 && (
                <div className={s.kvRow}><span className={s.kvKey}>High importance</span><span className={s.kvVal}>{highCount} message{highCount !== 1 ? 's' : ''}</span></div>
              )}
              {unread > 0 && (
                <div style={{ marginTop: 10 }}>
                  <span className={s.actionChip}><Icon name="bell" size={12} /> Action: {unread} unread message{unread !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          </div>

          <div className={s.card}>
            <div className={s.cardBody}>
              <div className={s.sectionLabel}>Participants · {participants.length}</div>
              {participants.map(email => (
                <div key={email} className={s.actionRow}>
                  <UserCell name={nameFromEmail(email)} secondary={email} size={26} />
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

export function ThreadsView() {
  const [input, setInput]       = useState('');
  const [search, setSearch]     = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [browseGroup, setBrowseGroup] = useState<ThreadGroup | null>(null);

  const colPrefs = useColumnPrefs('threads-admin', ADMIN_THREAD_COLUMNS);
  const [searchVisible, setSearchVisible] = useSearchBarVisibility('threads-admin');

  const rootRef = useRef<HTMLDivElement>(null);

  const openThread  = (id: string) => setThreadId(id);
  const closeThread = () => setThreadId(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  function clearSearch() { setInput(''); setSearch(''); }
  useResetOnHide(clearSearch);

  function toggleSearchVisible(next: boolean) {
    setSearchVisible(next);
    if (!next) clearSearch();
  }

  // Per-user mailbox aggregates; threads are fetched lazily per group on expand.
  // The server scopes this to every mailbox for admins, or the caller's own
  // mailbox plus any org-hierarchy reports' mailboxes for employees.
  const groupsQ = useQuery({
    queryKey:  ['thread-groups'],
    queryFn:   listThreadGroups,
    staleTime: 30_000,
  });

  const groups = useMemo(() => {
    const all = groupsQ.data ?? [];
    const q = normalizeSearchTerm(search);
    return all.filter((g) => matchesSearchTerm([g.mailboxAddress, g.mailboxDisplayName], q));
  }, [groupsQ.data, search]);

  const totalLabel = groupsQ.data
    ? `${groupsQ.data.reduce((n, g) => n + g.threadCount, 0).toLocaleString()} threads · ${groupsQ.data.length} user${groupsQ.data.length !== 1 ? 's' : ''}`
    : '';

  return (
    <div ref={rootRef}>

      {threadId ? (
        <div className={s.page}>
          <ThreadDetailView threadId={threadId} onBack={closeThread} />
        </div>
      ) : browseGroup ? (
        <div className={s.page}>
          <MailboxThreadsPage
            group={browseGroup}
            onOpenThread={openThread}
            onBack={() => setBrowseGroup(null)}
          />
        </div>
      ) : (
      <div className={s.page}>

      <TableToolbar
        borderless
        beforeSearch={<span className={s.muted} style={{ fontSize: 12 }}>{totalLabel}</span>}
        search={searchVisible ? { value: input, onChange: setInput, onClear: clearSearch, placeholder: 'Search by user or mailbox…' } : undefined}
        actions={
          <ColumnFilterMenu
            prefs={colPrefs}
            searchToggle={{ visible: searchVisible, onToggleVisible: toggleSearchVisible }}
          />
        }
      />

      <div className={s.card}>
        <div className={s.tableWrap}>
          {groupsQ.isLoading ? (
            <div className={s.emptyState}>Loading…</div>
          ) : groupsQ.isError ? (
            <div className={s.emptyState}><Icon name="alert" size={20} /> Failed to load threads.</div>
          ) : (
            <table className={s.tbl}>
              <thead>
                <tr>
                  {colPrefs.visible.map((col) => <th key={col.id}>{col.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr>
                    <td colSpan={colPrefs.visible.length}>
                      <div className={s.emptyState}>
                        <div className={s.emptyIcon}><Icon name="book" size={20} /></div>
                        {search
                          ? `No results for "${search}"`
                          : 'No threads yet. Email threads will appear here once emails are indexed.'}
                      </div>
                    </td>
                  </tr>
                ) : (
                  groups.map(g => (
                    <MailboxGroupRow key={g.mailboxId} group={g} columns={colPrefs.visible} onOpenThread={openThread} onMore={setBrowseGroup} />
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      </div>
      )}

    </div>
  );
}
