import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Icon, ColumnFilterMenu, Combobox, SearchField, TableToolbar } from '@/shared/components/ui';
import { MailboxAvatar } from '@/features/mailboxes/MailboxAvatar';
import {
  downloadMessageAttachment, indexAttachments, listAttachmentGroups, listOrgAttachments,
} from '@/features/messages/messages.api';
import type { AttachmentGroup, OrgAttachment } from '@/features/messages/messages.api';
import { useColumnPrefs, type ColumnMeta } from '@/shared/hooks/useColumnPrefs';
import { useSearchBarVisibility } from '@/shared/hooks/useSearchBarVisibility';
import { matchesSearchTerm, normalizeSearchTerm } from '@/shared/utils/search';
import s from '@/styles/features/dashboard/views/views.module.css';
import { useResetOnHide } from '@/features/dashboard/viewActive';

const FILE_TYPES = ['All', 'PDF', 'DOCX', 'XLSX', 'PPTX'] as const;
const PAGE_SIZES = [25, 50, 100] as const;

// ─── Table columns (show/hide + reorder via the Filter menu) ─────────────────

const GROUP_COLUMNS: ColumnMeta[] = [
  { id: 'user',       label: 'User' },
  { id: 'department', label: 'Department' },
  { id: 'files',       label: 'Files' },
  { id: 'latest',     label: 'Latest' },
];

const FILE_COLUMNS: ColumnMeta[] = [
  { id: 'file',       label: 'File' },
  { id: 'source',     label: 'Source email' },
  { id: 'department', label: 'Department' },
  { id: 'size',       label: 'Size' },
  { id: 'date',       label: 'Date' },
];

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en', {
    month:  'short',
    day:    'numeric',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function extOf(name: string): string {
  const e = name.includes('.') ? name.split('.').pop()! : '';
  return e && e.length <= 5 ? e.toUpperCase() : 'FILE';
}

/** "maria.gomez@acme.com" → "Maria Gomez" (display fallback when no name is stored). */
function nameFromEmail(email: string) {
  return email
    .split('@')[0]
    .split(/[._-]/)
    .filter(Boolean)
    .map(p => (p[0]?.toUpperCase() ?? '') + p.slice(1))
    .join(' ');
}

// ── Grouped row (attachments grouped user by user) ────────────────────────────

function senderLabel(file: OrgAttachment): string {
  return file.fromName ? `${file.fromName} <${file.fromAddress}>` : file.fromAddress;
}

function ownerLabel(file: OrgAttachment): string {
  return file.ownerName ?? nameFromEmail(file.mailboxAddress);
}

type AttachmentPreview =
  | { status: 'loading' }
  | { status: 'pdf' | 'image'; url: string }
  | { status: 'text'; text: string }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

function previewMime(file: OrgAttachment, blob: Blob): string {
  const declared = (file.contentType ?? blob.type ?? '').split(';')[0].trim().toLowerCase();
  const ext = extOf(file.name).toLowerCase();
  if (declared && declared !== 'application/octet-stream') return declared;
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'txt' || ext === 'log' || ext === 'md') return 'text/plain';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'json') return 'application/json';
  if (ext === 'xml') return 'application/xml';
  if (ext === 'html' || ext === 'htm') return 'text/html';
  return declared;
}

function previewBlob(file: OrgAttachment, blob: Blob): Blob {
  const mime = previewMime(file, blob);
  return mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob;
}

function previewType(file: OrgAttachment, blob: Blob): 'pdf' | 'image' | 'text' | 'unsupported' {
  const contentType = previewMime(file, blob);
  const ext = extOf(file.name).toLowerCase();
  if (contentType.includes('pdf') || ext === 'pdf') return 'pdf';
  if (contentType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (contentType.startsWith('text/') || ['txt', 'csv', 'json', 'xml', 'log', 'md', 'html', 'htm'].includes(ext)) return 'text';
  return 'unsupported';
}

function AttachmentDetailsWizard({
  file,
  busy,
  error,
  onClose,
  onDownload,
}: {
  file: OrgAttachment;
  busy: string | null;
  error: string | null;
  onClose: () => void;
  onDownload: (file: OrgAttachment) => Promise<void>;
}) {
  const busyForFile = busy?.startsWith(file.messageId + file.id) ?? false;
  const [preview, setPreview] = useState<AttachmentPreview>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    setPreview({ status: 'loading' });

    async function loadPreview() {
      try {
        const blob = await downloadMessageAttachment(file.messageId, file.id);
        if (!active) return;
        const typed = previewBlob(file, blob);
        const kind = previewType(file, typed);

        if (kind === 'text') {
          const text = await typed.text();
          if (active) setPreview({ status: 'text', text: text || '(empty file)' });
          return;
        }

        if (kind === 'pdf' || kind === 'image') {
          objectUrl = URL.createObjectURL(typed);
          if (active) setPreview({ status: kind, url: objectUrl });
          return;
        }

        setPreview({ status: 'unsupported' });
      } catch {
        if (active) setPreview({ status: 'error', message: 'Preview failed. The mail provider rejected the request.' });
      }
    }

    void loadPreview();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, file.contentType, file.id, file.messageId, file.name]);

  return (
    <div className={s.modalOverlay} role="presentation" onMouseDown={onClose}>
      <div
        className={s.attachmentWizardPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attachment-details-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={s.modalHead}>
          <div className={s.attachmentWizardIcon}>
            <Icon name="file" size={22} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={s.attachmentWizardTitle} id="attachment-details-title">Document details</div>
            <div className={s.attachmentWizardName}>{file.name}</div>
            <div className={s.attachmentWizardMeta}>
              <span className={s.filetag} data-t={extOf(file.name)}>{extOf(file.name)}</span>
              <span>{fmtSize(file.sizeBytes)}</span>
              <span>{fmtDate(file.receivedAt)}</span>
            </div>
          </div>
          <button className={s.modalClose} onClick={onClose} aria-label="Close document details">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className={s.attachmentWizardBody}>
          <div className={s.attachmentDetailGrid}>
            <div className={s.attachmentDetailItem}>
              <span className={s.attachmentDetailLabel}>File type</span>
              <span className={s.attachmentDetailValue}>{file.contentType ?? extOf(file.name)}</span>
            </div>
            <div className={s.attachmentDetailItem}>
              <span className={s.attachmentDetailLabel}>Size</span>
              <span className={s.attachmentDetailValue}>{fmtSize(file.sizeBytes)}</span>
            </div>
            <div className={s.attachmentDetailItem}>
              <span className={s.attachmentDetailLabel}>Owner</span>
              <span className={s.attachmentDetailValue}>{ownerLabel(file)}</span>
            </div>
            <div className={s.attachmentDetailItem}>
              <span className={s.attachmentDetailLabel}>Mailbox</span>
              <span className={s.attachmentDetailValue}>{file.mailboxAddress}</span>
            </div>
            <div className={s.attachmentDetailItem}>
              <span className={s.attachmentDetailLabel}>Department</span>
              <span className={s.attachmentDetailValue}>{file.department ?? '-'}</span>
            </div>
            <div className={s.attachmentDetailItem}>
              <span className={s.attachmentDetailLabel}>Received</span>
              <span className={s.attachmentDetailValue}>{fmtDateTime(file.receivedAt)}</span>
            </div>
          </div>

          <div className={s.attachmentSourceBox}>
            <span className={s.attachmentDetailLabel}>Source email</span>
            <span className={s.attachmentDetailValue}>{file.subject ?? '(no subject)'}</span>
            <span className={s.muted} style={{ fontSize: 12 }}>{senderLabel(file)}</span>
          </div>

          {error && <div className={s.attachmentError}>{error}</div>}

          <div className={s.attachmentPreviewBox}>
            <div className={s.attachmentPreviewHead}>
              <span className={s.attachmentDetailLabel}>Attachment preview</span>
              <span className={s.muted} style={{ fontSize: 12 }}>
                {preview.status === 'loading' ? 'Loading...' : file.name}
              </span>
            </div>

            {preview.status === 'loading' && (
              <div className={s.attachmentPreviewEmpty}>
                <Icon name="clock" size={18} />
                Loading attachment content...
              </div>
            )}
            {preview.status === 'pdf' && (
              <object
                className={s.attachmentPreviewFrame}
                data={`${preview.url}#toolbar=0&navpanes=0`}
                type="application/pdf"
                aria-label={`Preview ${file.name}`}
              >
                <div className={s.attachmentPreviewEmpty}>
                  <Icon name="file" size={18} />
                  PDF preview is not available in this browser.
                </div>
              </object>
            )}
            {preview.status === 'image' && (
              <div className={s.attachmentPreviewImageWrap}>
                <img className={s.attachmentPreviewImage} src={preview.url} alt={file.name} />
              </div>
            )}
            {preview.status === 'text' && (
              <pre className={s.attachmentPreviewText}>{preview.text}</pre>
            )}
            {preview.status === 'unsupported' && (
              <div className={s.attachmentPreviewEmpty}>
                <Icon name="file" size={18} />
                This file type cannot be previewed in the browser.
              </div>
            )}
            {preview.status === 'error' && (
              <div className={s.attachmentPreviewEmpty}>
                <Icon name="alert" size={18} />
                {preview.message}
              </div>
            )}
          </div>
        </div>

        <div className={s.modalFoot}>
          <span className={s.muted} style={{ fontSize: 12 }}>
            {busyForFile ? 'Preparing document...' : 'Ready'}
          </span>
          <div className={s.attachmentActions}>
            <button className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null} onClick={() => void onDownload(file)}>
              <Icon name="download" size={14} /> Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderGroupCell(colId: string, g: AttachmentGroup) {
  switch (colId) {
    case 'user':
      return (
        <td key={colId} style={{ maxWidth: 380 }}>
          <div className={s.cellName}>
            <MailboxAvatar mailboxId={g.mailboxId} name={g.mailboxDisplayName ?? g.mailboxAddress} size={28} />
            <div>
              <div className={s.subj}>{g.mailboxDisplayName ?? nameFromEmail(g.mailboxAddress)}</div>
              <div className={s.muted} style={{ fontSize: 12 }}>{g.mailboxAddress}</div>
            </div>
          </div>
        </td>
      );
    case 'department':
      return <td key={colId}>{g.department ? <Badge tone="neutral">{g.department}</Badge> : <span className={s.muted}>—</span>}</td>;
    case 'files':
      return (
        <td key={colId} className={s.tnum}>
          {g.fileMessageCount} email{g.fileMessageCount !== 1 ? 's' : ''}
        </td>
      );
    case 'latest':
      return <td key={colId} className={s.muted}>{fmtDate(g.latestReceivedAt)}</td>;
    default:
      return null;
  }
}

// ── Per-mailbox attachments page (search, file-type filter, pagination) ───────

function MailboxAttachmentsPage({ group, onBack }: { group: AttachmentGroup; onBack: () => void }) {
  const [type, setType]           = useState<string>('All');
  const [query, setQuery]         = useState('');
  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(1);
  const [limit, setLimit]         = useState<number>(PAGE_SIZES[0]);
  const [busy, setBusy]           = useState<string | null>(null);
  const [err, setErr]             = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<OrgAttachment | null>(null);
  const [indexRemaining, setIndexRemaining] = useState<number | null>(null);
  const indexingRef = useRef(false);
  const queryClient = useQueryClient();
  const [searchVisible, setSearchVisible] = useSearchBarVisibility('attachments');
  const [paginationVisible, setPaginationVisible] = useSearchBarVisibility('attachments-pagination');

  function clearSearch() { setQuery(''); setSearch(''); }
  useResetOnHide(() => { clearSearch(); setPage(1); });

  function toggleSearchVisible(next: boolean) {
    setSearchVisible(next);
    if (!next) clearSearch();
  }

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Reset to the first page whenever a filter changes.
  useEffect(() => { setPage(1); }, [search, limit]);

  // While a search is active, index not-yet-seen attachment messages from the
  // provider in the background so filename search covers everything — even
  // files that were never loaded in the UI. Results refresh after each batch.
  useEffect(() => {
    if (!search || indexingRef.current) return;
    let cancelled = false;
    indexingRef.current = true;

    (async () => {
      try {
        for (;;) {
          const r = await indexAttachments(25);
          if (cancelled) return;
          setIndexRemaining(r.remaining);
          if (r.indexed > 0) {
            await queryClient.invalidateQueries({ queryKey: ['org-attachments'] });
          }
          // Stop when done, or when a whole batch failed (provider down) to
          // avoid hammering it in a loop.
          if (r.remaining <= 0 || r.indexed === 0) return;
        }
      } catch {
        /* provider/indexing unavailable — search still covers indexed files */
      } finally {
        indexingRef.current = false;
        if (!cancelled) setIndexRemaining(prev => (prev !== null && prev > 0 ? prev : 0));
      }
    })();

    return () => { cancelled = true; indexingRef.current = false; };
  }, [search, queryClient]);

  const q = useQuery({
    queryKey: ['org-attachments', { mailboxId: group.mailboxId, search, page, limit }],
    queryFn:  () => listOrgAttachments({
      mailboxId: group.mailboxId, page, limit, search: search || undefined,
    }),
    staleTime: 60_000,
    retry:     false,
    refetchOnWindowFocus: false,
  });

  const files          = q.data?.files ?? [];
  const failedMessages = q.data?.failedMessages ?? 0;
  const total          = q.data?.total ?? 0;
  const totalPages     = q.data?.totalPages ?? 1;
  const start           = total === 0 ? 0 : (page - 1) * limit + 1;
  const end             = Math.min(page * limit, total);

  // File-type chips filter the loaded rows client-side (type is only known
  // after the provider fetch) — filtering only applies within the current page.
  const rows = files.filter(a => type === 'All' || extOf(a.name) === type);

  const colPrefs = useColumnPrefs('attachments-mailbox', FILE_COLUMNS);

  function openDetails(file: OrgAttachment) {
    setErr(null);
    setSelectedFile(file);
  }

  function renderAttachmentCell(colId: string, a: OrgAttachment) {
    switch (colId) {
      case 'file':
        return (
          <td key={colId} style={{ maxWidth: 280 }}>
            <div className={s.cellName}>
              <span className={s.filetag} data-t={extOf(a.name)}>{extOf(a.name)}</span>
              <span className={s.subj} style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </span>
            </div>
          </td>
        );
      case 'source':
        return (
          <td key={colId} className={s.t2} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>
            {a.subject ?? '(no subject)'}
            <div className={s.muted} style={{ fontSize: 11 }}>{a.fromName ?? a.fromAddress}</div>
          </td>
        );
      case 'department':
        return <td key={colId}>{a.department ? <Badge tone="neutral">{a.department}</Badge> : <span className={s.muted}>—</span>}</td>;
      case 'size':
        return <td key={colId} className={`${s.numCol} ${s.tnum} ${s.t2}`}>{fmtSize(a.sizeBytes)}</td>;
      case 'date':
        return <td key={colId} className={s.muted}>{fmtDate(a.receivedAt)}</td>;
      default:
        return null;
    }
  }

  async function act(file: OrgAttachment) {
    setErr(null);
    setBusy(file.messageId + file.id + 'download');
    try {
      const blob  = await downloadMessageAttachment(file.messageId, file.id, { auditDownload: true });
      const typed = previewBlob(file, blob);
      const url   = URL.createObjectURL(typed);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
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

  return (
    <>
      <div className={s.pageHead}>
        <button className={s.btn} onClick={onBack}>‹ Back to attachments</button>
      </div>

      <div className={s.card} style={{ marginBottom: 16 }}>
        <div className={s.modalHead}>
          <MailboxAvatar mailboxId={group.mailboxId} name={group.mailboxDisplayName ?? group.mailboxAddress} size={40} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={s.subj} style={{ fontSize: 15 }}>
              {group.mailboxDisplayName ?? nameFromEmail(group.mailboxAddress)}
            </div>
            <div className={s.muted} style={{ fontSize: 12.5 }}>{group.mailboxAddress}</div>
          </div>
        </div>
      </div>

      <div className={s.pageHead}>
        <Combobox
          className={s.filterCombobox}
          options={[
            { value: 'All', label: 'All file types' },
            ...FILE_TYPES.filter(t => t !== 'All').map(t => ({ value: t, label: t })),
          ]}
          value={type}
          onChange={setType}
          placeholder="All file types"
          searchable={false}
        />
        <div className={s.pageHeadRight}>
          {searchVisible && (
            <SearchField
              value={query}
              onChange={setQuery}
              onClear={clearSearch}
              placeholder="Search by subject or sender…"
            />
          )}
          <span className={s.muted} style={{ fontSize: 12 }}>
            {total > 0 ? `${start}–${end} of ${total.toLocaleString()} attachment${total !== 1 ? 's' : ''}` : ''}
          </span>
          <ColumnFilterMenu
            prefs={colPrefs}
            searchToggle={{ visible: searchVisible, onToggleVisible: toggleSearchVisible }}
            paginationToggle={{ visible: paginationVisible, onToggleVisible: setPaginationVisible }}
          />
        </div>
      </div>

      {search && indexRemaining !== null && indexRemaining > 0 && (
        <div className={s.muted} style={{ fontSize: 12, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="clock" size={12} />
          Searching — indexing files from {indexRemaining.toLocaleString()} more email{indexRemaining !== 1 ? 's' : ''}…
          Results update as files are found.
        </div>
      )}

      <div className={s.card}>
        <div className={s.tableWrap}>
          <table className={s.tbl}>
            <thead>
              <tr>
                {colPrefs.visible.map((col) => (
                  <th key={col.id} className={col.id === 'size' ? s.numCol : undefined}>{col.label}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <tr>
                  <td colSpan={colPrefs.visible.length + 1}>
                    <div className={s.emptyState}>Loading attachments…</div>
                  </td>
                </tr>
              ) : q.isError ? (
                <tr>
                  <td colSpan={colPrefs.visible.length + 1}>
                    <div className={s.emptyState}>
                      <Icon name="alert" size={20} /> Failed to load attachments.
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colPrefs.visible.length + 1}>
                    <div className={s.emptyState}>
                      <div className={s.emptyIcon}><Icon name="clip" size={20} /></div>
                      {search || type !== 'All'
                        ? 'No attachments match the current filters.'
                        : 'No attachments found for this user.'}
                    </div>
                  </td>
                </tr>
              ) : rows.map(a => (
                <tr
                  key={`${a.messageId}:${a.id}`}
                  className={s.attachmentRow}
                  onClick={() => openDetails(a)}
                >
                  {colPrefs.visible.map((col) => renderAttachmentCell(col.id, a))}
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className={s.iconBtn}
                        title={`Download ${a.name}`}
                        disabled={busy !== null}
                        onClick={(e) => {
                          e.stopPropagation();
                          void act(a);
                        }}
                      >
                        <Icon name="download" size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {total > 0 && paginationVisible && (
        <div className={s.modalFoot} style={{ border: 'none', padding: '12px 4px', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={s.muted} style={{ fontSize: 12 }}>Page {page} of {totalPages}</span>
            <span className={s.muted} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              Show
              <Combobox
                size="sm"
                dropUp
                className={s.pageSizeCombobox}
                options={PAGE_SIZES.map(n => ({ value: String(n), label: String(n) }))}
                value={String(limit)}
                onChange={(v) => setLimit(Number(v))}
                searchable={false}
              />
              per page
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={s.btn} disabled={page <= 1}         onClick={() => setPage(p => Math.max(1, p - 1))}>‹ Prev</button>
            <button className={s.btn} disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next ›</button>
          </div>
        </div>
      )}

      {(failedMessages > 0 || err) && (
        <div style={{ marginTop: 10 }}>
          {failedMessages > 0 && (
            <div className={s.muted} style={{ fontSize: 12 }}>
              Couldn't load files from {failedMessages} email{failedMessages !== 1 ? 's' : ''} (provider lookup failed).
            </div>
          )}
          {err && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}
        </div>
      )}

      {selectedFile && (
        <AttachmentDetailsWizard
          file={selectedFile}
          busy={busy}
          error={err}
          onClose={() => setSelectedFile(null)}
          onDownload={act}
        />
      )}
    </>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

export function AttachmentsView() {
  const [input, setInput]   = useState('');
  const [search, setSearch] = useState('');
  const [browseGroup, setBrowseGroup] = useState<AttachmentGroup | null>(null);

  const colPrefs = useColumnPrefs('attachments-groups', GROUP_COLUMNS);
  const [searchVisible, setSearchVisible] = useSearchBarVisibility('attachments-groups');

  function clearSearch() { setInput(''); setSearch(''); }
  useResetOnHide(clearSearch);
  function toggleSearchVisible(next: boolean) {
    setSearchVisible(next);
    if (!next) clearSearch();
  }

  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  // Per-user mailbox aggregates. The server scopes this to every mailbox for
  // admins, or the caller's own mailbox plus any org-hierarchy reports' for
  // employees — same rule as the Threads page.
  const groupsQ = useQuery({
    queryKey:  ['attachment-groups'],
    queryFn:   listAttachmentGroups,
    staleTime: 30_000,
  });

  const groupSearch = normalizeSearchTerm(search);
  const groups = (groupsQ.data ?? []).filter((g) =>
    matchesSearchTerm([g.mailboxAddress, g.mailboxDisplayName, g.department], groupSearch),
  );

  const totalLabel = groupsQ.data
    ? `${groups.length} user${groups.length !== 1 ? 's' : ''}`
    : '';

  if (browseGroup) {
    return (
      <div className={s.page}>
        <MailboxAttachmentsPage group={browseGroup} onBack={() => setBrowseGroup(null)} />
      </div>
    );
  }

  return (
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
            <div className={s.emptyState}><Icon name="alert" size={20} /> Failed to load attachments.</div>
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
                        <div className={s.emptyIcon}><Icon name="clip" size={20} /></div>
                        {search
                          ? `No results for "${search}"`
                          : 'No attachments yet. Files appear here once mailboxes with attachments are synced.'}
                      </div>
                    </td>
                  </tr>
                ) : (
                  groups.map(g => (
                    <tr key={g.mailboxId} className={s.groupRow} style={{ cursor: 'pointer' }} onClick={() => setBrowseGroup(g)}>
                      {colPrefs.visible.map((col) => renderGroupCell(col.id, g))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}
