import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { Badge, Icon, UserCell, ColumnFilterMenu, SearchField } from '@/shared/components/ui';
import { Modal } from '@/shared/components/Modal';
import {
  listMessages, getMessage, listMessageAttachments, downloadMessageAttachment,
} from '@/features/messages/messages.api';
import type { MessageRow, AttachmentMeta } from '@/features/messages/messages.api';
import { listAccessibleMailboxes, type AccessibleMailbox } from '@/features/mailboxes/mailboxes.api';
import { useColumnPrefs, type ColumnMeta } from '@/shared/hooks/useColumnPrefs';
import { useSearchBarVisibility } from '@/shared/hooks/useSearchBarVisibility';
import { matchesSearchTerm, normalizeSearchTerm } from '@/shared/utils/search';
import { DateRangeFilter } from './DateRangeFilter';
import type { DateRange } from './DateRangeFilter';
import { TablePagination } from './TablePagination';
import { hasPermission } from '../access';
import s from '@/styles/features/dashboard/views/views.module.css';
import { useResetOnHide } from '@/features/dashboard/viewActive';

function accessibleName(m: AccessibleMailbox): string {
  const full = [m.givenName, m.familyName].filter(Boolean).join(' ');
  return m.displayName || full || m.address;
}

const IMPORTANCE_TONES: Record<string, 'danger' | 'warn' | 'neutral' | 'ok'> = {
  high:   'danger',
  normal: 'neutral',
  low:    'ok',
};

const PAGE_SIZES = [25, 50, 100] as const;

// ─── Table columns (show/hide + reorder via the Filter menu) ─────────────────
// The Mailbox page shows only the signed-in user's own mailbox (admins included).
const OWN_EMAIL_COLUMNS: ColumnMeta[] = [
  { id: 'subject',     label: 'Subject' },
  { id: 'importance',  label: 'Importance' },
  { id: 'attachments', label: 'Attachments' },
  { id: 'latest',      label: 'Latest' },
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

function extOf(name: string): string {
  const e = name.includes('.') ? name.split('.').pop()! : '';
  return e && e.length <= 5 ? e.toUpperCase() : 'FILE';
}

function renderOwnEmailCell(colId: string, e: MessageRow, canReadAttachments: boolean) {
  switch (colId) {
    case 'subject':
      return (
        <td key={colId} style={{ maxWidth: 380 }}>
          <div className={s.cellName}>
            {!e.isRead && <span className={s.unreadDot} />}
            <span className={s.subj}>{e.subject ?? '(no subject)'}</span>
          </div>
          <div className={s.muted} style={{ fontSize: 12, marginTop: 2 }}>
            {e.fromName ?? e.fromAddress}
          </div>
        </td>
      );
    case 'importance':
      return <td key={colId}><Badge tone={IMPORTANCE_TONES[e.importance] ?? 'neutral'}>{e.importance}</Badge></td>;
    case 'attachments':
      return (
        <td key={colId}>
          {e.hasAttachments && canReadAttachments && (
            <Badge tone="neutral">
              <Icon name="clip" size={11} /> Attached
            </Badge>
          )}
        </td>
      );
    case 'latest':
      return <td key={colId} className={s.muted}>{fmtDate(e.receivedAt)}</td>;
    default:
      return null;
  }
}

// ── Message detail modal (opened by clicking a row) ───────────────────────────

function MessageDetailModal({ messageId, canReadAttachments, onClose }: {
  messageId: string;
  canReadAttachments: boolean;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['message', messageId],
    queryFn:  () => getMessage(messageId),
    staleTime: 30_000,
  });

  const attachQ = useQuery({
    queryKey:  ['message-attachments', messageId],
    queryFn:   () => listMessageAttachments(messageId),
    enabled:   canReadAttachments && !!data?.hasAttachments,
    staleTime: Infinity,
    retry:     false,
  });

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);

  async function download(att: AttachmentMeta) {
    setErr(null);
    setBusy(att.id);
    try {
      const blob  = await downloadMessageAttachment(messageId, att.id, { auditDownload: true });
      const typed = att.contentType ? new Blob([blob], { type: att.contentType }) : blob;
      const url   = URL.createObjectURL(typed);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setErr('Download failed — the mail provider rejected the request.');
    } finally {
      setBusy(null);
    }
  }

  const files = (attachQ.data ?? []).filter(a => !a.isInline);

  return (
    <Modal open onClose={onClose} title={data?.subject ?? 'Message'} width={640}>
      {isLoading ? (
        <div className={s.emptyState}>Loading message…</div>
      ) : isError || !data ? (
        <div className={s.emptyState}><Icon name="alert" size={20} /> Failed to load message.</div>
      ) : (
        <>
          <div className={s.kvRow}>
            <span className={s.kvKey}>From</span>
            <span className={s.kvVal}>{data.fromName ?? data.fromAddress} &lt;{data.fromAddress}&gt;</span>
          </div>
          <div className={s.kvRow}>
            <span className={s.kvKey}>To</span>
            <span className={s.kvVal}>{data.toAddresses.map(a => a.name ?? a.email).join(', ') || '—'}</span>
          </div>
          {data.ccAddresses.length > 0 && (
            <div className={s.kvRow}>
              <span className={s.kvKey}>Cc</span>
              <span className={s.kvVal}>{data.ccAddresses.map(a => a.name ?? a.email).join(', ')}</span>
            </div>
          )}
          <div className={s.kvRow}><span className={s.kvKey}>Date</span><span className={s.kvVal}>{fmtDateTime(data.receivedAt)}</span></div>
          <div className={s.kvRow}><span className={s.kvKey}>Mailbox</span><span className={s.kvVal}>{data.mailboxAddress}</span></div>

          <div style={{ marginTop: 14 }}>
            {data.bodyText ? (
              <div className={s.msgBody}>{data.bodyText}</div>
            ) : (
              <div className={s.muted} style={{ fontSize: 12.5 }}>No message body stored.</div>
            )}
          </div>

          {data.hasAttachments && canReadAttachments && (
            <div style={{ marginTop: 14 }}>
              <div className={s.sectionLabel}>Attachments</div>
              {attachQ.isLoading ? (
                <div className={s.muted} style={{ fontSize: 12.5 }}>Loading attachments…</div>
              ) : attachQ.isError ? (
                <div className={s.muted} style={{ fontSize: 12.5 }}>Couldn't load attachments from the mail provider.</div>
              ) : files.length === 0 ? (
                <div className={s.muted} style={{ fontSize: 12.5 }}>No downloadable files in this message.</div>
              ) : (
                files.map(f => (
                  <div key={f.id} className={s.actionRow}>
                    <span className={s.filetag} data-t={extOf(f.name)}>{extOf(f.name)}</span>
                    <div className={s.flex1} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                    </div>
                    <button className={s.iconBtn} disabled={busy !== null} onClick={() => download(f)} title={`Download ${f.name}`}>
                      {busy === f.id ? '…' : <Icon name="download" size={13} />}
                    </button>
                  </div>
                ))
              )}
              {err && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

export function EmailsView() {
  const [input, setInput]   = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange]   = useState<DateRange>({ from: '', to: '' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage]     = useState(1);
  const [limit, setLimit]   = useState<number>(PAGE_SIZES[0]);
  // null = viewing my own mail. Otherwise the mailboxId of another user,
  // chosen from the "other users" panel — gated server-side by the same
  // role/org-hierarchy permission GET /messages already enforces.
  const [viewingMailboxId, setViewingMailboxId] = useState<string | null>(null);
  const [peopleFilter, setPeopleFilter] = useState('');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canReadAttachments = hasPermission(user, 'attachments.read');
  const deepLinkMessageId = searchParams.get('messageId');

  const colPrefs = useColumnPrefs('emails-own', OWN_EMAIL_COLUMNS);
  const [searchVisible, setSearchVisible] = useSearchBarVisibility('emails-own');
  const [paginationVisible, setPaginationVisible] = useSearchBarVisibility('emails-own-pagination');

  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  // Deep-link support: chat citations ("View source") link here as
  // /mails?messageId=<id>. Switch to the cited message's mailbox first,
  // then open the exact message so the user lands in the right mail context.
  useEffect(() => {
    if (!deepLinkMessageId) return;

    let cancelled = false;
    setOpenId(deepLinkMessageId);
    setPage(1);
    setPeopleFilter('');
    setInput('');
    setSearch('');
    setRange({ from: '', to: '' });

    void getMessage(deepLinkMessageId).then((message) => {
      if (cancelled) return;
      setViewingMailboxId(message.mailboxId === user?.mailboxId ? null : message.mailboxId);
    }).catch(() => {
      // Keep the message modal behavior unchanged; it will render its own error state.
    });

    return () => { cancelled = true; };
  }, [deepLinkMessageId, user?.mailboxId]);

  function closeMessageModal() {
    setOpenId(null);
    if (searchParams.has('messageId')) {
      const next = new URLSearchParams(searchParams);
      next.delete('messageId');
      setSearchParams(next, { replace: true });
    }
  }

  function clearSearch() { setInput(''); setSearch(''); }
  useResetOnHide(() => { clearSearch(); setPeopleFilter(''); setPage(1); });
  function toggleSearchVisible(next: boolean) {
    setSearchVisible(next);
    if (!next) clearSearch();
  }

  function changeLimit(nextLimit: number) {
    setLimit(nextLimit);
    setPage(1);
  }

  useEffect(() => { setPage(1); }, [search, range.from, range.to, viewingMailboxId]);

  const accessibleQ = useQuery({
    queryKey:  ['mailboxes-accessible'],
    queryFn:   listAccessibleMailboxes,
    staleTime: 60_000,
  });
  const accessible = accessibleQ.data ?? [];
  const peopleQuery = normalizeSearchTerm(peopleFilter);
  const filteredAccessible = peopleQuery
    ? accessible.filter((m) => matchesSearchTerm([accessibleName(m), m.address, m.departmentName, m.jobTitle], peopleQuery))
    : accessible;
  const viewingMailbox = accessible.find((m) => m.id === viewingMailboxId) ?? null;

  // scope=own for "my mail" (everyone, admins included); mailboxId for a
  // specific other user, re-validated against the same permission on the
  // server regardless of what this client sends.
  const messagesQ = useQuery({
    queryKey:  ['messages', { own: !viewingMailboxId, mailboxId: viewingMailboxId, search, from: range.from, to: range.to, page, limit }],
    queryFn:   () => listMessages({
      ...(viewingMailboxId ? { mailboxId: viewingMailboxId } : { scope: 'own' as const }),
      search: search || undefined,
      from:   range.from || undefined,
      to:     range.to   || undefined,
      limit,
      page,
    }),
    staleTime: 30_000,
  });

  const isLoading  = messagesQ.isLoading;
  const isError    = messagesQ.isError;
  const rows       = messagesQ.data?.messages ?? [];
  const total      = messagesQ.data?.total ?? 0;
  const totalPages = Math.max(1, messagesQ.data?.totalPages ?? 1);
  const totalLabel = messagesQ.data ? `${total.toLocaleString()} messages` : '';

  const mainColumn = (
    <div>
      {user && (
        <div className={s.card} style={{ marginBottom: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          {viewingMailbox ? (
            <UserCell
              mailboxId={viewingMailbox.id}
              name={accessibleName(viewingMailbox)}
              secondary={viewingMailbox.address}
              size={28}
            />
          ) : (
            <UserCell
              mailboxId={user.mailboxId ?? undefined}
              name={user.displayName || user.email}
              secondary={user.email}
              size={28}
            />
          )}
          <span className={s.muted} style={{ fontSize: 12, marginLeft: 'auto', flexShrink: 0 }}>
            {viewingMailbox ? "Viewing this person's mail" : 'Viewing your mail'}
          </span>
          {viewingMailbox && (
            <button type="button" className={s.btn} onClick={() => setViewingMailboxId(null)}>
              <span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}><Icon name="arrowUp" size={12} /></span> Back to my mail
            </button>
          )}
        </div>
      )}

      <div className={s.pageHead}>
        <DateRangeFilter range={range} onChange={setRange} />
        <div className={s.pageHeadRight}>
          <span className={s.muted} style={{ fontSize: 12 }}>{totalLabel}</span>
          {searchVisible && (
            <SearchField
              value={input}
              onChange={setInput}
              onClear={clearSearch}
              placeholder="Search by subject or sender…"
            />
          )}
          <ColumnFilterMenu
            prefs={colPrefs}
            searchToggle={{ visible: searchVisible, onToggleVisible: toggleSearchVisible }}
            paginationToggle={{ visible: paginationVisible, onToggleVisible: setPaginationVisible }}
          />
        </div>
      </div>

      <div className={s.card}>
        <div className={s.tableWrap}>
          {isLoading ? (
            <div className={s.emptyState}>Loading…</div>
          ) : isError ? (
            <div className={s.emptyState}><Icon name="alert" size={20} /> Failed to load messages.</div>
          ) : (
            <table className={s.tbl}>
              <thead>
                <tr>
                  {colPrefs.visible.map((col) => <th key={col.id}>{col.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={colPrefs.visible.length}>
                      <div className={s.emptyState}>
                        <div className={s.emptyIcon}><Icon name="mail" size={20} /></div>
                        {search ? `No results for "${search}"` : 'No emails found.'}
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map(e => (
                    <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(e.id)}>
                      {colPrefs.visible.map((col) => renderOwnEmailCell(col.id, e, canReadAttachments))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {total > 0 && paginationVisible && (
        <TablePagination
          page={page}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          pageSize={{ value: limit, options: PAGE_SIZES, onChange: changeLimit }}
          style={{ border: 'none', padding: '12px 4px' }}
        />
      )}
    </div>
  );

  const showPeoplePanel = accessibleQ.isLoading || accessible.length > 0;

  return (
    <div className={s.page}>
      {showPeoplePanel ? (
        <div className={s.colsMain} style={{ alignItems: 'start' }}>
          {mainColumn}

          <div className={s.card}>
            <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Other users</span>
              {accessible.length > 0 && (
                <span className={s.muted} style={{ fontSize: 11 }}>· {accessible.length}</span>
              )}
            </div>
            {accessible.length > 6 && (
              <div style={{ padding: '0 10px 6px' }}>
                <div className={s.modalSearch} style={{ maxWidth: 'none', height: 28 }}>
                  <Icon name="search" size={11} />
                  <input
                    className={s.modalSearchInput}
                    placeholder="Filter…"
                    value={peopleFilter}
                    onChange={(e) => setPeopleFilter(e.target.value)}
                  />
                  {peopleFilter && (
                    <button type="button" className={s.searchClear} onClick={() => setPeopleFilter('')} aria-label="Clear filter">
                      <Icon name="x" size={11} />
                    </button>
                  )}
                </div>
              </div>
            )}
            <div style={{ maxHeight: 400, overflowY: 'auto', padding: '0 6px 6px' }}>
              {accessibleQ.isLoading ? (
                <div className={s.muted} style={{ fontSize: 12, padding: '6px' }}>Loading…</div>
              ) : filteredAccessible.length === 0 ? (
                <div className={s.muted} style={{ fontSize: 12, padding: '6px' }}>No matching users.</div>
              ) : (
                filteredAccessible.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={s.modalRow}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      background: viewingMailboxId === m.id ? 'var(--surface-2)' : undefined,
                    }}
                    onClick={() => setViewingMailboxId(m.id)}
                  >
                    <UserCell
                      mailboxId={m.id}
                      name={accessibleName(m)}
                      secondary={m.address}
                      size={24}
                    />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : mainColumn}

      {openId && (
        <MessageDetailModal
          messageId={openId}
          canReadAttachments={canReadAttachments}
          onClose={closeMessageModal}
        />
      )}

    </div>
  );
}
